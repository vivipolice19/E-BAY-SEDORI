import type { InventorySyncLog } from "@shared/schema";
import type { IStorage } from "./storage";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const BACKOFF_MS = [1000, 2000];

export interface InventoryImportPayload {
  product_id: string;
  title: string;
  price: number;
  quantity: number;
  listed_at: string;
  source: "sedori_app";
}

type SyncStatus = "success" | "failed" | "skipped";

function toJstIso(input: Date): string {
  const utcMs = input.getTime() + input.getTimezoneOffset() * 60_000;
  const jst = new Date(utcMs + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  const ss = String(jst.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}+09:00`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class InventorySyncService {
  constructor(
    private readonly storage: IStorage,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  buildPayload(input: {
    productId: string;
    title: string;
    price: number;
    listedAt?: Date;
  }): InventoryImportPayload {
    return {
      product_id: input.productId,
      title: input.title,
      price: Math.round(input.price),
      quantity: 1,
      listed_at: toJstIso(input.listedAt ?? new Date()),
      source: "sedori_app",
    };
  }

  async syncAfterListing(payload: InventoryImportPayload): Promise<InventorySyncLog> {
    const enabled = (process.env.INVENTORY_SYNC_ENABLED ?? "false").toLowerCase() === "true";
    if (!enabled) {
      return this.storage.createInventorySyncLog({
        productId: payload.product_id,
        requestPayload: safeStringify(payload),
        status: "skipped",
        responseStatus: null,
        responseBody: null,
        errorMessage: "INVENTORY_SYNC_ENABLED is false",
        sentAt: new Date(),
        retryCount: 0,
      });
    }

    return this.sendWithRetry(payload, 0);
  }

  async retryFailedLog(logId: string): Promise<InventorySyncLog> {
    const existing = await this.storage.getInventorySyncLog(logId);
    if (!existing) throw new Error("同期ログが見つかりません");
    if (!existing.requestPayload) throw new Error("再送用のpayloadがありません");
    const payload = JSON.parse(existing.requestPayload) as InventoryImportPayload;
    const nextRetryCount = (existing.retryCount ?? 0) + 1;
    return this.sendWithRetry(payload, nextRetryCount, existing.id);
  }

  private async sendWithRetry(
    payload: InventoryImportPayload,
    retryCountBase: number,
    logIdToUpdate?: string,
  ): Promise<InventorySyncLog> {
    const baseUrl = process.env.INVENTORY_BASE_URL?.trim();
    const token = process.env.INVENTORY_API_TOKEN?.trim();
    if (!baseUrl || !token) {
      return this.saveLog({
        logIdToUpdate,
        payload,
        status: "failed",
        responseStatus: null,
        responseBody: null,
        errorMessage: "INVENTORY_BASE_URL or INVENTORY_API_TOKEN is missing",
        retryCount: retryCountBase,
      });
    }

    let lastError = "";
    let lastStatus: number | null = null;
    let lastBody: string | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const res = await this.fetchFn(`${baseUrl.replace(/\/$/, "")}/api/inventory/import`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timer);

        const text = await res.text();
        lastStatus = res.status;
        lastBody = text;

        if (res.ok) {
          return this.saveLog({
            logIdToUpdate,
            payload,
            status: "success",
            responseStatus: res.status,
            responseBody: text,
            errorMessage: null,
            retryCount: retryCountBase + attempt,
          });
        }

        lastError = `Inventory API responded with ${res.status}`;
      } catch (error: any) {
        clearTimeout(timer);
        lastError = error?.name === "AbortError" ? "Inventory API timeout" : error?.message || "Unknown sync error";
      }

      if (attempt < MAX_RETRIES) {
        await this.sleep(BACKOFF_MS[attempt] ?? 1000);
      }
    }

    return this.saveLog({
      logIdToUpdate,
      payload,
      status: "failed",
      responseStatus: lastStatus,
      responseBody: lastBody,
      errorMessage: lastError,
      retryCount: retryCountBase + MAX_RETRIES,
    });
  }

  private async saveLog(args: {
    logIdToUpdate?: string;
    payload: InventoryImportPayload;
    status: SyncStatus;
    responseStatus: number | null;
    responseBody: string | null;
    errorMessage: string | null;
    retryCount: number;
  }): Promise<InventorySyncLog> {
    const row: Omit<InventorySyncLog, "id"> = {
      productId: args.payload.product_id,
      requestPayload: safeStringify(args.payload),
      status: args.status,
      responseStatus: args.responseStatus,
      responseBody: args.responseBody,
      errorMessage: args.errorMessage,
      sentAt: new Date(),
      retryCount: args.retryCount,
    };

    if (args.logIdToUpdate) {
      const updated = await this.storage.updateInventorySyncLog(args.logIdToUpdate, row);
      if (updated) return updated;
    }
    return this.storage.createInventorySyncLog(row);
  }
}

