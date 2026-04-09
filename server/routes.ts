import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { searchEbayItems, findPopularItems, searchSoldItems, fetchEbayUrlData, POPULAR_CATEGORIES, getEbayItemDetail, generateListingDescription, getEbayItemImages } from "./ebayClient";
import { appendProductToSheet, updateProductInSheet, appendToInventorySheet, getSpreadsheetInfo, ensureSheetExists, updateSheetHeaders, readSheetProducts } from "./googleSheets";
import { fetchSourcePrices, calcPriceStats, fetchUrlPrice } from "./sourcePrices";
import { buildSmartSearchKeywords } from "./searchBoost";
import { translateToJapanese } from "./translate";
import { insertSavedProductSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ---- eBay Search ----
  app.get("/api/ebay/search", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const {
        q,
        sortOrder = "BestMatch",
        minPrice,
        maxPrice,
        condition,
        listingType,
        categoryId,
        limit = "20",
        daysListed = "0",
        offset = "0",
        smartBoost,
      } = req.query as Record<string, string>;

      if (!q && !categoryId) return res.status(400).json({ error: "キーワードまたはカテゴリを指定してください" });

      let keywords = q || "";
      if ((smartBoost === "1" || smartBoost === "true") && keywords.trim()) {
        keywords = buildSmartSearchKeywords(keywords).effective;
      }

      const items = await searchEbayItems({
        keywords: keywords,
        sortOrder: sortOrder as any,
        minPrice: minPrice ? parseFloat(minPrice) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
        condition: condition as any,
        listingType: listingType as any,
        categoryId: categoryId || undefined,
        limit: parseInt(limit),
        exchangeRate: settings.exchangeRate || 150,
        daysListed: parseInt(daysListed) || 0,
        offset: parseInt(offset) || 0,
      });

      res.json(items);
    } catch (error: any) {
      console.error("eBay search error:", error);
      res.status(500).json({ error: error.message || "eBay検索エラー" });
    }
  });

  app.get("/api/ebay/popular/:categoryId", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const { offset = "0" } = req.query as Record<string, string>;
      const items = await findPopularItems(
        req.params.categoryId,
        settings.exchangeRate || 150,
        20,
        0,
        parseInt(offset) || 0,
      );
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ---- eBay Sold Items Search ----
  app.get("/api/ebay/sold", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const {
        q,
        minPrice,
        maxPrice,
        condition,
        categoryId,
        limit = "20",
        soldDays = "90",
        offset = "0",
        smartBoost,
      } = req.query as Record<string, string>;

      if (!q && !categoryId) return res.status(400).json({ error: "キーワードまたはカテゴリを指定してください" });

      const soldEndedWithinDays = parseInt(soldDays, 10);
      const safeSoldDays = Number.isFinite(soldEndedWithinDays) && soldEndedWithinDays >= 0 ? soldEndedWithinDays : 90;

      let soldKeywords = q || "";
      if ((smartBoost === "1" || smartBoost === "true") && soldKeywords.trim()) {
        soldKeywords = buildSmartSearchKeywords(soldKeywords).effective;
      }

      const result = await searchSoldItems({
        keywords: soldKeywords,
        minPrice: minPrice ? parseFloat(minPrice) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
        condition: condition as any,
        categoryId: categoryId || undefined,
        limit: parseInt(limit),
        exchangeRate: settings.exchangeRate || 150,
        soldEndedWithinDays: safeSoldDays === 0 ? 0 : safeSoldDays,
        offset: parseInt(offset, 10) || 0,
      });

      res.json(result);
    } catch (error: any) {
      console.error("eBay sold search error:", error);
      res.status(500).json({ error: error.message || "落札済み検索エラー" });
    }
  });

  app.get("/api/ebay/categories", (_req, res) => {
    res.json(POPULAR_CATEGORIES);
  });

  // ---- eBay All Images for an Item ----
  app.get("/api/ebay/images/:itemId", async (req, res) => {
    try {
      const itemId = req.params.itemId;
      const images = await getEbayItemImages(itemId);
      res.json({ images, count: images.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ---- eBay URL Data Fetch (item or search URL) ----
  app.post("/api/ebay/url", async (req, res) => {
    try {
      const { url } = req.body as { url?: string };
      if (!url || !url.startsWith("http")) {
        return res.status(400).json({ error: "有効なeBay URLを入力してください" });
      }
      if (!url.includes("ebay.com")) {
        return res.status(400).json({ error: "eBayのURLのみ対応しています（ebay.com）" });
      }
      const settings = await storage.getSettings();
      const result = await fetchEbayUrlData(url, settings.exchangeRate || 150);
      res.json(result);
    } catch (error: any) {
      console.error("eBay URL fetch error:", error);
      res.status(500).json({ error: error.message || "eBay URL取得エラー" });
    }
  });

  // ---- Translation ----
  app.post("/api/translate", async (req, res) => {
    try {
      const { text } = req.body as { text?: string };
      if (!text) return res.status(400).json({ error: "テキストを入力してください" });
      const result = await translateToJapanese(text);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "翻訳エラー" });
    }
  });

  // ---- Custom URL Price Fetch ----
  app.post("/api/source-url", async (req, res) => {
    try {
      const { url } = req.body as { url?: string };
      if (!url || !url.startsWith("http")) {
        return res.status(400).json({ error: "有効なURLを入力してください" });
      }
      const result = await fetchUrlPrice(url);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "URL取得エラー" });
    }
  });

  // ---- Price Research Links ----
  app.get("/api/price-links/:keyword", (req, res) => {
    const keyword = encodeURIComponent(req.params.keyword);
    res.json({
      mercari: `https://jp.mercari.com/search?keyword=${keyword}&status=on_sale`,
      yahooAuctions: `https://auctions.yahoo.co.jp/search/search?p=${keyword}&va=${keyword}&b=1&n=50&s1=new&o1=d`,
      yahooShopping: `https://shopping.yahoo.co.jp/search?p=${keyword}`,
      amazon: `https://www.amazon.co.jp/s?k=${keyword}`,
      rakuten: `https://search.rakuten.co.jp/search/mall/${keyword}/`,
    });
  });

  // ---- Auto Source Price Fetching ----
  app.get("/api/source-prices/:keyword", async (req, res) => {
    try {
      const keyword = req.params.keyword;
      const results = await fetchSourcePrices(keyword);
      const allItems = [...results.mercari, ...results.yahoo, ...results.yahooShopping, ...results.rakuma, ...results.surugaya];
      const stats = calcPriceStats(allItems);
      const mercariStats = calcPriceStats(results.mercari);
      const yahooStats = calcPriceStats(results.yahoo);
      const yahooShoppingStats = calcPriceStats(results.yahooShopping);
      const rakumaStats = calcPriceStats(results.rakuma);
      const surugayaStats = calcPriceStats(results.surugaya);
      res.json({
        items: allItems,
        mercari: { items: results.mercari, stats: mercariStats },
        yahoo: { items: results.yahoo, stats: yahooStats },
        yahooShopping: { items: results.yahooShopping, stats: yahooShoppingStats },
        rakuma: { items: results.rakuma, stats: rakumaStats },
        surugaya: { items: results.surugaya, stats: surugayaStats },
        overall: { stats },
        errors: results.errors,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ---- Saved Products ----
  app.get("/api/products", async (_req, res) => {
    try {
      const products = await storage.getSavedProducts();
      res.json(products);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/products", async (req, res) => {
    try {
      const parsed = insertSavedProductSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }

      // Calculate profit if prices are provided
      const settings = await storage.getSettings();
      const data = parsed.data;

      const extraFields: { profit?: number; profitRate?: number } = {};
      if (data.ebayPriceJpy && data.sourcePrice) {
        const ebayFee = data.ebayPriceJpy * ((settings.ebayFeeRate ?? 13.25) / 100);
        // Use provided forwardingCost if available, otherwise fall back to settings.shippingCost
        const forwarding = data.forwardingCost != null ? data.forwardingCost : (settings.shippingCost || 0);
        const other = settings.otherFees || 0;
        const profit = Math.round(data.ebayPriceJpy - ebayFee - forwarding - other - data.sourcePrice);
        const profitRate = parseFloat(((profit / data.ebayPriceJpy) * 100).toFixed(1));
        extraFields.profit = profit;
        extraFields.profitRate = profitRate;
      }

      const product = await storage.createSavedProduct({ ...data, ...extraFields });
      res.json(product);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/products/:id", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      const patchSchema = z.object({
        name: z.string().optional(),
        ebayPrice: z.number().optional(),
        ebayPriceJpy: z.number().int().optional(),
        sourcePrice: z.number().int().optional(),
        sourcePlatform: z.string().optional(),
        sourceUrl: z.string().optional(),
        notes: z.string().optional(),
        syncedToSheets: z.boolean().optional(),
        // Listing management fields
        listingStatus: z.string().optional(),
        actualSalePrice: z.number().nullable().optional(),
        actualProfit: z.number().nullable().optional(),
        listingTitle: z.string().nullable().optional(),
        listingDescription: z.string().nullable().optional(),
        listingPrice: z.number().nullable().optional(),
        listingItemSpecifics: z.string().nullable().optional(),
        // Forwarding cost fields
        weight: z.number().int().nullable().optional(),
        forwardingCost: z.number().int().nullable().optional(),
        sheetRowIndex: z.number().int().nullable().optional(),
        // Images
        ebayImageUrls: z.array(z.string()).nullable().optional(),
        ebayImageUrl: z.string().nullable().optional(),
        // eBay listing condition and category
        ebayCondition: z.string().nullable().optional(),
        ebayCategoryPath: z.string().nullable().optional(),
        ebayCategoryId: z.string().nullable().optional(),
        ebayListingId: z.string().nullable().optional(),
      });
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const updates = parsed.data;

      const existing = await storage.getSavedProduct(req.params.id);
      if (!existing) return res.status(404).json({ error: "商品が見つかりません" });

      // Recalculate profit (use forwardingCost if provided, fallback to shippingCost setting)
      const ebayPriceJpy = updates.ebayPriceJpy ?? existing.ebayPriceJpy;
      const sourcePrice = updates.sourcePrice ?? existing.sourcePrice;
      const forwardingCost = updates.forwardingCost ?? existing.forwardingCost;

      const patchExtra: { profit?: number; profitRate?: number } = {};
      if (ebayPriceJpy && sourcePrice) {
        const ebayFee = ebayPriceJpy * ((settings.ebayFeeRate ?? 13.25) / 100);
        const shipping = forwardingCost != null ? forwardingCost : (settings.shippingCost || 0);
        const other = settings.otherFees || 0;
        const profit = Math.round(ebayPriceJpy - ebayFee - shipping - other - sourcePrice);
        patchExtra.profit = profit;
        patchExtra.profitRate = parseFloat(((profit / ebayPriceJpy) * 100).toFixed(1));
      }

      const product = await storage.updateSavedProduct(req.params.id, { ...updates, ...patchExtra });

      // Side effects: run async after response
      setImmediate(async () => {
        try {
          if (!product || !settings.spreadsheetId) return;

          const prevStatus = existing.listingStatus;
          const newStatus = updates.listingStatus;

          // Auto-write to Mercari-eBay 在庫管理 when status changes to 出品中
          if (newStatus === "出品中" && prevStatus !== "出品中") {
            await appendToInventorySheet(
              settings.spreadsheetId,
              settings.inventorySheetName || "Mercari-eBay 在庫管理",
              {
                sourceUrl: product.sourceUrl,
                ebayUrl: product.ebayUrl,
                sourcePrice: product.sourcePrice,
                listingPrice: product.listingPrice ?? product.ebayPrice,
                profitRate: product.profitRate,
              }
            );
          }

          // Update セドリリスト row if already synced
          if (existing.syncedToSheets && existing.sheetRowIndex) {
            await updateProductInSheet(
              settings.spreadsheetId,
              settings.sheetName || "セドリリスト",
              existing.sheetRowIndex,
              {
                ...product,
                ebayFeeRate: settings.ebayFeeRate ?? 13.25,
                otherFees: settings.otherFees ?? 500,
                imageUrls: (product.ebayImageUrls?.length ? product.ebayImageUrls : product.sourceImageUrls) ?? [],
              }
            );
          }
        } catch (e) {
          console.error("Background sheet update error:", e);
        }
      });

      res.json(product);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/products/:id", async (req, res) => {
    try {
      const success = await storage.deleteSavedProduct(req.params.id);
      if (!success) return res.status(404).json({ error: "商品が見つかりません" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ---- Google Sheets Sync ----
  app.post("/api/sheets/sync/:productId", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      if (!settings.spreadsheetId) {
        return res.status(400).json({ error: "スプレッドシートIDが設定されていません" });
      }

      const product = await storage.getSavedProduct(req.params.productId);
      if (!product) return res.status(404).json({ error: "商品が見つかりません" });

      const sheetName = settings.sheetName || "セドリリスト";

      const extraFields = {
        ebayFeeRate: settings.ebayFeeRate ?? 13.25,
        otherFees: settings.otherFees ?? 500,
        imageUrls: (product.ebayImageUrls?.length ? product.ebayImageUrls : product.sourceImageUrls) ?? [],
      };
      if (product.syncedToSheets && product.sheetRowIndex) {
        // Update existing row
        await updateProductInSheet(settings.spreadsheetId, sheetName, product.sheetRowIndex, { ...product, ...extraFields });
        res.json({ success: true, message: "スプレッドシートを更新しました", updated: true });
      } else {
        // Append new row and store row index
        const rowIndex = await appendProductToSheet(settings.spreadsheetId, sheetName, { ...product, ...extraFields });
        await storage.updateSavedProduct(req.params.productId, {
          syncedToSheets: true,
          sheetRowIndex: rowIndex ?? undefined,
        });
        res.json({ success: true, message: "スプレッドシートに追加しました", rowIndex });
      }
    } catch (error: any) {
      console.error("Sheets sync error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/sheets/sync-all", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      if (!settings.spreadsheetId) {
        return res.status(400).json({ error: "スプレッドシートIDが設定されていません" });
      }

      const products = await storage.getSavedProducts();
      const sheetName = settings.sheetName || "セドリリスト";
      let synced = 0;
      let updated = 0;

      for (const product of products) {
        const extraFields = {
          ebayFeeRate: settings.ebayFeeRate ?? 13.25,
          otherFees: settings.otherFees ?? 500,
          imageUrls: (product.ebayImageUrls?.length ? product.ebayImageUrls : product.sourceImageUrls) ?? [],
        };
        if (product.syncedToSheets && product.sheetRowIndex) {
          // Update existing row
          await updateProductInSheet(settings.spreadsheetId, sheetName, product.sheetRowIndex, { ...product, ...extraFields });
          updated++;
        } else if (!product.syncedToSheets) {
          // Append new row
          const rowIndex = await appendProductToSheet(settings.spreadsheetId, sheetName, { ...product, ...extraFields });
          await storage.updateSavedProduct(product.id, {
            syncedToSheets: true,
            sheetRowIndex: rowIndex ?? undefined,
          });
          synced++;
        }
      }

      res.json({ success: true, synced, updated });
    } catch (error: any) {
      console.error("Sheets sync-all error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sheets/info", async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      if (!settings.spreadsheetId) {
        return res.status(400).json({ error: "スプレッドシートIDが設定されていません" });
      }
      const info = await getSpreadsheetInfo(settings.spreadsheetId);
      res.json(info);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Read spreadsheet products for import
  app.get("/api/sheets/list", async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      if (!settings.spreadsheetId) return res.status(400).json({ error: "スプレッドシートIDが設定されていません" });
      const rows = await readSheetProducts(settings.spreadsheetId, settings.sheetName || "セドリリスト");
      res.json({ rows });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/sheets/ensure-sheet", async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      if (!settings.spreadsheetId) {
        return res.status(400).json({ error: "スプレッドシートIDが設定されていません" });
      }
      await ensureSheetExists(settings.spreadsheetId, settings.sheetName || "セドリリスト");
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/sheets/update-headers", async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      if (!settings.spreadsheetId) {
        return res.status(400).json({ error: "スプレッドシートIDが設定されていません" });
      }
      await updateSheetHeaders(settings.spreadsheetId, settings.sheetName || "セドリリスト");
      res.json({ success: true, message: "ヘッダー行を更新しました" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ---- Listing Management ----

  // Competitor check: active eBay listings for same product
  app.get("/api/ebay/competitors", async (req, res) => {
    try {
      const { keywords, categoryId } = req.query as Record<string, string>;
      if (!keywords) return res.status(400).json({ error: "keywordsが必要です" });
      const settings = await storage.getSettings();
      const items = await searchEbayItems({
        keywords,
        categoryId: categoryId || undefined,
        limit: 20,
        exchangeRate: settings.exchangeRate || 150,
        sortOrder: "LOWEST_PRICE",
      });
      const prices = items.map(i => i.price).filter(p => p > 0);
      res.json({
        count: items.length,
        lowestPrice: prices.length ? Math.min(...prices) : null,
        highestPrice: prices.length ? Math.max(...prices) : null,
        avgPrice: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
        items: items.slice(0, 10),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "競合調査エラー" });
    }
  });

  // Item Specifics: fetch eBay item details via Browse API
  app.get("/api/ebay/item-specifics/:itemId", async (req, res) => {
    try {
      const { itemId } = req.params;
      const detail = await getEbayItemDetail(itemId);
      res.json(detail);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Item Specifics取得エラー" });
    }
  });

  // Generate listing description
  app.post("/api/generate-description", async (req, res) => {
    try {
      const { templateId, title, condition, specifics, additionalNotes } = req.body as {
        templateId?: string;
        title: string;
        condition: string;
        specifics?: Record<string, string>;
        additionalNotes?: string;
      };
      let templateText: string;
      if (templateId) {
        const tpl = await storage.getTemplate(templateId);
        templateText = tpl?.descriptionTemplate || "";
      } else {
        const templates = await storage.getTemplates();
        templateText = templates[0]?.descriptionTemplate || "{title}\n\nCondition: {condition}\n\n{specifics}";
      }
      const description = generateListingDescription(templateText, {
        title: title || "",
        condition: condition || "Used",
        specifics: specifics || {},
        additionalNotes,
      });
      res.json({ description });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "説明文生成エラー" });
    }
  });

  // Templates CRUD
  app.get("/api/templates", async (_req, res) => {
    const templates = await storage.getTemplates();
    res.json(templates);
  });

  app.post("/api/templates", async (req, res) => {
    try {
      const { name, category, descriptionTemplate, shippingInfo, returnPolicy } = req.body;
      if (!name || !descriptionTemplate) return res.status(400).json({ error: "name と descriptionTemplate は必須です" });
      const template = await storage.createTemplate({ name, category: category || "", descriptionTemplate, shippingInfo: shippingInfo || "", returnPolicy: returnPolicy || "" });
      res.json(template);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/templates/:id", async (req, res) => {
    try {
      const updated = await storage.updateTemplate(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: "テンプレートが見つかりません" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/templates/:id", async (req, res) => {
    try {
      const ok = await storage.deleteTemplate(req.params.id);
      if (!ok) return res.status(400).json({ error: "削除できません（デフォルトテンプレートは削除不可）" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ---- Settings ----
  app.get("/api/settings", async (_req, res) => {
    const settings = await storage.getSettings();
    res.json(settings);
  });

  app.put("/api/settings", async (req, res) => {
    try {
      const schema = z.object({
        spreadsheetId: z.string().optional(),
        sheetName: z.string().optional(),
        exchangeRate: z.number().optional(),
        ebayFeeRate: z.number().optional(),
        shippingCost: z.number().optional(),
        otherFees: z.number().optional(),
        forwardingDomesticShipping: z.number().optional(),
        forwardingAgentFee: z.number().optional(),
        forwardingIntlBase: z.number().optional(),
        forwardingIntlPerGram: z.number().optional(),
        inventorySheetName: z.string().optional(),
        // eBay seller account
        ebayUserToken: z.string().nullable().optional(),
        ebayDevId: z.string().nullable().optional(),
        ebayStoreName: z.string().nullable().optional(),
        ebayPaymentPolicy: z.string().nullable().optional(),
        ebayReturnPolicy: z.string().nullable().optional(),
        ebayShippingPolicy: z.string().nullable().optional(),
        ebayDispatchDays: z.number().int().optional(),
        ebayLocation: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

      const settings = await storage.updateSettings(parsed.data);
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ---- eBay Listing (Trading API) ----
  app.post("/api/ebay/list", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      if (!settings.ebayUserToken) {
        return res.status(400).json({ error: "eBay User Tokenが設定されていません。設定ページでトークンを入力してください。" });
      }

      const {
        title, description, categoryId, price, condition,
        specifics, imageUrls, weight, dispatchDays,
      } = req.body as {
        title: string;
        description: string;
        categoryId: string;
        price: number;
        condition: string;
        specifics?: Record<string, string>;
        imageUrls?: string[];
        weight?: number;
        dispatchDays?: number;
      };

      if (!title || !price || !categoryId) {
        return res.status(400).json({ error: "title, price, categoryId は必須です" });
      }

      const APP_ID = process.env.EBAY_APP_ID || "";
      const CERT_ID = process.env.EBAY_CERT_ID || "";
      const DEV_ID = settings.ebayDevId || "";
      const TOKEN = settings.ebayUserToken;

      // Map condition string to eBay condition ID
      const conditionMap: Record<string, { id: string; name: string }> = {
        "New": { id: "1000", name: "New" },
        "Like New": { id: "3000", name: "Like New" },
        "Very Good": { id: "4000", name: "Very Good" },
        "Good": { id: "5000", name: "Good" },
        "Acceptable": { id: "6000", name: "Acceptable" },
        "For Parts or Not Working": { id: "7000", name: "For Parts or Not Working" },
        "Used": { id: "3000", name: "Used" },
      };
      const condObj = conditionMap[condition] || { id: "3000", name: "Used" };

      // Build Item Specifics XML
      const nameValueList = specifics
        ? Object.entries(specifics).map(([k, v]) => `<NameValueList><Name>${k}</Name><Value>${v}</Value></NameValueList>`).join("")
        : "";

      // Build picture URLs XML
      const pictureUrls = (imageUrls || []).slice(0, 12).map(url => `<PictureURL>${url}</PictureURL>`).join("");

      const dispatchD = dispatchDays ?? settings.ebayDispatchDays ?? 3;
      const location = settings.ebayLocation || "Japan";

      const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${TOKEN}</eBayAuthToken>
  </RequesterCredentials>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <Title>${title.slice(0, 80)}</Title>
    <Description><![CDATA[${description}]]></Description>
    <PrimaryCategory>
      <CategoryID>${categoryId}</CategoryID>
    </PrimaryCategory>
    <StartPrice>${price.toFixed(2)}</StartPrice>
    <ConditionID>${condObj.id}</ConditionID>
    <ConditionDescription>${condObj.name}</ConditionDescription>
    <Country>JP</Country>
    <Location>${location}</Location>
    <Currency>USD</Currency>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <DispatchTimeMax>${dispatchD}</DispatchTimeMax>
    <Quantity>1</Quantity>
    ${pictureUrls ? `<PictureDetails>${pictureUrls}</PictureDetails>` : ""}
    <ItemSpecifics>${nameValueList}</ItemSpecifics>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <InternationalShippingServiceOption>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>StandardInternationalShipping</ShippingService>
        <ShippingServiceCost currencyID="USD">0.00</ShippingServiceCost>
        <ShipToLocation>Worldwide</ShipToLocation>
      </InternationalShippingServiceOption>
    </ShippingDetails>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>
    </ReturnPolicy>
  </Item>
</AddItemRequest>`;

      const apiRes = await fetch("https://api.ebay.com/ws/api.dll", {
        method: "POST",
        headers: {
          "Content-Type": "text/xml",
          "X-EBAY-API-CALL-NAME": "AddItem",
          "X-EBAY-API-SITEID": "0",
          "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
          "X-EBAY-API-APP-NAME": APP_ID,
          "X-EBAY-API-CERT-NAME": CERT_ID,
          "X-EBAY-API-DEV-NAME": DEV_ID,
        },
        body: xmlBody,
      });

      const xmlText = await apiRes.text();
      console.log("[eBay AddItem] Status:", apiRes.status, "Response snippet:", xmlText.slice(0, 400));

      // Parse key fields from XML response
      const itemIdMatch = xmlText.match(/<ItemID>(\d+)<\/ItemID>/);
      const ackMatch = xmlText.match(/<Ack>(\w+)<\/Ack>/);
      const errorMatch = xmlText.match(/<LongMessage>(.*?)<\/LongMessage>/);
      const feesMatch = xmlText.match(/<Fee>([0-9.]+)<\/Fee>/g);

      const ack = ackMatch?.[1];
      if (ack === "Failure" || ack === "PartialFailure") {
        const errMsg = errorMatch?.[1] || "eBay API エラー";
        console.error("[eBay AddItem] Error:", errMsg);
        return res.status(400).json({ error: errMsg, xmlResponse: xmlText.slice(0, 1000) });
      }

      const itemId = itemIdMatch?.[1];
      const ebayUrl = itemId ? `https://www.ebay.com/itm/${itemId}` : undefined;

      res.json({
        success: true,
        itemId,
        ebayUrl,
        ack,
        fees: feesMatch?.map(f => parseFloat(f.replace(/<\/?Fee>/g, ""))).filter(n => n > 0),
      });
    } catch (error: any) {
      console.error("[eBay AddItem] Exception:", error.message);
      res.status(500).json({ error: error.message || "eBay出品エラー" });
    }
  });

  // ---- Forwarding Cost Calculation ----
  app.post("/api/forwarding-cost", async (req, res) => {
    try {
      const { weight } = req.body as { weight: number };
      if (!weight || weight <= 0) return res.status(400).json({ error: "重量(g)を入力してください" });
      const settings = await storage.getSettings();
      const domestic = settings.forwardingDomesticShipping ?? 800;
      const agent = settings.forwardingAgentFee ?? 500;
      const intlBase = settings.forwardingIntlBase ?? 2000;
      const intlPerGram = settings.forwardingIntlPerGram ?? 3;
      const international = intlBase + Math.round(weight * intlPerGram);
      const total = domestic + agent + international;
      res.json({ domestic, agent, international, total, weight });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
