import { randomUUID } from "crypto";
import path from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import type {
  SavedProduct,
  InsertSavedProduct,
  AppSettings,
  User,
  InsertUser,
  ListingTemplate,
  InventorySyncLog,
} from "@shared/schema";
import { loadPersistedSettings, savePersistedSettings } from "./settingsDb";
import { loadAllSavedProductsFromDb, replaceSavedProductRow, deleteSavedProductRow } from "./productsDb";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getSavedProducts(): Promise<SavedProduct[]>;
  getSavedProduct(id: string): Promise<SavedProduct | undefined>;
  createSavedProduct(product: InsertSavedProduct): Promise<SavedProduct>;
  updateSavedProduct(id: string, product: Partial<InsertSavedProduct>): Promise<SavedProduct | undefined>;
  deleteSavedProduct(id: string): Promise<boolean>;

  getSettings(): Promise<AppSettings>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>;

  getTemplates(): Promise<ListingTemplate[]>;
  getTemplate(id: string): Promise<ListingTemplate | undefined>;
  createTemplate(template: Omit<ListingTemplate, "id">): Promise<ListingTemplate>;
  updateTemplate(id: string, template: Partial<Omit<ListingTemplate, "id">>): Promise<ListingTemplate | undefined>;
  deleteTemplate(id: string): Promise<boolean>;

  createInventorySyncLog(log: Omit<InventorySyncLog, "id">): Promise<InventorySyncLog>;
  updateInventorySyncLog(id: string, updates: Partial<Omit<InventorySyncLog, "id">>): Promise<InventorySyncLog | undefined>;
  getInventorySyncLog(id: string): Promise<InventorySyncLog | undefined>;
  getInventorySyncLogs(status?: InventorySyncLog["status"]): Promise<InventorySyncLog[]>;
}

