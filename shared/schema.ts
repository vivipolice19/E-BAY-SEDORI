import { pgTable, text, integer, real, boolean, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const savedProducts = pgTable("saved_products", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  ebayItemId: text("ebay_item_id"),
  ebayPrice: real("ebay_price"),
  ebayPriceJpy: integer("ebay_price_jpy"),
  ebayUrl: text("ebay_url"),
  ebayCategory: text("ebay_category"),
  ebayCondition: text("ebay_condition"),
  ebaySoldCount: integer("ebay_sold_count"),
  ebayImageUrl: text("ebay_image_url"),
  ebayImageUrls: text("ebay_image_urls").array(),
  ebayRating: real("ebay_rating"),
  sourcePrice: integer("source_price"),
  sourcePlatform: text("source_platform"),
  sourceUrl: text("source_url"),
  sourceImageUrls: text("source_image_urls").array(),
  profit: integer("profit"),
  profitRate: real("profit_rate"),
  notes: text("notes"),
  syncedToSheets: boolean("synced_to_sheets").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  // Listing management fields
  listingStatus: text("listing_status").default("仕入中"),
  actualSalePrice: real("actual_sale_price"),
  actualProfit: integer("actual_profit"),
  listingTitle: text("listing_title"),
  listingDescription: text("listing_description"),
  listingPrice: real("listing_price"),
  listingItemSpecifics: text("listing_item_specifics"),
  // Forwarding cost fields
  weight: integer("weight"),
  forwardingCost: integer("forwarding_cost"),
  sheetRowIndex: integer("sheet_row_index"),
  // Market price data (from eBay sold comps)
  marketAvgJpy: integer("market_avg_jpy"),
  marketMinJpy: integer("market_min_jpy"),
  marketMaxJpy: integer("market_max_jpy"),
  // Source item detail (from scraping source URL)
  sourceCondition: text("source_condition"),
  sourceDescription: text("source_description"),
  ebayConditionMapped: text("ebay_condition_mapped"),
  ebayCategoryPath: text("ebay_category_path"),
  ebayCategoryId: text("ebay_category_id"),
  ebayListingId: text("ebay_listing_id"),
});

export const appSettings = pgTable("app_settings", {
  id: varchar("id").primaryKey(),
  spreadsheetId: text("spreadsheet_id"),
  sheetName: text("sheet_name").default("セドリリスト"),
  exchangeRate: integer("exchange_rate").default(150),
  ebayFeeRate: real("ebay_fee_rate").default(13.25),
  shippingCost: integer("shipping_cost").default(1500),
  otherFees: integer("other_fees").default(500),
  // Forwarding agent settings
  forwardingDomesticShipping: integer("forwarding_domestic_shipping").default(800),
  forwardingAgentFee: integer("forwarding_agent_fee").default(500),
  forwardingIntlBase: integer("forwarding_intl_base").default(2000),
  forwardingIntlPerGram: integer("forwarding_intl_per_gram").default(3),
  inventorySheetName: text("inventory_sheet_name").default("Mercari-eBay 在庫管理"),
  // eBay seller account
  ebayUserToken: text("ebay_user_token"),
  ebayDevId: text("ebay_dev_id"),
  ebayStoreName: text("ebay_store_name"),
  ebayPaymentPolicy: text("ebay_payment_policy"),
  ebayReturnPolicy: text("ebay_return_policy"),
  ebayShippingPolicy: text("ebay_shipping_policy"),
  ebayDispatchDays: integer("ebay_dispatch_days").default(3),
  ebayLocation: text("ebay_location").default("Japan"),
});

export const insertSavedProductSchema = createInsertSchema(savedProducts).omit({
  id: true,
  createdAt: true,
});

export const insertSettingsSchema = createInsertSchema(appSettings).omit({
  id: true,
});

export type InsertSavedProduct = z.infer<typeof insertSavedProductSchema>;
export type SavedProduct = typeof savedProducts.$inferSelect;
export type AppSettings = typeof appSettings.$inferSelect;
export type InsertUser = { username: string; password: string };
export type User = typeof users.$inferSelect;

export interface ListingTemplate {
  id: string;
  name: string;
  category: string;
  descriptionTemplate: string;
  shippingInfo: string;
  returnPolicy: string;
}

export interface EbayItem {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  priceJpy: number;
  imageUrl?: string;
  itemUrl: string;
  condition: string;
  category: string;
  location: string;
  soldCount?: number;
  watchCount?: number;
  listingType: string;
  hasVariations?: boolean;
  daysToSell?: number;
}

/** メタ情報付き落札検索（信頼性の判断用） */
export interface EbaySoldResearchMeta {
  /** 0 = 期間フィルタなし（APIの返す範囲） */
  windowDays: number;
  requestedLimit: number;
  returnedRaw: number;
  returnedAfterDedupe: number;
  duplicatesRemoved: number;
  medianPriceJpy: number | null;
  medianPriceUsd: number | null;
  /** 件数ベースの目安。最終判断は商品ごとに */
  reliability: "low" | "medium" | "high";
}

export interface PriceSearchResult {
  platform: string;
  title: string;
  price: number;
  url: string;
  imageUrl?: string;
  condition: string;
}
