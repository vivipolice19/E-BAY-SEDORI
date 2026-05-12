// eBay API client - uses Browse API (OAuth) when Cert ID is available,
// falls back to Finding API (App ID only)
import type { EbayItem, EbaySoldResearchMeta } from "@shared/schema";
import { storage } from "./storage";

/** 空白のみの環境変数は無視し、設定画面の値にフォールバックする */
export function pickTrimmedCredential(
  envVal: string | undefined,
  stored: string | null | undefined,
): string {
  const fromEnv = (envVal ?? "").trim();
  if (fromEnv) return fromEnv;
  return (stored ?? "").trim();
}

async function resolveEbayApiCredentials(): Promise<{ appId: string; certId: string }> {
  const s = await storage.getSettings();
  return {
    appId: pickTrimmedCredential(process.env.EBAY_APP_ID, s.ebayAppId),
    certId: pickTrimmedCredential(process.env.EBAY_CERT_ID, s.ebayCertId),
  };
}

// OAuth token cache（資格情報が変わったら無効化）
let oauthCache: { credKey: string; token: string; expiresAt: number } | null = null;

async function getOAuthToken(): Promise<string | null> {
  const { appId, certId } = await resolveEbayApiCredentials();
  if (!appId || !certId) return null;

  const credKey = `${appId}\0${certId}`;
  if (oauthCache && oauthCache.credKey === credKey && oauthCache.expiresAt > Date.now() + 60000) {
    return oauthCache.token;
  }

  try {
    const credentials = Buffer.from(`${appId}:${certId}`).toString("base64");
    const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    });

    if (!res.ok) {
      console.error("eBay OAuth error:", await res.text());
      return null;
    }

    const data = await res.json();
    oauthCache = {
      credKey,
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return oauthCache.token;
  } catch (err) {
    console.error("OAuth token fetch failed:", err);
    return null;
  }
}

export interface EbaySearchOptions {
  keywords: string;
  categoryId?: string;
  sortOrder?: "BEST_MATCH" | "LOWEST_PRICE" | "HIGHEST_PRICE" | "NEWLY_LISTED" | "BestMatch" | "PricePlusShippingLowest" | "PricePlusShippingHighest" | "StartTimeNewest";
  minPrice?: number;
  maxPrice?: number;
  condition?: "New" | "Used" | "Unspecified";
  listingType?: "Auction" | "FixedPrice" | "All";
  limit?: number;
  exchangeRate?: number;
  /** Filter items listed within the last N days (0 = no filter) */
  daysListed?: number;
  /** Pagination offset (Browse API) or page number (Finding API) */
  offset?: number;
  /**
   * findCompletedItems: 落札終了時刻がこの日数より新しいものだけ（0 = フィルタなし）
   * 直近の相場に寄せて信頼性を上げる
   */
  soldEndedWithinDays?: number;
}

export interface EbaySoldSearchResult {
  items: EbayItem[];
  meta: EbaySoldResearchMeta;
}

function medianSorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** タイトルがほぼ同じ出品の二重カウントを減らす */
function dedupeSoldItemsByTitle(items: EbayItem[]): { items: EbayItem[]; removed: number } {
  const seen = new Set<string>();
  const out: EbayItem[] = [];
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 88);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return { items: out, removed: items.length - out.length };
}

function soldReliability(dedupedCount: number): EbaySoldResearchMeta["reliability"] {
  if (dedupedCount >= 12) return "high";
  if (dedupedCount >= 6) return "medium";
  return "low";
}

// Browse API search (requires OAuth)
async function searchViaBrowseApi(options: EbaySearchOptions, token: string): Promise<EbayItem[]> {
  const {
    keywords,
    sortOrder = "BEST_MATCH",
    minPrice,
    maxPrice,
    condition,
    limit = 20,
    exchangeRate = 150,
    categoryId,
    daysListed,
    offset = 0,
  } = options;

  // Map Finding API sort to Browse API sort
  const sortMap: Record<string, string> = {
    BestMatch: "BEST_MATCH",
    PricePlusShippingLowest: "LOWEST_PRICE",
    PricePlusShippingHighest: "HIGHEST_PRICE",
    StartTimeNewest: "NEWLY_LISTED",
    BEST_MATCH: "BEST_MATCH",
    LOWEST_PRICE: "LOWEST_PRICE",
    HIGHEST_PRICE: "HIGHEST_PRICE",
    NEWLY_LISTED: "NEWLY_LISTED",
  };

  const params = new URLSearchParams({
    sort: sortMap[sortOrder] || "BEST_MATCH",
    limit: String(Math.min(limit, 50)),
    offset: String(offset),
  });

  // eBay Browse API requires q to be non-empty if provided
  if (keywords && keywords.trim()) params.set("q", keywords.trim());
  if (categoryId) params.append("category_ids", categoryId);

  const filters: string[] = [];
  if (minPrice !== undefined) filters.push(`price:[${minPrice}]`);
  if (maxPrice !== undefined) filters.push(`price:[..${maxPrice}]`);
  if (minPrice !== undefined && maxPrice !== undefined) {
    filters.pop(); filters.pop();
    filters.push(`price:[${minPrice}..${maxPrice}]`);
  }
  if (condition === "New") filters.push("conditionIds:{1000}");
  if (condition === "Used") filters.push("conditionIds:{3000|4000|5000|6000|7000}");
  if (daysListed && daysListed > 0) {
    const fromDate = new Date(Date.now() - daysListed * 24 * 60 * 60 * 1000).toISOString();
    filters.push(`itemStartDate:[${fromDate}]`);
  }

  if (filters.length > 0) params.append("filter", filters.join(","));

  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`eBay Browse API error: ${res.status} - ${err}`);
  }

  const data = await res.json();
  const items = data.itemSummaries || [];

  if (items.length > 0) {
    const sample = items[0];
    console.log("[Browse API] sample item:", {
      title: sample.title?.slice(0, 50),
      price: sample.price,
      currentBidPrice: sample.currentBidPrice,
      buyingOptions: sample.buyingOptions,
      currency: sample.price?.currency,
    });
  }

  return items.map((item: any): EbayItem => {
    const isAuction = item.buyingOptions?.includes("AUCTION") && !item.buyingOptions?.includes("FIXED_PRICE");
    // For auctions: prefer currentBidPrice (active bid) over price (minimum bid)
    const priceSource = isAuction && item.currentBidPrice
      ? item.currentBidPrice
      : item.price;
    const rawCurrency: string = priceSource?.currency || "USD";
    const priceValue = parseFloat(priceSource?.value || item.price?.value || "0");
    // Warn if currency is not USD (we currently only handle USD→JPY)
    if (rawCurrency !== "USD") {
      console.warn(`[Browse API] Non-USD currency detected: ${rawCurrency} for item ${item.itemId}`);
    }
    // Detect variation items: Browse API itemId format is "v1|listingId|variationId"
    const idParts = (item.itemId || "").split("|");
    const variationId = idParts[2];
    const hasVariations = !!(variationId && variationId !== "0");

    return {
      itemId: item.itemId || "",
      title: item.title || "",
      price: priceValue,
      currency: priceSource?.currency || "USD",
      priceJpy: Math.round(priceValue * exchangeRate),
      imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl,
      itemUrl: item.itemWebUrl || item.itemAffiliateWebUrl || "",
      condition: item.condition || "Unknown",
      category: item.categories?.[0]?.categoryName || "",
      location: item.itemLocation?.country || "",
      soldCount: undefined,
      watchCount: undefined,
      listingType: isAuction ? "Auction" : "FixedPrice",
      hasVariations,
    };
  });
}