const DEFAULT_TEMPLATES: ListingTemplate[] = [
  {
    id: "tpl-electronics",
    name: "家電・電子機器（汎用）",
    category: "Electronics",
    descriptionTemplate: `{title}

★ ITEM DETAILS ★
Condition: {condition}

{specifics}

★ ABOUT THIS ITEM ★
This item is shipped from Japan. Please check all photos carefully before purchasing.

★ SHIPPING ★
• Ships from Japan
• Carefully packed with bubble wrap and sturdy box
• Ships within 1-3 business days after payment
• Tracking number provided

★ PAYMENT ★
• PayPal accepted
• Payment expected within 3 days of purchase

★ RETURNS ★
• Please contact us before opening a case or leaving negative feedback
• We want to ensure your complete satisfaction

Thank you for shopping with us!`,
    shippingInfo: "Ships from Japan. Carefully packed. Ships within 1-3 business days. Tracking provided.",
    returnPolicy: "Contact seller before leaving feedback. Satisfaction guaranteed.",
  },
  {
    id: "tpl-audio",
    name: "オーディオ・ヘッドフォン",
    category: "Consumer Electronics > Portable Audio & Headphones",
    descriptionTemplate: `{title}

★ PRODUCT INFORMATION ★
Condition: {condition}

{specifics}

★ CONDITION DETAILS ★
Please refer to all photos for detailed condition. Item has been tested and is fully functional.

★ WHAT'S INCLUDED ★
• Main unit
• Original accessories (if shown in photos)

★ SHIPPING ★
• Ships from Japan
• Double-boxed for safe delivery
• Ships within 1-3 business days
• Tracking number included

★ PAYMENT ★
• PayPal only
• Please pay within 3 days

★ RETURNS ★
• 30-day return policy
• Item must be returned in same condition

Feel free to ask any questions!`,
    shippingInfo: "Ships from Japan. Double-boxed. 1-3 business days. Tracking included.",
    returnPolicy: "30-day returns accepted. Item must be in same condition.",
  },
  {
    id: "tpl-toy",
    name: "ぬいぐるみ・フィギュア・キャラクター",
    category: "Toys & Hobbies",
    descriptionTemplate: `{title}

★ ITEM DETAILS ★
Condition: {condition}

{specifics}

★ ABOUT THIS ITEM ★
This is an authentic Japanese item shipped directly from Japan.
Please check all photos carefully — they show the actual item.

★ CONDITION NOTES ★
• Original/authentic Japanese product
• Please examine all photos for detailed condition information

★ SHIPPING ★
• Ships from Japan
• Carefully packed to prevent damage
• Ships within 1-3 business days after payment
• Tracking number provided

★ PAYMENT ★
• PayPal accepted
• Payment expected within 3 days of purchase

★ RETURNS ★
• Please contact us before opening a case
• We strive for complete buyer satisfaction

Thank you for your purchase!`,
    shippingInfo: "Ships from Japan. Carefully packed. 1-3 business days. Tracking provided.",
    returnPolicy: "Contact seller before leaving feedback. Satisfaction guaranteed.",
  },
  {
    id: "tpl-game",
    name: "ゲーム・ホビー",
    category: "Video Games & Consoles",
    descriptionTemplate: `{title}

★ ITEM DETAILS ★
Condition: {condition}

{specifics}

★ ABOUT THIS ITEM ★
Authentic Japanese game/hobby item shipped from Japan.

★ CONDITION NOTES ★
• Please check all photos carefully for condition details
• Region information noted in specifics if applicable

★ SHIPPING ★
• Ships from Japan
• Securely packaged
• Ships within 1-3 business days
• Tracking number included

★ PAYMENT ★
• PayPal accepted
• Payment within 3 days

★ RETURNS ★
• Contact us before leaving feedback

Thank you!`,
    shippingInfo: "Ships from Japan. Securely packaged. 1-3 business days. Tracking included.",
    returnPolicy: "Contact seller before leaving feedback.",
  },
  {
    id: "tpl-camera",
    name: "カメラ・光学機器",
    category: "Cameras & Photo",
    descriptionTemplate: `{title}

★ CAMERA DETAILS ★
Condition: {condition}

{specifics}

★ CONDITION NOTES ★
• All photos are of the actual item
• Shutter count and sensor condition noted if applicable
• Please examine all photos carefully

★ WHAT'S IN THE BOX ★
• Camera body / lens (as shown in photos)
• Original accessories if present

★ SHIPPING ★
• Ships from Japan
• Securely padded and boxed
• Ships within 1-3 business days after payment
• Tracking number provided

★ PAYMENT ★
• PayPal accepted
• Payment within 3 days of purchase

★ RETURNS ★
• Returns accepted within 30 days
• Please contact us first

Questions welcome!`,
    shippingInfo: "Ships from Japan. Securely packaged. 1-3 business days. Tracking included.",
    returnPolicy: "30-day returns. Contact seller first.",
  },
];

