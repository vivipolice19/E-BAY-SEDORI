import { randomUUID } from "crypto";
import type { SavedProduct, InsertSavedProduct, AppSettings, User, InsertUser, ListingTemplate } from "@shared/schema";

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
  private settings: AppSettings = {
    id: "default",
    spreadsheetId: process.env.SPREADSHEET_ID || "1j-SK1yrXw2Sl_3-LakDHe6FMh23v64wDPYZvlg84Gug",
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
}

export const storage = new MemStorage();