// Finding API search (App ID only - fallback)
async function searchViaFindingApi(options: EbaySearchOptions): Promise<EbayItem[]> {
  const {
    keywords,
    sortOrder = "BestMatch",
    minPrice,
    maxPrice,
    condition,
    listingType = "All",
    limit = 20,
    exchangeRate = 150,
    categoryId,
    daysListed,
    offset = 0,
  } = options;

  const { appId } = await resolveEbayApiCredentials();
  if (!appId) {
    throw new Error("eBay App ID が未設定です。設定画面の「eBay API（検索用）」または環境変数 EBAY_APP_ID を設定してください。");
  }

  const FINDING_API = "https://svcs.ebay.com/services/search/FindingService/v1";
  // Finding API uses 1-based page numbers; each page has `limit` items
  const pageNumber = Math.floor(offset / limit) + 1;

  const params = new URLSearchParams({
    "OPERATION-NAME": "findItemsByKeywords",
    "SERVICE-VERSION": "1.0.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    "REST-PAYLOAD": "",
    keywords,
    sortOrder: (sortOrder as string).replace("BEST_MATCH", "BestMatch").replace("LOWEST_PRICE", "PricePlusShippingLowest").replace("HIGHEST_PRICE", "PricePlusShippingHighest").replace("NEWLY_LISTED", "StartTimeNewest"),
    "paginationInput.entriesPerPage": String(limit),
    "paginationInput.pageNumber": String(pageNumber),
    "outputSelector(0)": "SellingStatus",
    "outputSelector(1)": "PictureURLSuperSize",
  });

  let filterIdx = 0;
  if (minPrice !== undefined) {
    params.append(`itemFilter(${filterIdx}).name`, "MinPrice");
    params.append(`itemFilter(${filterIdx}).value`, String(minPrice));
    params.append(`itemFilter(${filterIdx}).paramName`, "Currency");
    params.append(`itemFilter(${filterIdx}).paramValue`, "USD");
    filterIdx++;
  }
  if (maxPrice !== undefined) {
    params.append(`itemFilter(${filterIdx}).name`, "MaxPrice");
    params.append(`itemFilter(${filterIdx}).value`, String(maxPrice));
    params.append(`itemFilter(${filterIdx}).paramName`, "Currency");
    params.append(`itemFilter(${filterIdx}).paramValue`, "USD");
    filterIdx++;
  }
  if (condition && condition !== "Unspecified") {
    params.append(`itemFilter(${filterIdx}).name`, "Condition");
    params.append(`itemFilter(${filterIdx}).value`, condition === "New" ? "1000" : "3000");
    filterIdx++;
  }
  if (listingType !== "All") {
    params.append(`itemFilter(${filterIdx}).name`, "ListingType");
    params.append(`itemFilter(${filterIdx}).value`, listingType);
    filterIdx++;
  }
  if (daysListed && daysListed > 0) {
    const fromDate = new Date(Date.now() - daysListed * 24 * 60 * 60 * 1000).toISOString();
    params.append(`itemFilter(${filterIdx}).name`, "StartTimeFrom");
    params.append(`itemFilter(${filterIdx}).value`, fromDate);
    filterIdx++;
  }
  if (categoryId) params.append("categoryId", categoryId);

  const res = await fetch(`${FINDING_API}?${params}`);
  if (!res.ok) throw new Error(`eBay Finding API error: ${res.status}`);

  const data = await res.json();
  const response = data?.findItemsByKeywordsResponse?.[0];

  if (response?.ack?.[0] !== "Success" && response?.ack?.[0] !== "Warning") {
    const errMsg = response?.errorMessage?.[0]?.error?.[0]?.message?.[0] || "eBay API error";
    throw new Error(errMsg);
  }

  const items = response?.searchResult?.[0]?.item || [];
  return items.map((item: any): EbayItem => {
    const price = parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || "0");
    // eBay Finding API returns "Chinese" for auction, "FixedPrice"/"StoreInventory" for BIN
    const rawType: string = item?.listingInfo?.[0]?.listingType?.[0] || "";
    const isAuction = rawType === "Chinese" || rawType === "Dutch";
    return {
      itemId: item?.itemId?.[0] || "",
      title: item?.title?.[0] || "",
      price,
      currency: "USD",
      priceJpy: Math.round(price * exchangeRate),
      imageUrl: item?.pictureURLSuperSize?.[0] || item?.galleryURL?.[0],
      itemUrl: item?.viewItemURL?.[0] || "",
      condition: item?.condition?.[0]?.conditionDisplayName?.[0] || "Unknown",
      category: item?.primaryCategory?.[0]?.categoryName?.[0] || "",
      location: item?.location?.[0] || "",
      listingType: isAuction ? "Auction" : "FixedPrice",
    };
  });
}