export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private products: Map<string, SavedProduct> = new Map();
  private templates: Map<string, ListingTemplate> = new Map();
  private inventorySyncLogs: Map<string, InventorySyncLog> = new Map();
  protected settings: AppSettings = {
    id: "default",
    spreadsheetId: process.env.SPREADSHEET_ID || null,
    sheetName: "セドリリスト",
    exchangeRate: 150,
    ebayFeeRate: 13.25,
    shippingCost: 1500,
    otherFees: 500,
    forwardingDomesticShipping: 800,
    forwardingAgentFee: 500,
    forwardingIntlBase: 2000,
    forwardingIntlPerGram: 3,
    inventorySheetName: "Mercari-eBay 在庫管理",
    ebayUserToken: null,
    ebayDevId: null,
    ebayStoreName: null,
    ebayPaymentPolicy: null,
    ebayReturnPolicy: null,
    ebayShippingPolicy: null,
    ebayDispatchDays: 3,
    ebayLocation: "Japan",
    ebayAppId: process.env.EBAY_APP_ID || null,
    ebayCertId: process.env.EBAY_CERT_ID || null,
  };

  constructor() {
    DEFAULT_TEMPLATES.forEach(t => this.templates.set(t.id, t));
  }

  async getUser(id: string) { return this.users.get(id); }
  async getUserByUsername(username: string) {
    return Array.from(this.users.values()).find(u => u.username === username);
  }
  async createUser(user: InsertUser): Promise<User> {
    const id = randomUUID();
    const newUser: User = { ...user, id };
    this.users.set(id, newUser);
    return newUser;
  }

  async getSavedProducts(): Promise<SavedProduct[]> {
    return Array.from(this.products.values()).sort(
      (a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
    );
  }

  async getSavedProduct(id: string): Promise<SavedProduct | undefined> {
    return this.products.get(id);
  }

  async createSavedProduct(product: InsertSavedProduct): Promise<SavedProduct> {
    const id = randomUUID();
    const newProduct: SavedProduct = {
      ...product,
      id,
      createdAt: new Date(),
      syncedToSheets: false,
      ebayItemId: product.ebayItemId ?? null,
      ebayPrice: product.ebayPrice ?? null,
      ebayPriceJpy: product.ebayPriceJpy ?? null,
      ebayUrl: product.ebayUrl ?? null,
      ebayCategory: product.ebayCategory ?? null,
      ebayCondition: product.ebayCondition ?? null,
      ebaySoldCount: product.ebaySoldCount ?? null,
      ebayImageUrl: product.ebayImageUrl ?? null,
      ebayImageUrls: product.ebayImageUrls ?? null,
      ebayRating: product.ebayRating ?? null,
      sourcePrice: product.sourcePrice ?? null,
      sourcePlatform: product.sourcePlatform ?? null,
      sourceUrl: product.sourceUrl ?? null,
      sourceImageUrls: product.sourceImageUrls ?? null,
      profit: product.profit ?? null,
      profitRate: product.profitRate ?? null,
      notes: product.notes ?? null,
      listingStatus: product.listingStatus ?? "仕入中",
      actualSalePrice: product.actualSalePrice ?? null,
      actualProfit: product.actualProfit ?? null,
      listingTitle: product.listingTitle ?? null,
      listingDescription: product.listingDescription ?? null,
      listingPrice: product.listingPrice ?? null,
      listingItemSpecifics: product.listingItemSpecifics ?? null,
      weight: product.weight ?? null,
      forwardingCost: product.forwardingCost ?? null,
      sheetRowIndex: product.sheetRowIndex ?? null,
      marketAvgJpy: product.marketAvgJpy ?? null,
      marketMinJpy: product.marketMinJpy ?? null,
      marketMaxJpy: product.marketMaxJpy ?? null,
      sourceCondition: product.sourceCondition ?? null,
      sourceDescription: product.sourceDescription ?? null,
      ebayConditionMapped: product.ebayConditionMapped ?? null,
      ebayCategoryPath: product.ebayCategoryPath ?? null,
      ebayCategoryId: product.ebayCategoryId ?? null,
      ebayListingId: product.ebayListingId ?? null,
    };
    this.products.set(id, newProduct);
    return newProduct;
  }

  async updateSavedProduct(id: string, updates: Partial<InsertSavedProduct>): Promise<SavedProduct | undefined> {
    const existing = this.products.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.products.set(id, updated);
    return updated;
  }

  async deleteSavedProduct(id: string): Promise<boolean> {
    return this.products.delete(id);
  }

  /** DATABASE_URL 利用時に Postgres から一覧を復元する */
  protected replaceProductsFromPersisted(rows: SavedProduct[]) {
    this.products.clear();
    for (const p of rows) this.products.set(p.id, p);
  }

  /** ファイル永続化用（子クラスからスナップショット取得） */
  protected getAllProductsSnapshot(): SavedProduct[] {
    return Array.from(this.products.values());
  }

  async getSettings(): Promise<AppSettings> {
    return this.settings;
  }

  async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = { ...this.settings, ...updates };
    return this.settings;
  }

  async getTemplates(): Promise<ListingTemplate[]> {
    return Array.from(this.templates.values());
  }

  async getTemplate(id: string): Promise<ListingTemplate | undefined> {
    return this.templates.get(id);
  }

  async createTemplate(template: Omit<ListingTemplate, "id">): Promise<ListingTemplate> {
    const id = randomUUID();
    const newTemplate: ListingTemplate = { ...template, id };
    this.templates.set(id, newTemplate);
    return newTemplate;
  }

  async updateTemplate(id: string, updates: Partial<Omit<ListingTemplate, "id">>): Promise<ListingTemplate | undefined> {
    const existing = this.templates.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.templates.set(id, updated);
    return updated;
  }

  async deleteTemplate(id: string): Promise<boolean> {
    if (DEFAULT_TEMPLATES.find(t => t.id === id)) return false;
    return this.templates.delete(id);
  }

  async createInventorySyncLog(log: Omit<InventorySyncLog, "id">): Promise<InventorySyncLog> {
    const id = randomUUID();
    const row: InventorySyncLog = {
      id,
      productId: log.productId,
      requestPayload: log.requestPayload,
      status: log.status,
      responseStatus: log.responseStatus ?? null,
      responseBody: log.responseBody ?? null,
      errorMessage: log.errorMessage ?? null,
      sentAt: log.sentAt ?? new Date(),
      retryCount: log.retryCount ?? 0,
    };
    this.inventorySyncLogs.set(id, row);
    return row;
  }

  async updateInventorySyncLog(
    id: string,
    updates: Partial<Omit<InventorySyncLog, "id">>,
  ): Promise<InventorySyncLog | undefined> {
    const existing = this.inventorySyncLogs.get(id);
    if (!existing) return undefined;
    const updated: InventorySyncLog = { ...existing, ...updates };
    this.inventorySyncLogs.set(id, updated);
    return updated;
  }

  async getInventorySyncLog(id: string): Promise<InventorySyncLog | undefined> {
    return this.inventorySyncLogs.get(id);
  }

  async getInventorySyncLogs(status?: InventorySyncLog["status"]): Promise<InventorySyncLog[]> {
    const rows = Array.from(this.inventorySyncLogs.values());
    const filtered = status ? rows.filter((r) => r.status === status) : rows;
    return filtered.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  }
}

