import test from "node:test";
import assert from "node:assert/strict";
import type { InventorySyncLog } from "@shared/schema";
import type { IStorage } from "./storage";
import { InventorySyncService } from "./inventorySync";

class FakeStorage implements IStorage {
  private logs = new Map<string, InventorySyncLog>();
  private seq = 0;

  // Unused in these tests
  async getUser() { return undefined; }
  async getUserByUsername() { return undefined; }
  async createUser() { throw new Error("not used"); }
  async getSavedProducts() { return []; }
  async getSavedProduct() { return undefined; }
  async createSavedProduct() { throw new Error("not used"); }
  async updateSavedProduct() { return undefined; }
  async deleteSavedProduct() { return false; }
  async getSettings() { throw new Error("not used"); }
  async updateSettings() { throw new Error("not used"); }
  async getTemplates() { return []; }
  async getTemplate() { return undefined; }
  async createTemplate() { throw new Error("not used"); }
  async updateTemplate() { return undefined; }
  async deleteTemplate() { return false; }

  async createInventorySyncLog(log: Omit<InventorySyncLog, "id">): Promise<InventorySyncLog> {
    const id = `log-${++this.seq}`;
    const row: InventorySyncLog = { id, ...log };
    this.logs.set(id, row);
    return row;
  }
  async updateInventorySyncLog(id: string, updates: Partial<Omit<InventorySyncLog, "id">>): Promise<InventorySyncLog | undefined> {
    const existing = this.logs.get(id);
    if (!existing) return undefined;
    const updated: InventorySyncLog = { ...existing, ...updates };
    this.logs.set(id, updated);
    return updated;
  }
  async getInventorySyncLog(id: string): Promise<InventorySyncLog | undefined> {
    return this.logs.get(id);
  }
  async getInventorySyncLogs(status?: InventorySyncLog["status"]): Promise<InventorySyncLog[]> {
    const all = Array.from(this.logs.values());
    return status ? all.filter((l) => l.status === status) : all;
  }
}

function payload() {
  return {
    product_id: "sedori-123",
    title: "Test Product",
    price: 12800,
    quantity: 1,
    listed_at: "2026-04-22T12:34:56+09:00",
    source: "sedori_app" as const,
  };
}

test("sync success creates success log", async () => {
  process.env.INVENTORY_SYNC_ENABLED = "true";
  process.env.INVENTORY_BASE_URL = "https://inventory.example.com";
  process.env.INVENTORY_API_TOKEN = "token";

  const storage = new FakeStorage();
  const service = new InventorySyncService(
    storage,
    (async () => new Response("{\"ok\":true}", { status: 200 })) as typeof fetch,
    async () => {},
  );

  const log = await service.syncAfterListing(payload());
  assert.equal(log.status, "success");
  assert.equal(log.productId, "sedori-123");
});

test("sync failure creates failed log", async () => {
  process.env.INVENTORY_SYNC_ENABLED = "true";
  process.env.INVENTORY_BASE_URL = "https://inventory.example.com";
  process.env.INVENTORY_API_TOKEN = "token";

  const storage = new FakeStorage();
  const service = new InventorySyncService(
    storage,
    (async () => new Response("fail", { status: 500 })) as typeof fetch,
    async () => {},
  );

  const log = await service.syncAfterListing(payload());
  assert.equal(log.status, "failed");
  assert.equal(log.responseStatus, 500);
});

test("sync disabled skips sending and stores skipped log", async () => {
  process.env.INVENTORY_SYNC_ENABLED = "false";
  process.env.INVENTORY_BASE_URL = "https://inventory.example.com";
  process.env.INVENTORY_API_TOKEN = "token";

  let called = false;
  const storage = new FakeStorage();
  const service = new InventorySyncService(
    storage,
    (async () => {
      called = true;
      return new Response("ok", { status: 200 });
    }) as typeof fetch,
    async () => {},
  );

  const log = await service.syncAfterListing(payload());
  assert.equal(called, false);
  assert.equal(log.status, "skipped");
});