// Main search function - tries Browse API first, falls back to Finding API
export async function searchEbayItems(options: EbaySearchOptions): Promise<EbayItem[]> {
  const token = await getOAuthToken();

  // For category-only search (no keyword), use popular items endpoint
  if (!options.keywords && options.categoryId) {
    return findPopularItems(options.categoryId, options.exchangeRate, options.limit, options.daysListed);
  }

  if (token) {
    try {
      console.log("Using eBay Browse API (OAuth)");
      return await searchViaBrowseApi(options, token);
    } catch (err) {
      console.warn("Browse API failed, falling back to Finding API:", err);
    }
  }

  console.log("Using eBay Finding API (App ID only)");
  return await searchViaFindingApi(options);
}

export async function findPopularItems(categoryId: string, exchangeRate = 150, limit = 20, daysListed = 0, offset = 0): Promise<EbayItem[]> {
  const token = await getOAuthToken();

  // Rotate sort strategies based on offset to maximize variety:
  // offset 0,80,160... → BEST_MATCH, offset 20,100,180... → NEWLY_LISTED,
  // offset 40,120... → HIGHEST_PRICE, offset 60,140... → LOWEST_PRICE
  const sortStrategies: Array<"BEST_MATCH" | "NEWLY_LISTED" | "HIGHEST_PRICE" | "LOWEST_PRICE"> =
    ["BEST_MATCH", "NEWLY_LISTED", "HIGHEST_PRICE", "LOWEST_PRICE"];
  const sortStrategy = sortStrategies[Math.floor(offset / 20) % sortStrategies.length];

  if (token) {
    try {
      const result = await searchViaBrowseApi({
        keywords: "",
        categoryId,
        sortOrder: sortStrategy,
        limit,
        exchangeRate,
        daysListed,
        offset,
      }, token);
      return result;
    } catch (err) {
      console.warn(`[findPopularItems] Browse API failed, falling back to Finding API`);
    }
  }

  // Finding API by category
  const { appId } = await resolveEbayApiCredentials();
  if (!appId) {
    throw new Error("eBay App ID が未設定です。設定画面の「eBay API（検索用）」または環境変数 EBAY_APP_ID を設定してください。");
  }

  const FINDING_API = "https://svcs.ebay.com/services/search/FindingService/v1";
  const pageNumber = Math.floor(offset / limit) + 1;
  const findingSortMap: Record<string, string> = {
    BEST_MATCH: "BestMatch", NEWLY_LISTED: "StartTimeNewest",
    HIGHEST_PRICE: "CurrentPriceHighest", LOWEST_PRICE: "PricePlusShippingLowest",
  };
  const params = new URLSearchParams({
    "OPERATION-NAME": "findItemsByCategory",
    "SERVICE-VERSION": "1.0.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    "REST-PAYLOAD": "",
    categoryId,
    sortOrder: findingSortMap[sortStrategy] || "BestMatch",
    "paginationInput.entriesPerPage": String(limit),
    "paginationInput.pageNumber": String(pageNumber),
    "outputSelector(0)": "SellingStatus",
    "outputSelector(1)": "PictureURLSuperSize",
  });
  if (daysListed > 0) {
    const fromDate = new Date(Date.now() - daysListed * 24 * 60 * 60 * 1000).toISOString();
    params.append("itemFilter(0).name", "StartTimeFrom");
    params.append("itemFilter(0).value", fromDate);
  }

  const res = await fetch(`${FINDING_API}?${params}`);
  if (!res.ok) throw new Error(`eBay API error: ${res.status}`);
  const data = await res.json();
  const items = data?.findItemsByCategoryResponse?.[0]?.searchResult?.[0]?.item || [];

  console.log(`[findPopularItems] Finding API returned ${items.length} items for category ${categoryId}`);
  if (items.length > 0) {
    const s = items[0];
    console.log("[findPopularItems] sample:", {
      title: s?.title?.[0]?.slice(0, 50),
      currentPrice: s?.sellingStatus?.[0]?.currentPrice?.[0],
      listingType: s?.listingInfo?.[0]?.listingType?.[0],
    });
  }

  return items.map((item: any): EbayItem => {
    const price = parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || "0");
    const rawType: string = item?.listingInfo?.[0]?.listingType?.[0] || "";
    const isAuction = rawType === "Chinese" || rawType === "Dutch";
    return {
      itemId: item?.itemId?.[0] || "",
      title: item?.title?.[0] || "",
      price,
      currency: item?.sellingStatus?.[0]?.currentPrice?.[0]?.__currencyId__ || "USD",
      priceJpy: Math.round(price * exchangeRate),
      imageUrl: item?.pictureURLSuperSize?.[0] || item?.galleryURL?.[0],
      itemUrl: item?.viewItemURL?.[0] || "",
      condition: item?.condition?.[0]?.conditionDisplayName?.[0] || "Unknown",
      category: item?.primaryCategory?.[0]?.categoryName?.[0] || "",
      location: item?.location?.[0] || "",
      listingType: isAuction ? "Auction" : "FixedPrice",
    };
  });
}