const FILE_PERSIST_VERSION = 1;

function getStateFilePath(): string {
  const dir = process.env.PERSIST_DATA_DIR?.trim() || path.join(process.cwd(), ".data");
  return path.join(dir, "sedori-state.json");
}

/**
 * Postgres なしでも、ディスク上の JSON に設定・保存商品を書き戻す（スリープ／プロセス再起動後の復元用）。
 * Render のエフェメラル FS では再デプロイで消える場合がある → 本番は DATABASE_URL 推奨。
 */
export class FilePersistedStorage extends MemStorage {
  private fileHydrated = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  private hydrateFromFileOnce(): void {
    if (this.fileHydrated) return;
    this.fileHydrated = true;
    if (process.env.PERSIST_STATE === "0" || process.env.PERSIST_STATE === "false") return;
    const fp = getStateFilePath();
    if (!existsSync(fp)) return;
    try {
      const raw = JSON.parse(readFileSync(fp, "utf-8")) as {
        settings?: Partial<AppSettings>;
        products?: SavedProduct[];
      };
      if (raw.settings && typeof raw.settings === "object") {
        this.settings = { ...this.settings, ...raw.settings } as AppSettings;
      }
      if (Array.isArray(raw.products) && raw.products.length > 0) {
        const rows = raw.products.map((p) => ({
          ...p,
          createdAt: p.createdAt ? new Date(p.createdAt as unknown as string | number | Date) : new Date(),
        })) as SavedProduct[];
        this.replaceProductsFromPersisted(rows);
      }
      console.log(`[file-persist] Loaded ${fp} (${raw.products?.length ?? 0} products)`);
    } catch (e) {
      console.error("[file-persist] Failed to load state file:", e);
    }
  }

  private flushToFile(): void {
    if (process.env.PERSIST_STATE === "0" || process.env.PERSIST_STATE === "false") return;
    try {
      const fp = getStateFilePath();
      mkdirSync(path.dirname(fp), { recursive: true });
      const products = this.getAllProductsSnapshot();
      writeFileSync(
        fp,
        JSON.stringify(
          {
            version: FILE_PERSIST_VERSION,
            savedAt: new Date().toISOString(),
            settings: this.settings,
            products,
          },
          null,
          0,
        ),
        "utf-8",
      );
    } catch (e) {
      console.error("[file-persist] Failed to write state file:", e);
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushToFile();
    }, 350);
  }

  async getSettings(): Promise<AppSettings> {
    this.hydrateFromFileOnce();
    return super.getSettings();
  }

  async getSavedProducts(): Promise<SavedProduct[]> {
    this.hydrateFromFileOnce();
    return super.getSavedProducts();
  }

  async getSavedProduct(id: string): Promise<SavedProduct | undefined> {
    this.hydrateFromFileOnce();
    return super.getSavedProduct(id);
  }

  async createSavedProduct(product: InsertSavedProduct): Promise<SavedProduct> {
    this.hydrateFromFileOnce();
    const created = await super.createSavedProduct(product);
    this.schedulePersist();
    return created;
  }

  async updateSavedProduct(id: string, product: Partial<InsertSavedProduct>): Promise<SavedProduct | undefined> {
    this.hydrateFromFileOnce();
    const updated = await super.updateSavedProduct(id, product);
    if (updated) this.schedulePersist();
    return updated;
  }

  async deleteSavedProduct(id: string): Promise<boolean> {
    this.hydrateFromFileOnce();
    const ok = await super.deleteSavedProduct(id);
    if (ok) this.schedulePersist();
    return ok;
  }

  async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    this.hydrateFromFileOnce();
    const merged = await super.updateSettings(updates);
    this.schedulePersist();
    return merged;
  }
}

