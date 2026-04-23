import type { InventorySyncLog } from "@shared/schema";
import type { IStorage } from "./storage";
import { randomUUID } from "crypto";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 3000, 9000];
const INVENTORY_BASE_URL = "https://ebay-lowest-checker-1.onrender.com";

export interface InventoryImportPayload {
  event_id: string;
  external_id: string;
  mercari_url: string;
  ebay_url: string;
  purchase_price?: number;
  profit_rate?: number;
  title?: string;
  listed_at?: string;
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
    externalId: string;
    mercariUrl?: string | null;
    ebayUrl?: string | null;
    purchasePrice?: number | null;
    profitRate?: number | null;
    title?: string | null;
    listedAt?: Date;
  }): InventoryImportPayload {
    return {
      event_id: `evt_${randomUUID()}`,
      external_id: input.externalId,
      mercari_url: input.mercariUrl || "",
      ebay_url: input.ebayUrl || "",
      purchase_price: input.purchasePrice != null ? Math.round(input.purchasePrice) : undefined,
      profit_rate: input.profitRate != null ? input.profitRate : undefined,
      title: input.title || undefined,
      listed_at: toJstIso(input.listedAt ?? new Date()),
    };
  }

  async syncAfterListing(payload: InventoryImportPayload): Promise<InventorySyncLog> {
    const enabled = (process.env.INVENTORY_SYNC_ENABLED ?? "false").toLowerCase() === "true";
    if (!enabled) {
      return this.storage.createInventorySyncLog({
        productId: payload.external_id,
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
    const baseUrl = process.env.INVENTORY_BASE_URL?.trim() || INVENTORY_BASE_URL;

    let lastError = "";
    let lastStatus: number | null = null;
    let lastBody: string | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const shouldRetry = attempt < MAX_RETRIES;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const res = await this.fetchFn(`${baseUrl.replace(/\/$/, "")}/api/v1/sedori/listings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timer);

        const text = await res.text();
        lastStatus = res.status;
        lastBody = text;
        console.log("[Inventory Sync]", {
          event_id: payload.event_id,
          external_id: payload.external_id,
          status_code: res.status,
          response_body: text,
        });

        let bodyJson: any = null;
        try {
          bodyJson = text ? JSON.parse(text) : null;
        } catch {
          bodyJson = null;
        }

        const isSuccess =
          res.status === 200 &&
          bodyJson?.success === true &&
          ["created", "updated", "duplicate_event"].includes(bodyJson?.result);

        if (isSuccess) {
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
        if (res.status >= 400 && res.status < 500) {
          break;
        }
      } catch (error: any) {
        clearTimeout(timer);
        lastError = error?.name === "AbortError" ? "Inventory API timeout" : error?.message || "Unknown sync error";
        console.error("[Inventory Sync Error]", {
          event_id: payload.event_id,
          external_id: payload.external_id,
          error: lastError,
        });
      }

      if (shouldRetry) {
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
      productId: args.payload.external_id,
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