// Search completed (sold) listings via Finding API findCompletedItems
export async function searchSoldItems(options: EbaySearchOptions): Promise<EbaySoldSearchResult> {
  const {
    keywords,
    categoryId,
    limit = 20,
    exchangeRate = 150,
    minPrice,
    maxPrice,
    condition,
    offset = 0,
    soldEndedWithinDays = 90,
  } = options;
  const { appId } = await resolveEbayApiCredentials();
  if (!appId) {
    throw new Error("eBay App ID が未設定です。設定画面の「eBay API（検索用）」または環境変数 EBAY_APP_ID を設定してください。");
  }

  const FINDING_API = "https://svcs.ebay.com/services/search/FindingService/v1";
  const pageSize = Math.min(Math.max(1, limit), 100);
  const pageNumber = Math.floor(offset / pageSize) + 1;

  const params = new URLSearchParams({
    "OPERATION-NAME": "findCompletedItems",
    "SERVICE-VERSION": "1.0.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    "REST-PAYLOAD": "",
    keywords: keywords || "",
    sortOrder: "EndTimeLatest",
    "paginationInput.entriesPerPage": String(pageSize),
    "paginationInput.pageNumber": String(pageNumber),
    "outputSelector(0)": "SellingStatus",
    "outputSelector(1)": "PictureURLSuperSize",
    "itemFilter(0).name": "SoldItemsOnly",
    "itemFilter(0).value": "true",
  });

  if (categoryId) params.append("categoryId", categoryId);

  let filterIdx = 1;
  if (soldEndedWithinDays > 0) {
    const fromDate = new Date(Date.now() - soldEndedWithinDays * 24 * 60 * 60 * 1000).toISOString();
    params.append(`itemFilter(${filterIdx}).name`, "SoldItemsEndTimeFrom");
    params.append(`itemFilter(${filterIdx}).value`, fromDate);
    filterIdx++;
  }
  if (minPrice !== undefined) {
    params.append(`itemFilter(${filterIdx}).name`, "MinPrice");
    params.append(`itemFilter(${filterIdx}).value`, String(minPrice));
    params.append(`itemFilter(${filterIdx}).paramName`, "Currency");
    params.append(`itemFilter(${filterIdx}).paramValue`, "USD");
    filterIdx++;
  }
  if (maxPrice !== undefined) {
    params.append(`itemFilter(${filterIdx}).name`, "MaxPrice");
    params.append(`itemFilter(${filterIdx}).value`, String(maxPrice));
    params.append(`itemFilter(${filterIdx}).paramName`, "Currency");
    params.append(`itemFilter(${filterIdx}).paramValue`, "USD");
    filterIdx++;
  }
  if (condition && condition !== "Unspecified") {
    params.append(`itemFilter(${filterIdx}).name`, "Condition");
    params.append(`itemFilter(${filterIdx}).value`, condition === "New" ? "1000" : "3000");
    filterIdx++;
  }

  const res = await fetch(`${FINDING_API}?${params}`);
  const data = await res.json();

  if (!res.ok) {
    // Extract error message from eBay's JSON even on HTTP 500
    const errMsg = data?.errorMessage?.[0]?.error?.[0]?.message?.[0]
      || data?.findCompletedItemsResponse?.[0]?.errorMessage?.[0]?.error?.[0]?.message?.[0]
      || `eBay API error: ${res.status}`;
    const errId = data?.errorMessage?.[0]?.error?.[0]?.errorId?.[0];
    if (errId === "10001") throw new Error("eBay APIのレート制限に達しました。しばらく後でお試しください。");
    throw new Error(errMsg);
  }

  const response = data?.findCompletedItemsResponse?.[0];

  if (response?.ack?.[0] !== "Success" && response?.ack?.[0] !== "Warning") {
    const errMsg = response?.errorMessage?.[0]?.error?.[0]?.message?.[0] || "eBay completed items API error";
    throw new Error(errMsg);
  }

  const rawItems = response?.searchResult?.[0]?.item || [];
  console.log(`[findCompletedItems] raw ${rawItems.length} sold items for "${keywords}" (window=${soldEndedWithinDays || "all"}d)`);

  const mapped: EbayItem[] = rawItems.map((item: any): EbayItem => {
    const price = parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || "0");
    const rawType: string = item?.listingInfo?.[0]?.listingType?.[0] || "";
    const isAuction = rawType === "Chinese" || rawType === "Dutch";

    const startTimeStr: string = item?.listingInfo?.[0]?.startTime?.[0] || "";
    const endTimeStr: string = item?.listingInfo?.[0]?.endTime?.[0] || "";
    let daysToSell: number | undefined;
    if (startTimeStr && endTimeStr) {
      const start = new Date(startTimeStr).getTime();
      const end = new Date(endTimeStr).getTime();
      if (!isNaN(start) && !isNaN(end) && end > start) {
        daysToSell = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
      }
    }

    return {
      itemId: item?.itemId?.[0] || "",
      title: item?.title?.[0] || "",
      price,
      currency: item?.sellingStatus?.[0]?.currentPrice?.[0]?.__currencyId__ || "USD",
      priceJpy: Math.round(price * exchangeRate),
      imageUrl: item?.pictureURLSuperSize?.[0] || item?.galleryURL?.[0],
      itemUrl: item?.viewItemURL?.[0] || "",
      condition: item?.condition?.[0]?.conditionDisplayName?.[0] || "Unknown",
      category: item?.primaryCategory?.[0]?.categoryName?.[0] || "",
      location: item?.location?.[0] || "",
      listingType: isAuction ? "Auction" : "FixedPrice",
      hasVariations: false,
      daysToSell,
    };
  });

  const { items: deduped, removed } = dedupeSoldItemsByTitle(mapped);
  const jpyPrices = deduped.map((i) => i.priceJpy).filter((p) => p > 0);
  const usdPrices = deduped.map((i) => i.price).filter((p) => p > 0);
  const sortedJpy = [...jpyPrices].sort((a, b) => a - b);
  const sortedUsd = [...usdPrices].sort((a, b) => a - b);

  const meta: EbaySoldResearchMeta = {
    windowDays: soldEndedWithinDays > 0 ? soldEndedWithinDays : 0,
    requestedLimit: pageSize,
    returnedRaw: mapped.length,
    returnedAfterDedupe: deduped.length,
    duplicatesRemoved: removed,
    medianPriceJpy: medianSorted(sortedJpy),
    medianPriceUsd: medianSorted(sortedUsd),
    reliability: soldReliability(deduped.length),
  };

  return { items: deduped, meta };
}