/**
 * DATABASE_URL がある場合は app_settings 行を読み書きする。
 * Render の再起動・水平スケールでも設定（eBay App ID 等）が共有される。
 */
export class DbBackedStorage extends MemStorage {
  private productsHydrated = false;

  private async ensureProductsHydrated(): Promise<void> {
    if (!process.env.DATABASE_URL?.trim() || this.productsHydrated) return;
    try {
      const rows = await loadAllSavedProductsFromDb();
      this.replaceProductsFromPersisted(rows);
    } catch (e) {
      console.error(
        "[products] Failed to load from database (Render で Postgres を使う場合は `npm run db:push` で saved_products を作成):",
        e,
      );
    }
    this.productsHydrated = true;
  }

  async getSavedProducts(): Promise<SavedProduct[]> {
    await this.ensureProductsHydrated();
    return super.getSavedProducts();
  }

  async getSavedProduct(id: string): Promise<SavedProduct | undefined> {
    await this.ensureProductsHydrated();
    return super.getSavedProduct(id);
  }

  async createSavedProduct(product: InsertSavedProduct): Promise<SavedProduct> {
    await this.ensureProductsHydrated();
    const created = await super.createSavedProduct(product);
    if (process.env.DATABASE_URL?.trim()) {
      try {
        await replaceSavedProductRow(created);
      } catch (e) {
        console.error("[products] Failed to persist new product:", e);
      }
    }
    return created;
  }

  async updateSavedProduct(id: string, product: Partial<InsertSavedProduct>): Promise<SavedProduct | undefined> {
    await this.ensureProductsHydrated();
    const updated = await super.updateSavedProduct(id, product);
    if (updated && process.env.DATABASE_URL?.trim()) {
      try {
        await replaceSavedProductRow(updated);
      } catch (e) {
        console.error("[products] Failed to persist product update:", e);
      }
    }
    return updated;
  }

  async deleteSavedProduct(id: string): Promise<boolean> {
    await this.ensureProductsHydrated();
    const ok = await super.deleteSavedProduct(id);
    if (ok && process.env.DATABASE_URL?.trim()) {
      try {
        await deleteSavedProductRow(id);
      } catch (e) {
        console.error("[products] Failed to delete product from database:", e);
      }
    }
    return ok;
  }

  async getSettings(): Promise<AppSettings> {
    if (!process.env.DATABASE_URL?.trim()) return super.getSettings();
    try {
      const row = await loadPersistedSettings();
      if (row) this.settings = row;
    } catch (e) {
      console.error("[settings] Failed to load from database:", e);
    }
    const envSid =
      process.env.SPREADSHEET_ID?.trim() ||
      process.env.GOOGLE_SPREADSHEET_ID?.trim();
    if (envSid && !String(this.settings.spreadsheetId || "").trim()) {
      this.settings = { ...this.settings, spreadsheetId: envSid };
    }
    return this.settings;
  }

  async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    const merged = await super.updateSettings(updates);
    if (!process.env.DATABASE_URL?.trim()) return merged;
    try {
      await savePersistedSettings(merged);
    } catch (e) {
      console.error("[settings] Failed to save to database:", e);
    }
    return merged;
  }
}

export const storage = process.env.DATABASE_URL?.trim()
  ? new DbBackedStorage()
  : new FilePersistedStorage();