export interface EbayUrlResult {
  type: "item" | "search";
  keywords: string;
  // Single item
  itemId?: string;
  title?: string;
  price?: number;
  currency?: string;
  priceJpy?: number;
  itemUrl?: string;
  imageUrl?: string;
  weightG?: number; // extracted from Item Specifics (grams)
  mpn?: string; // MPN / Model Number from Item Specifics
  /** Browse API + HTML フォールバック由来（出品・シート X〜AD 用） */
  listingTitle?: string;
  ebayCondition?: string;
  ebayCategoryId?: string;
  ebayCategoryPath?: string;
  listingDescription?: string;
  listingItemSpecifics?: string; // JSON string of itemSpecifics map
  ebayImageUrls?: string[];
  // Market data (sold comps) for item URL
  marketCount?: number;
  marketAvgJpy?: number;
  marketMinJpy?: number;
  marketMaxJpy?: number;
  marketAvgDaysToSell?: number;
  // Search / sold statistics
  count?: number;
  avgJpy?: number;
  minJpy?: number;
  maxJpy?: number;
  avgDaysToSell?: number;
  soldItems?: { title: string; price: number; priceJpy: number; imageUrl?: string; itemUrl: string; daysToSell?: number }[];
}

// Fetch item details via Browse API getItem
async function getItemById(itemId: string, exchangeRate: number): Promise<EbayItem | null> {
  const token = await getOAuthToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.ebay.com/buy/browse/v1/item/v1|${itemId}|0`, {
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
    });
    if (!res.ok) return null;
    const d = await res.json();
    const price = parseFloat(d?.price?.value || "0");
    return {
      itemId: d.itemId || itemId,
      title: d.title || "",
      price,
      currency: d?.price?.currency || "USD",
      priceJpy: Math.round(price * exchangeRate),
      imageUrl: d?.image?.imageUrl,
      itemUrl: d.itemWebUrl || `https://www.ebay.com/itm/${itemId}`,
      condition: d.condition || "Unknown",
      category: d?.primaryItemGroup?.itemGroupTitle || "",
      location: d?.itemLocation?.country || "",
      listingType: d?.buyingOptions?.includes("AUCTION") ? "Auction" : "FixedPrice",
      hasVariations: false,
    };
  } catch { return null; }
}

// Fetch ALL images for an eBay item via Browse API getItem
export async function getEbayItemImages(itemId: string): Promise<string[]> {
  const token = await getOAuthToken();
  if (!token) {
    console.warn("[getEbayItemImages] No OAuth token available");
    return [];
  }
  try {
    // Strip v1|...|... format if present - extract numeric ID
    const numericId = itemId.replace(/^v1\|(\d+)\|.*/, "$1").replace(/\D/g, "") || itemId;
    const res = await fetch(`https://api.ebay.com/buy/browse/v1/item/v1|${numericId}|0`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });
    if (!res.ok) {
      console.warn(`[getEbayItemImages] Failed: ${res.status}`);
      return [];
    }
    const d = await res.json();
    const images: string[] = [];
    // Main image
    if (d?.image?.imageUrl) images.push(d.image.imageUrl);
    // Additional images
    if (Array.isArray(d?.additionalImages)) {
      for (const img of d.additionalImages) {
        if (img?.imageUrl && !images.includes(img.imageUrl)) {
          images.push(img.imageUrl);
        }
      }
    }
    console.log(`[getEbayItemImages] Found ${images.length} images for item ${numericId}`);
    return images;
  } catch (err) {
    console.error("[getEbayItemImages] Error:", err);
    return [];
  }
}

/** Item Specifics の重量表記をグラムに正規化（「30g」が kg 扱いで 30000 になる誤りを防ぐ） */
function parseEbayWeightSpecificToGrams(raw: string): number | undefined {
  const val = raw.trim();
  if (!val || /^does not apply$/i.test(val) || val === "N/A") return undefined;

  const lower = val.toLowerCase().replace(/,/g, "");
  const numTok = val.replace(/,/g, "").match(/[\d.]+/);
  if (!numTok) return undefined;
  const n = parseFloat(numTok[0]);
  if (!Number.isFinite(n) || n <= 0) return undefined;

  if (/\bkg\b|キログラム|キロ\b/.test(val) || lower.includes("kilogram")) return Math.round(n * 1000);
  if (/\blb\b|lbs|\bpounds?\b/.test(lower)) return Math.round(n * 453.592);
  if (/\boz\b|\bounces?\b/.test(lower)) return Math.round(n * 28.3495);
  if (/\bmg\b|ミリグラム/.test(lower)) return Math.max(1, Math.round(n / 1000));
  if (lower.includes("gram") || lower.includes("グラム")) return Math.round(n);
  if (lower.includes("g") && !lower.includes("kg")) return Math.round(n);

  // 単位なし: eBay の Item Specifics は数値のみでもグラムが多い（×1000 は誤爆のため使わない）
  if (n <= 80_000) return Math.round(n);
  return Math.round(n);
}

function extractWeightGramsFromItemSpecifics(specifics: Record<string, string>): number | undefined {
  const keyNeedles = [
    "item weight",
    "product weight",
    "net weight",
    "gross weight",
    "unit weight",
    "package weight",
    "weight",
    "商品の重量",
    "重量",
  ];
  const skipKey = /width|height|length|depth|dimension|screen size|画面サイズ|長さ|幅|高さ|奥行/i;

  const entries = Object.entries(specifics);
  const score = (key: string) => {
    const kl = key.toLowerCase();
    let s = 0;
    if (/item weight|商品の重量|product weight/i.test(key)) s += 20;
    else if (/net weight|unit weight/i.test(kl)) s += 15;
    else if (/gross weight|package weight/i.test(kl)) s += 10;
    else if (keyNeedles.some((n) => kl.includes(n))) s += 5;
    return s;
  };

  const candidates: { key: string; val: string; grams: number; sc: number }[] = [];
  for (const [key, val] of entries) {
    if (!val?.trim() || skipKey.test(key)) continue;
    const kl = key.toLowerCase();
    if (!keyNeedles.some((needle) => kl.includes(needle))) continue;
    const grams = parseEbayWeightSpecificToGrams(val);
    if (grams !== undefined && grams > 0 && grams < 500_000) {
      candidates.push({ key, val, grams, sc: score(key) });
    }
  }
  candidates.sort((a, b) => b.sc - a.sc);
  return candidates[0]?.grams;
}

export async function fetchEbayUrlData(ebayUrl: string, exchangeRate = 150): Promise<EbayUrlResult> {
  let parsedUrl: URL;
  try { parsedUrl = new URL(ebayUrl); } catch { throw new Error("URLの形式が正しくありません"); }

  const pathname = parsedUrl.pathname;
  const params = parsedUrl.searchParams;

  // ---- Item URL: /itm/ITEMID or /itm/Title/ITEMID ----
  const itmMatch = pathname.match(/\/itm\/(?:[^/]+\/)?(\d{10,})/);
  if (itmMatch) {
    const itemId = itmMatch[1];
    const item = await getItemById(itemId, exchangeRate);
    if (!item) throw new Error("商品情報を取得できませんでした（Browse API）");

    // Concurrently fetch item specifics (for weight) and sold comps (for market data)
    const [detail, soldItems] = await Promise.allSettled([
      getEbayItemDetail(`v1|${itemId}|0`).catch(() => null),
      searchSoldItems({ keywords: item.title.slice(0, 60), limit: 30, exchangeRate, soldEndedWithinDays: 90 }).catch(
        (): EbaySoldSearchResult => ({
          items: [],
          meta: {
            windowDays: 90,
            requestedLimit: 30,
            returnedRaw: 0,
            returnedAfterDedupe: 0,
            duplicatesRemoved: 0,
            medianPriceJpy: null,
            medianPriceUsd: null,
            reliability: "low",
          },
        }),
      ),
    ]);

    // Extract weight from Item Specifics（キーは API の言語で変わるため部分一致で集約）
    const specifics = detail.status === "fulfilled" && detail.value ? detail.value.itemSpecifics : {};
    const weightG = extractWeightGramsFromItemSpecifics(specifics);

    // Extract MPN / Model Number from Item Specifics
    const mpnKeys = ["MPN", "Model", "Model Number", "Part Number", "Manufacturer Part Number", "モデル", "型番"];
    let mpn: string | undefined;
    for (const key of mpnKeys) {
      const val = specifics[key];
      if (val && val !== "Does Not Apply" && val !== "N/A" && val.trim()) {
        mpn = val.trim();
        break;
      }
    }

    // Market data from sold comps
    const sold =
      soldItems.status === "fulfilled"
        ? (soldItems.value as EbaySoldSearchResult).items
        : [];
    const soldPrices = sold.map(i => i.priceJpy).filter(p => p > 0);
    const marketAvgJpy = soldPrices.length ? Math.round(soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length) : undefined;
    const marketMinJpy = soldPrices.length ? Math.min(...soldPrices) : undefined;
    const marketMaxJpy = soldPrices.length ? Math.max(...soldPrices) : undefined;
    const daysToSellList = sold.map(i => i.daysToSell).filter((d): d is number => d !== undefined);
    const marketAvgDaysToSell = daysToSellList.length ? Math.round(daysToSellList.reduce((a, b) => a + b, 0) / daysToSellList.length) : undefined;

    let listingTitle: string | undefined;
    let ebayCondition: string | undefined;
    let ebayCategoryId: string | undefined;
    let ebayCategoryPath: string | undefined;
    let listingDescription: string | undefined;
    let listingItemSpecifics: string | undefined;
    let ebayImageUrls: string[] | undefined;

    if (detail.status === "fulfilled" && detail.value) {
      const d = detail.value;
      listingTitle = d.title || item.title;
      if (d.condition) {
        ebayCondition = typeof d.condition === "string" ? d.condition : String(d.condition);
      }
      ebayCategoryId = d.categoryId;
      ebayCategoryPath = d.categoryPath;
      if (d.description) {
        const plain = stripHtmlTags(String(d.description)).trim();
        listingDescription = plain.length > 12_000 ? plain.slice(0, 12_000) : plain;
      }
      if (d.itemSpecifics && Object.keys(d.itemSpecifics).length > 0) {
        try {
          listingItemSpecifics = JSON.stringify(d.itemSpecifics);
        } catch {
          /* ignore */
        }
      }
      const imgs: string[] = [];
      if (d.imageUrl) imgs.push(d.imageUrl);
      if (Array.isArray(d.additionalImages)) {
        for (const u of d.additionalImages) {
          if (typeof u === "string" && u.startsWith("http") && !imgs.includes(u)) imgs.push(u);
        }
      }
      if (imgs.length > 0) ebayImageUrls = imgs;
    }

    return {
      type: "item",
      itemId,
      keywords: item.title,
      title: item.title,
      price: item.price,
      currency: item.currency,
      priceJpy: item.priceJpy,
      itemUrl: item.itemUrl,
      imageUrl: item.imageUrl,
      weightG,
      mpn,
      listingTitle,
      ebayCondition,
      ebayCategoryId,
      ebayCategoryPath,
      listingDescription,
      listingItemSpecifics,
      ebayImageUrls,
      marketCount: soldPrices.length,
      marketAvgJpy,
      marketMinJpy,
      marketMaxJpy,
      marketAvgDaysToSell,
    };
  }

  // ---- Search URL: /sch/... ----
  const keywords = params.get("_nkw") || params.get("_nkw") || "";
  const categoryId = params.get("_sacat") && params.get("_sacat") !== "0" ? params.get("_sacat")! : undefined;
  const isSold = params.get("LH_Sold") === "1" || params.get("LH_Complete") === "1";
  const minPrice = params.get("_udlo") ? parseFloat(params.get("_udlo")!) : undefined;
  const maxPrice = params.get("_udhi") ? parseFloat(params.get("_udhi")!) : undefined;

  if (!keywords && !categoryId) throw new Error("URLからキーワードを取得できませんでした");

  let items: EbayItem[];
  if (isSold) {
    try {
      items = (await searchSoldItems({ keywords, categoryId, limit: 40, exchangeRate, minPrice, maxPrice, soldEndedWithinDays: 90 })).items;
    } catch (err: any) {
      // If rate-limited, fall back to active listings via Browse API
      if (err.message?.includes("レート制限") || err.message?.includes("rate") || err.message?.includes("10001")) {
        console.warn("[fetchEbayUrlData] findCompletedItems rate-limited, falling back to Browse API");
        items = await searchEbayItems({ keywords, categoryId, limit: 40, exchangeRate, minPrice, maxPrice });
      } else {
        throw err;
      }
    }
  } else {
    items = await searchEbayItems({ keywords, categoryId, limit: 40, exchangeRate, minPrice, maxPrice });
  }

  if (items.length === 0) {
    return { type: "search", keywords, count: 0 };
  }

  const prices = items.map(i => i.priceJpy).filter(p => p > 0);
  const avgJpy = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
  const minJpy = prices.length ? Math.min(...prices) : 0;
  const maxJpy = prices.length ? Math.max(...prices) : 0;

  const daysToSellList = items.map(i => i.daysToSell).filter((d): d is number => d !== undefined);
  const avgDaysToSell = daysToSellList.length > 0
    ? Math.round(daysToSellList.reduce((a, b) => a + b, 0) / daysToSellList.length)
    : undefined;

  return {
    type: "search",
    keywords,
    count: items.length,
    avgJpy,
    minJpy,
    maxJpy,
    avgDaysToSell,
    soldItems: items.slice(0, 6).map(i => ({
      title: i.title,
      price: i.price,
      priceJpy: i.priceJpy,
      imageUrl: i.imageUrl,
      itemUrl: i.itemUrl,
      daysToSell: i.daysToSell,
    })),
  };
}

// ---- eBay Browse API: Get Item Details + Item Specifics ----
export interface EbayItemDetail {
  itemId: string;
  title: string;
  price?: number;
  currency?: string;
  condition?: string;
  categoryId?: string;
  categoryPath?: string;
  imageUrl?: string;
  additionalImages?: string[];
  itemSpecifics: Record<string, string>;
  description?: string;
  seller?: { username: string; feedbackScore: number; feedbackPercentage: string };
  itemUrl?: string;
}

export async function getEbayItemDetail(itemId: string): Promise<EbayItemDetail> {
  const token = await getOAuthToken();
  if (!token) throw new Error("eBay OAuth token not available");

  // Browse API uses format like "v1|<legacyId>|0" or the full Browse item ID
  const encodedId = encodeURIComponent(itemId);
  const url = `https://api.ebay.com/buy/browse/v1/item/${encodedId}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });

  if (!res.ok) {
    // Try with v1| prefix if plain ID fails
    if (!itemId.startsWith("v1|")) {
      const altId = encodeURIComponent(`v1|${itemId}|0`);
      const altUrl = `https://api.ebay.com/buy/browse/v1/item/${altId}`;
      const altRes = await fetch(altUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
      });
      if (altRes.ok) {
        const altData = await altRes.json();
        return parseItemDetail(altData);
      }
    }
    const errText = await res.text();
    throw new Error(`eBay getItem error: ${res.status} - ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const parsed = parseItemDetail(data);
  return await enrichItemDetailFallback(parsed, data);
}

function parseItemDetail(data: any): EbayItemDetail {
  const specifics: Record<string, string> = {};
  if (data.localizedAspects) {
    for (const aspect of data.localizedAspects) {
      if (aspect.name && aspect.value) {
        specifics[aspect.name] = Array.isArray(aspect.value) ? aspect.value.join(", ") : aspect.value;
      }
    }
  }

  const images: string[] = [];
  if (data.additionalImages) {
    for (const img of data.additionalImages) {
      if (img.imageUrl) images.push(img.imageUrl);
    }
  }

  return {
    itemId: data.itemId || "",
    title: data.title || "",
    price: data.price ? parseFloat(data.price.value) : undefined,
    currency: data.price?.currency,
    condition: data.condition || data.conditionDisplayName,
    categoryId: data.categoryId || data.categories?.[0]?.categoryId || undefined,
    categoryPath: data.categoryPath || data.categories?.map((c: any) => c?.categoryName).filter(Boolean).join(" > ") || undefined,
    imageUrl: data.image?.imageUrl,
    additionalImages: images,
    itemSpecifics: specifics,
    description: data.description || data.shortDescription,
    seller: data.seller ? {
      username: data.seller.username || "",
      feedbackScore: data.seller.feedbackScore || 0,
      feedbackPercentage: data.seller.feedbackPercentage || "",
    } : undefined,
    itemUrl: data.itemWebUrl,
  };
}

function stripHtmlTags(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonLdFromHtml(html: string): any | null {
  const blocks = Array.from(
    html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  );
  for (const m of blocks) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const product = parsed.find((x) => x?.["@type"] === "Product");
        if (product) return product;
      }
      if (parsed?.["@type"] === "Product") return parsed;
      if (parsed?.mainEntity?.["@type"] === "Product") return parsed.mainEntity;
    } catch {
      // ignore malformed ld+json
    }
  }
  return null;
}

/** JSON-LD の weight を Item Specifics 用の文字列に */
function formatJsonLdWeight(w: unknown): string | undefined {
  if (typeof w === "string" && w.trim()) return w.trim();
  if (!w || typeof w !== "object") return undefined;
  const o = w as Record<string, unknown>;
  const val = o.value ?? o.weightValue;
  if (val == null || val === "") return undefined;
  const u = String(o.unitCode || o.unitText || "").toUpperCase();
  const vStr = String(val).replace(/,/g, "").trim();
  if (!vStr) return undefined;
  if (u.includes("KGM") || u === "KG") return `${vStr} kg`;
  if (u.includes("GRM") || u === "G") return `${vStr} g`;
  if (u.includes("LBR") || u.includes("LB")) return `${vStr} lb`;
  if (u.includes("ONT") || u === "OZ") return `${vStr} oz`;
  if (u) return `${vStr} ${u}`;
  return vStr;
}

async function enrichItemDetailFallback(detail: EbayItemDetail, rawData: any): Promise<EbayItemDetail> {
  const weightMissing = extractWeightGramsFromItemSpecifics(detail.itemSpecifics) === undefined;
  const needHtml =
    !detail.condition ||
    !detail.categoryId ||
    !detail.categoryPath ||
    !(detail.description && String(detail.description).length > 40) ||
    weightMissing;

  if (!needHtml) return detail;

  const itemUrl = detail.itemUrl || rawData?.itemWebUrl;
  if (!itemUrl) return detail;

  try {
    const htmlRes = await fetch(itemUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; sedori-bot/1.0)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!htmlRes.ok) return detail;
    const html = await htmlRes.text();
    const jsonLd = extractJsonLdFromHtml(html);

    const fallbackCondition =
      detail.condition ||
      jsonLd?.itemCondition?.split("/").pop()?.replace(/_/g, " ") ||
      undefined;

    const fallbackCategoryPath =
      detail.categoryPath ||
      (Array.isArray(jsonLd?.category)
        ? jsonLd.category.join(" > ")
        : typeof jsonLd?.category === "string"
        ? jsonLd.category
        : undefined);

    const fallbackCategoryId =
      detail.categoryId ||
      rawData?.categoryId ||
      html.match(/"categoryId"\s*:\s*"(\d+)"/)?.[1] ||
      undefined;

    const fallbackDescription =
      detail.description ||
      (typeof jsonLd?.description === "string" ? stripHtmlTags(jsonLd.description) : undefined) ||
      stripHtmlTags(html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] || "");

    const mergedSpecifics: Record<string, string> = { ...detail.itemSpecifics };

    const ldWeight = formatJsonLdWeight(jsonLd?.weight);
    if (ldWeight && extractWeightGramsFromItemSpecifics(mergedSpecifics) === undefined) {
      mergedSpecifics["Product Weight"] = ldWeight;
    }
    if (extractWeightGramsFromItemSpecifics(mergedSpecifics) === undefined) {
      const wm = html.match(
        /(?:Product Weight|商品の重量|Item Weight)[^<\d]{0,80}?([\d.,]+\s*(?:kg|g|グラム|grams?|oz|lb)\b)/i,
      );
      if (wm?.[1]) mergedSpecifics["Product Weight"] = wm[1].replace(/\s+/g, " ").trim();
    }

    return {
      ...detail,
      condition: fallbackCondition,
      categoryId: fallbackCategoryId,
      categoryPath: fallbackCategoryPath,
      description: fallbackDescription || detail.description,
      itemSpecifics: mergedSpecifics,
    };
  } catch {
    return detail;
  }
}

// ---- Generate listing description from template ----
export function generateListingDescription(
  template: string,
  data: {
    title: string;
    condition: string;
    specifics: Record<string, string>;
    additionalNotes?: string;
  }
): string {
  const specificsText = Object.entries(data.specifics)
    .map(([k, v]) => `• ${k}: ${v}`)
    .join("\n");

  return template
    .replace(/\{title\}/g, data.title)
    .replace(/\{condition\}/g, data.condition)
    .replace(/\{specifics\}/g, specificsText || "(No specifics available)")
    .replace(/\{notes\}/g, data.additionalNotes || "");
}

export const POPULAR_CATEGORIES = [
  { id: "267", name: "ビデオゲーム・ゲーム機", nameEn: "Video Games" },
  { id: "11450", name: "ファッション", nameEn: "Fashion" },
  { id: "293", name: "コンシューマーエレクトロニクス", nameEn: "Electronics" },
  { id: "220", name: "おもちゃ・ホビー", nameEn: "Toys & Hobbies" },
  { id: "26395", name: "カメラ・写真", nameEn: "Cameras" },
  { id: "11116", name: "時計", nameEn: "Watches" },
  { id: "550", name: "アート", nameEn: "Art" },
  { id: "888", name: "スポーツカード", nameEn: "Sports Cards" },
];
