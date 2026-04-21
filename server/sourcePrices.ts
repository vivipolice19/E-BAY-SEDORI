// Auto-fetch actual prices from Japanese sourcing sites using Playwright
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { execSync } from "child_process";
import { existsSync } from "fs";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 全サイト合算の上限（無限グルグル防止） */
const SOURCE_FETCH_TOTAL_TIMEOUT_MS = 75_000;

export interface SourceItem {
  title: string;
  price: number;
  url: string;
  imageUrl?: string;
  platform: string;
  condition?: string;
}

export interface SourceResults {
  mercari: SourceItem[];
  yahoo: SourceItem[];
  yahooShopping: SourceItem[];
  rakuma: SourceItem[];
  surugaya: SourceItem[];
  errors: Record<string, string>;
}

/**
 * Chromium の実体パス（未設定なら Playwright のキャッシュ内蔵ブラウザを試す）
 * Render 等: ビルドで `npx playwright@1.58.2 install chromium` を実行するとキャッシュに入る
 */
function resolveChromiumExecutable(): string | undefined {
  const envPath =
    (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROME_PATH || "").trim();
  if (envPath && existsSync(envPath)) return envPath;

  const candidates: string[] = [];
  if (process.platform === "win32") {
    const pf = process.env.PROGRAMFILES || "C:\\Program Files";
    const pfx86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || "";
    candidates.push(
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pfx86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${local}\\Google\\Chrome\\Application\\chrome.exe`,
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
    );
  }

  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }

  if (process.platform !== "win32") {
    try {
      const path = execSync(
        "command -v chromium 2>/dev/null || command -v chromium-browser 2>/dev/null || command -v google-chrome-stable 2>/dev/null || true",
        { encoding: "utf-8", shell: "/bin/sh", timeout: 5000 },
      ).trim();
      if (path) return path;
    } catch {
      /* ignore */
    }
  }

  return undefined;
}

// Simple in-memory cache (keyword → { data, expiry })
const cache = new Map<string, { data: SourceResults; expiry: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Browser singleton（起動失敗でデッドロックしないよう単一 Promise）
let browser: Browser | null = null;
let browserLaunchPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  if (browserLaunchPromise) return browserLaunchPromise;

  browserLaunchPromise = (async () => {
    const executablePath = resolveChromiumExecutable();
    const launchOpts: Parameters<typeof chromium.launch>[0] = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--disable-extensions",
        "--window-size=1280,900",
      ],
    };
    if (executablePath) launchOpts.executablePath = executablePath;

    const b = await chromium.launch(launchOpts);
    browser = b;
    b.on("disconnected", () => {
      browser = null;
    });
    return b;
  })();

  try {
    return await browserLaunchPromise;
  } finally {
    browserLaunchPromise = null;
  }
}

async function newContext(): Promise<BrowserContext> {
  const b = await getBrowser();
  return b.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    locale: "ja-JP",
    extraHTTPHeaders: {
      "accept-language": "ja-JP,ja;q=0.9,en;q=0.8",
    },
  });
}

// ---- Mercari ----
async function fetchMercariPrices(keyword: string): Promise<SourceItem[]> {
  const ctx = await newContext();
  const page = await ctx.newPage();
  try {
    const url = `https://jp.mercari.com/search?keyword=${encodeURIComponent(keyword)}&status=on_sale&sort=price_asc`;
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
      referer: "https://jp.mercari.com/",
    });
    await page
      .waitForSelector('[data-testid="thumbnail-link"], a[href*="/item/"]', { timeout: 18_000 })
      .catch(() => {});
    await sleep(2500);
    try {
      await page.waitForFunction(
        () => document.querySelectorAll('a[href*="/item/"]').length >= 2,
        { timeout: 10_000 },
      );
    } catch {
      /* 続行 */
    }
    await page.mouse.wheel(0, 600).catch(() => {});
    await sleep(800);

    const items = await page.evaluate(() => {
      const results: Array<{ title: string; price: number; href: string; imgSrc: string }> = [];
      const seen = new Set<string>();

      function absHref(h: string | null): string {
        if (!h) return "";
        if (h.startsWith("http")) return h.split("?")[0].replace(/\/$/, "");
        if (h.startsWith("/item/")) return ("https://jp.mercari.com" + h.split("?")[0]).replace(/\/$/, "");
        return "";
      }

      function imgFrom(link: Element): string {
        const imgs = link.querySelectorAll("img");
        for (let j = 0; j < imgs.length; j++) {
          const el = imgs[j] as HTMLImageElement;
          const s =
            el.currentSrc ||
            el.src ||
            el.getAttribute("data-src") ||
            el.getAttribute("data-original") ||
            "";
          if (s && s.startsWith("http") && !s.startsWith("data:")) return s;
        }
        return "";
      }

      function push(title: string, price: number, href: string, imgSrc: string) {
        const t = title.replace(/\s+/g, " ").trim();
        const key = href.replace(/\/$/, "");
        if (!href || !t || price < 100 || seen.has(key)) return;
        seen.add(key);
        results.push({ title: t.substring(0, 120), price, href: key, imgSrc: imgSrc || "" });
      }

      // A: 従来の thumbnail-link + aria-label
      document.querySelectorAll('[data-testid="thumbnail-link"]').forEach((link, i) => {
        if (i >= 24) return;
        const href = absHref(link.getAttribute("href"));
        const imgDiv = link.querySelector('[role="img"]');
        const ariaLabel = imgDiv ? imgDiv.getAttribute("aria-label") || "" : "";
        const priceMatch = ariaLabel.match(/([\d,]+)円/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ""), 10) : 0;
        const title = ariaLabel.replace(/の画像.*$/, "").trim();
        push(title, price, href, imgFrom(link));
      });

      // B: 商品リンク直取り（DOM 変更に強い）
      document.querySelectorAll('a[href*="/item/"]').forEach((a, i) => {
        if (results.length >= 20 || i >= 60) return;
        const href = absHref((a as HTMLAnchorElement).getAttribute("href"));
        if (!href.includes("/item/")) return;
        const card = a.closest('[data-testid="item-cell"]') || a.closest("li") || a.parentElement;
        const scope = card || a;
        let title = "";
        const nameEl = scope.querySelector('[class*="name"], [class*="Name"], [class*="title"]');
        if (nameEl?.textContent) title = nameEl.textContent.trim();
        if (!title) {
          const al = scope.querySelector('[role="img"]')?.getAttribute("aria-label") || "";
          title = al.replace(/の画像.*$/, "").replace(/[\d,]+円.*$/, "").trim();
        }
        if (!title) title = (scope.textContent || "").split("\n").map((s) => s.trim()).find((s) => s.length > 8) || "";
        let price = 0;
        const al2 = scope.querySelector('[role="img"]')?.getAttribute("aria-label") || "";
        const pm = al2.match(/([\d,]+)円/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ""), 10);
        if (price <= 0) {
          const tx = scope.textContent || "";
          const m2 = tx.match(/([\d,]+)\s*円/);
          if (m2) price = parseInt(m2[1].replace(/,/g, ""), 10);
        }
        push(title, price, href, imgFrom(scope));
      });

      return results.slice(0, 20);
    });

    return items.map((item) => ({
      platform: "メルカリ",
      title: item.title,
      price: item.price,
      url: item.href,
      imageUrl: item.imgSrc || undefined,
    }));
  } catch (err: any) {
    console.warn("Mercari scrape error:", err.message);
    throw err;
  } finally {
    await page.close();
    await ctx.close();
  }
}

// ---- Yahoo Auctions ----
async function fetchYahooPrices(keyword: string): Promise<SourceItem[]> {
  const ctx = await newContext();
  const page = await ctx.newPage();
  try {
    const url = `https://auctions.yahoo.co.jp/search/search?p=${encodeURIComponent(keyword)}&va=${encodeURIComponent(keyword)}&exflg=1&b=1&n=20&s1=cbids&o1=a&ei=UTF-8`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 55_000 });
    await sleep(1500);

    const items = await page.evaluate(() => {
      const results: Array<{ title: string; price: number; href: string; imgSrc: string }> = [];
      const lis = document.querySelectorAll("li.Product");
      lis.forEach((li, i) => {
        if (i >= 20) return;
        const link = li.querySelector("a.Product__titleLink") as HTMLAnchorElement;
        const imgLink = li.querySelector("a.Product__imageLink") as HTMLAnchorElement;
        const priceEl = li.querySelector(".Product__priceValue");
        const imgEl = li.querySelector("img");
        const titleEl = li.querySelector(".Product__title, .Product__titleLink");

        const href = link ? link.href : (imgLink ? imgLink.href : "");
        const rawPrice = priceEl ? priceEl.textContent || "" : "";
        const priceMatches = rawPrice.match(/[\d,]+/g);
        const price = priceMatches
          ? parseInt(priceMatches[priceMatches.length - 1].replace(/,/g, ""), 10)
          : 0;
        const title = titleEl ? titleEl.textContent?.trim() || "" : "";
        const imgSrc = imgEl ? (imgEl as HTMLImageElement).src : "";

        // Filter out 1-yen start auctions and trivially low prices (still live bids)
        if (price > 100 && title && href) {
          results.push({ title, price, href, imgSrc });
        }
      });
      return results;
    });

    return items.map((item) => ({
      platform: "ヤフオク",
      title: item.title,
      price: item.price,
      url: item.href,
      imageUrl: item.imgSrc || undefined,
    }));
  } catch (err: any) {
    console.warn("Yahoo Auctions scrape error:", err.message);
    throw err;
  } finally {
    await page.close();
    await ctx.close();
  }
}

// ---- Yahoo Shopping ----
async function fetchYahooShoppingPrices(keyword: string): Promise<SourceItem[]> {
  const ctx = await newContext();
  const page = await ctx.newPage();
  try {
    const url = `https://shopping.yahoo.co.jp/search?p=${encodeURIComponent(keyword)}&sort=price&order=a`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 55_000 });
    await sleep(2000);
    await page.waitForSelector('a[href*="store.shopping.yahoo"], a[href*="shopping-item-reach"], img', { timeout: 12_000 }).catch(() => {});
    await page.mouse.wheel(0, 900).catch(() => {});
    await sleep(1200);

    const items = await page.evaluate(`(function() {
      var results = [];
      var seenHrefs = new Set();

      var canonHref = function(href) {
        try { var m = href.match(/rdUrl=([^&]+)/); if (m) return decodeURIComponent(m[1]).split('?')[0]; } catch(e) {}
        return href.split('?')[0];
      };

      var cleanTitle = function(t) {
        return (t || '').replace(/[\\d,]+円[^\\n]*/g,'').replace(/^PR\\s*/,'').replace(/送料[^\\n]*/g,'').replace(/（税込）[^\\n]*/g,'').replace(/\\s+/g,' ').trim().substring(0,80);
      };

      var imgSrcFrom = function(root) {
        if (!root) return '';
        var imgs = root.querySelectorAll('img');
        for (var k = 0; k < imgs.length; k++) {
          var el = imgs[k];
          var s = el.currentSrc || el.src || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original') || '';
          if (s && s.indexOf('http') === 0 && s.indexOf('data:') !== 0 && s.indexOf('spacer') < 0) return s;
        }
        return '';
      };

      // Try structured product list first
      var productItems = document.querySelectorAll('[data-yl-tracking-component-type="item"], .Product, li[class*="Product"], li[class*="List"], article[class*="item"]');
      if (productItems.length > 0) {
        Array.from(productItems).forEach(function(item) {
          var priceEl = item.querySelector('[class*="price"], [class*="Price"]');
          var linkEl = item.querySelector('a[href*="store.shopping.yahoo"], a[href*="shopping-item-reach"]');
          if (!priceEl || !linkEl) return;
          var priceText = priceEl.textContent || '';
          var pm = priceText.match(/([\\d,]+)/);
          if (!pm) return;
          var price = parseInt(pm[1].replace(/,/g,''), 10);
          if (!price || price <= 0) return;
          var href = linkEl.href || '';
          var canon = canonHref(href);
          if (!href || seenHrefs.has(canon)) return;
          seenHrefs.add(canon);
          var titleEl = item.querySelector('[class*="title"], [class*="Title"], h3, h2');
          var rawTitle = (titleEl && titleEl.textContent) ? titleEl.textContent : (item.textContent || '');
          var title = cleanTitle(rawTitle);
          var imgSrc = imgSrcFrom(item);
          if (title && price > 0) results.push({ title: title, price: price, href: href, imgSrc: imgSrc });
        });
      }

      // アンカー起点（レイアウト変更時）
      if (results.length < 5) {
        var anchors = document.querySelectorAll('a[href*="store.shopping.yahoo.co.jp"], a[href*="shopping-item-reach"]');
        Array.from(anchors).forEach(function(a, idx) {
          if (results.length >= 20 || idx > 50) return;
          var href = a.href || '';
          var canon = canonHref(href);
          if (!href || seenHrefs.has(canon)) return;
          var card = a.closest('li') || a.closest('article') || a.closest('[class*="item"]') || a.parentElement;
          if (!card) return;
          var priceText = (card.textContent || '').match(/([\\d,]+)\\s*円/);
          if (!priceText) return;
          var price = parseInt(priceText[1].replace(/,/g,''), 10);
          if (!price || price <= 0) return;
          seenHrefs.add(canon);
          var title = cleanTitle(card.textContent || '');
          var imgSrc = imgSrcFrom(card);
          if (title && price > 0) results.push({ title: title, price: price, href: href, imgSrc: imgSrc });
        });
      }

      // Fallback: walk price elements
      if (results.length === 0) {
        var priceEls = document.querySelectorAll('[class*="price"], [class*="Price"]');
        Array.from(priceEls).forEach(function(priceEl) {
          var txt = priceEl.textContent || '';
          var pm2 = txt.match(/([\\d,]+)円/);
          if (!pm2) return;
          var price2 = parseInt(pm2[1].replace(/,/g,''), 10);
          if (!price2 || price2 <= 0) return;
          var cur = priceEl.parentElement;
          for (var i = 0; i < 8 && cur; i++) {
            var anyLink = cur.querySelector('a[href*="shopping-item-reach"], a[href*="store.shopping.yahoo"]');
            if (anyLink && (cur.textContent || '').length > txt.length + 5) {
              var href2 = anyLink.href || '';
              var canon2 = canonHref(href2);
              if (!href2 || seenHrefs.has(canon2)) break;
              seenHrefs.add(canon2);
              var title2 = cleanTitle(cur.textContent || '');
              var imgSrc2 = imgSrcFrom(cur);
              if (title2 && price2 > 0) { results.push({ title: title2, price: price2, href: href2, imgSrc: imgSrc2 }); break; }
            }
            cur = cur.parentElement;
          }
        });
      }

      return results.slice(0, 20);
    })()`) as Array<{ title: string; price: number; href: string; imgSrc: string }>;

    return items
      .filter((item) => item.title && item.price > 0)
      .map((item) => ({
        platform: "Yahoo!ショッピング",
        title: item.title,
        price: item.price,
        url: item.href,
        imageUrl: item.imgSrc || undefined,
      }));
  } catch (err: any) {
    console.warn("Yahoo Shopping scrape error:", err.message);
    throw err;
  } finally {
    await page.close();
    await ctx.close();
  }
}

// ---- ラクマ ----
async function fetchRakumaPrices(keyword: string): Promise<SourceItem[]> {
  const ctx = await newContext();
  const page = await ctx.newPage();
  try {
    const url = `https://rakuma.rakuten.co.jp/search/?keyword=${encodeURIComponent(keyword)}&order=price_asc`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
    await sleep(2200);
    await page.mouse.wheel(0, 700).catch(() => {});
    await sleep(1200);

    const items = await page.evaluate(`(function() {
      var results = [];
      // Try various selectors for ラクマ product cards
      var cards = document.querySelectorAll('[data-testid="item-cell"], .sc-fzoLsD, li[class*="ItemCell"], li[class*="item"], .item-card');
      if (cards.length === 0) {
        cards = document.querySelectorAll('li a[href*="/item/"]');
      }
      function imgBest(el) {
        if (!el) return '';
        var imgs = el.querySelectorAll('img');
        for (var k = 0; k < imgs.length; k++) {
          var im = imgs[k];
          var s = im.currentSrc || im.src || im.getAttribute('data-src') || im.getAttribute('data-lazy-src') || '';
          if (s && s.indexOf('http') === 0 && s.indexOf('data:') !== 0) return s;
        }
        return '';
      }
      Array.from(cards).forEach(function(card, i) {
        if (i >= 20) return;
        var link = card.tagName === 'A' ? card : card.querySelector('a[href*="/item/"]');
        if (!link) return;
        var href = link.href || '';
        if (!href.includes('/item/')) return;
        var priceEl = card.querySelector('[class*="price"], [class*="Price"]');
        var titleEl = card.querySelector('[class*="name"], [class*="title"], [class*="Name"]');
        var priceText = priceEl ? (priceEl.textContent || '') : (card.textContent || '');
        var pm = priceText.match(/([\\d,]+)/);
        if (!pm) return;
        var price = parseInt(pm[1].replace(/,/g,''), 10);
        if (!price || price <= 0) return;
        var title = titleEl ? (titleEl.textContent || '').trim() : '';
        if (!title) title = (card.getAttribute('aria-label') || '').replace(/の画像.*/, '').trim();
        var imgSrc = imgBest(card);
        if (price > 0) results.push({ title: title || href, price: price, href: href, imgSrc: imgSrc });
      });
      return results;
    })()`) as Array<{ title: string; price: number; href: string; imgSrc: string }>;

    return items.filter(i => i.price > 0).slice(0, 20).map(item => ({
      platform: "ラクマ",
      title: item.title,
      price: item.price,
      url: item.href,
      imageUrl: item.imgSrc || undefined,
    }));
  } catch (err: any) {
    console.warn("Rakuma scrape error:", err.message);
    throw err;
  } finally {
    await page.close();
    await ctx.close();
  }
}

// ---- 駿河屋 ----
async function fetchSurugayaPrices(keyword: string): Promise<SourceItem[]> {
  const ctx = await newContext();
  const page = await ctx.newPage();
  try {
    const url = `https://www.surugaya.co.jp/search/?q=${encodeURIComponent(keyword)}&type=0`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
    await sleep(1800);
    await page.mouse.wheel(0, 600).catch(() => {});
    await sleep(1000);

    const items = await page.evaluate(`(function() {
      var results = [];
      // 駿河屋 product grid items
      var cards = document.querySelectorAll('.product-cell, .item-box, li.item, .search-result-item, [class*="product_"]');
      if (cards.length === 0) {
        // Fallback: look for links containing /item/
        cards = document.querySelectorAll('a[href*="/item/"]');
      }
      function imgBest2(el) {
        if (!el) return '';
        var imgs = el.querySelectorAll('img');
        for (var k = 0; k < imgs.length; k++) {
          var im = imgs[k];
          var s = im.currentSrc || im.src || im.getAttribute('data-src') || im.getAttribute('data-original') || '';
          if (s && s.indexOf('http') === 0 && s.indexOf('data:') !== 0) return s;
        }
        return '';
      }
      Array.from(cards).forEach(function(card, i) {
        if (i >= 20) return;
        var link = card.tagName === 'A' ? card : card.querySelector('a[href*="/item/"]');
        if (!link) return;
        var href = link.href || '';
        if (!href.includes('surugaya.co.jp')) return;
        var priceEl = card.querySelector('.price, .item-price, [class*="price"]');
        var titleEl = card.querySelector('.title, .item-name, [class*="title"], [class*="name"]');
        var priceText = priceEl ? (priceEl.textContent || '') : '';
        if (!priceText) priceText = (card.textContent || '');
        var pm = priceText.match(/([\\d,]+)/);
        if (!pm) return;
        var price = parseInt(pm[1].replace(/,/g,''), 10);
        if (!price || price <= 0 || price > 5000000) return;
        var title = titleEl ? (titleEl.textContent || '').trim() : (link.textContent || '').trim();
        var imgSrc = imgBest2(card);
        if (price > 0) results.push({ title: title || href, price: price, href: href, imgSrc: imgSrc });
      });
      return results;
    })()`) as Array<{ title: string; price: number; href: string; imgSrc: string }>;

    return items.filter(i => i.price > 0).slice(0, 20).map(item => ({
      platform: "駿河屋",
      title: item.title,
      price: item.price,
      url: item.href,
      imageUrl: item.imgSrc || undefined,
    }));
  } catch (err: any) {
    console.warn("Surugaya scrape error:", err.message);
    throw err;
  } finally {
    await page.close();
    await ctx.close();
  }
}

function buildKeywordCandidates(raw: string): string[] {
  const base = (raw || "").replace(/\s+/g, " ").trim();
  if (!base) return [];

  const stripped = base
    .replace(/[【】\[\]()（）「」]/g, " ")
    .replace(/(かわいい|限定|新品|美品|公式|コラボ|日本|ジャパン|送料無料|即購入可|タグ付き)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = stripped
    .split(/[\/|｜,，・\-\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const cands: string[] = [];
  const push = (s: string) => {
    const v = s.replace(/\s+/g, " ").trim().slice(0, 60);
    if (v && !cands.includes(v)) cands.push(v);
  };

  push(base);
  push(stripped);
  if (tokens.length >= 2) push(tokens.slice(0, 3).join(" "));
  if (tokens.length >= 1) push(tokens.slice(0, 2).join(" "));
  if (tokens.length >= 1) push(tokens[0]);

  return cands.slice(0, 3);
}

async function fetchWithKeywordFallback(
  platformLabel: string,
  fetcher: (kw: string) => Promise<SourceItem[]>,
  candidates: string[],
  errors: Record<string, string>,
): Promise<SourceItem[]> {
  let lastErr = "";
  for (const kw of candidates) {
    try {
      const items = await fetcher(kw);
      if (items.length > 0) {
        if (kw !== candidates[0]) {
          console.log(`[SourcePrices] ${platformLabel} fallback hit: "${kw}" (${items.length})`);
        }
        return items;
      }
    } catch (e: any) {
      lastErr = String(e?.message || e);
    }
  }
  if (lastErr) errors[platformLabel] = lastErr;
  return [];
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${Math.round(ms / 1000)}s)`)), ms),
    ),
  ]);
}

async function fetchSourcePricesCore(keyword: string): Promise<SourceResults> {
  const errors: Record<string, string> = {};
  console.log(`[SourcePrices] Fetching prices for "${keyword}"...`);
  const keywordCandidates = buildKeywordCandidates(keyword);
  if (keywordCandidates.length === 0) {
    return { mercari: [], yahoo: [], yahooShopping: [], rakuma: [], surugaya: [], errors: {} };
  }
  console.log(`[SourcePrices] Keyword candidates: ${keywordCandidates.join(" | ")}`);

  const [mercariItems, yahooItems, yahooShoppingItems, rakumaItems, surugayaItems] = await Promise.all([
    withTimeout(
      fetchWithKeywordFallback("メルカリ", fetchMercariPrices, keywordCandidates, errors),
      30_000,
      "メルカリ",
    ).catch((e: any) => {
      errors["メルカリ"] = String(e?.message || e);
      return [] as SourceItem[];
    }),
    withTimeout(
      fetchWithKeywordFallback("ヤフオク", fetchYahooPrices, keywordCandidates, errors),
      30_000,
      "ヤフオク",
    ).catch((e: any) => {
      errors["ヤフオク"] = String(e?.message || e);
      return [] as SourceItem[];
    }),
    withTimeout(
      fetchWithKeywordFallback("Yahoo!ショッピング", fetchYahooShoppingPrices, keywordCandidates, errors),
      30_000,
      "Yahoo!ショッピング",
    ).catch((e: any) => {
      errors["Yahoo!ショッピング"] = String(e?.message || e);
      return [] as SourceItem[];
    }),
    withTimeout(
      fetchWithKeywordFallback("ラクマ", fetchRakumaPrices, keywordCandidates, errors),
      26_000,
      "ラクマ",
    ).catch((e: any) => {
      errors["ラクマ"] = String(e?.message || e);
      return [] as SourceItem[];
    }),
    withTimeout(
      fetchWithKeywordFallback("駿河屋", fetchSurugayaPrices, keywordCandidates, errors),
      26_000,
      "駿河屋",
    ).catch((e: any) => {
      errors["駿河屋"] = String(e?.message || e);
      return [] as SourceItem[];
    }),
  ]);

  const result: SourceResults = {
    mercari: mercariItems,
    yahoo: yahooItems,
    yahooShopping: yahooShoppingItems,
    rakuma: rakumaItems,
    surugaya: surugayaItems,
    errors,
  };

  cache.set(keyword, { data: result, expiry: Date.now() + CACHE_TTL_MS });
  console.log(
    `[SourcePrices] Done: ${mercariItems.length} mercari, ${yahooItems.length} yahoo, ${yahooShoppingItems.length} yahooShopping, ${rakumaItems.length} rakuma, ${surugayaItems.length} surugaya items`
  );
  return result;
}

export async function fetchSourcePrices(keyword: string): Promise<SourceResults> {
  const cached = cache.get(keyword);
  if (cached && cached.expiry > Date.now()) {
    console.log(`[SourcePrices] Cache hit for "${keyword}"`);
    return cached.data;
  }

  const empty: SourceResults = {
    mercari: [],
    yahoo: [],
    yahooShopping: [],
    rakuma: [],
    surugaya: [],
    errors: {},
  };

  try {
    return await Promise.race([
      fetchSourcePricesCore(keyword),
      new Promise<SourceResults>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `仕入れ検索が ${SOURCE_FETCH_TOTAL_TIMEOUT_MS / 1000} 秒以内に終わりませんでした。Chromium / Playwright の設定を確認するか、時間をおいて再試行してください。`,
              ),
            ),
          SOURCE_FETCH_TOTAL_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (e: any) {
    const msg = String(e?.message || e);
    console.error(`[SourcePrices] Failed for "${keyword}":`, msg);
    empty.errors["全体"] = msg;
    return empty;
  }
}

export function calcPriceStats(items: SourceItem[]) {
  if (items.length === 0) return null;
  const prices = items.map((i) => i.price).sort((a, b) => a - b);
  const min = prices[0];
  const max = prices[prices.length - 1];
  const avg = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
  const median = prices[Math.floor(prices.length / 2)];
  return { min, max, avg, median, count: prices.length };
}

// ---- Custom URL Price Fetch ----
export interface UrlPriceResult {
  title: string;
  price: number;
  currency: string;
  url: string;
  platform: string;
  imageUrls?: string[];
  error?: string;
  // Extended: condition + description from source page
  sourceCondition?: string;
  sourceDescription?: string;
  ebayConditionMapped?: string;
  sourceWeightG?: number;
}

// Map Japanese Mercari condition to eBay condition
function mapMercariConditionToEbay(jpCondition: string): string {
  const c = jpCondition.trim();
  if (c.includes("新品") || c.includes("未使用") && !c.includes("に近い")) return "New";
  if (c.includes("未使用に近い")) return "Like New";
  if (c.includes("目立った傷や汚れなし")) return "Very Good";
  if (c.includes("やや傷や汚れあり")) return "Good";
  if (c.includes("傷や汚れあり")) return "Acceptable";
  if (c.includes("全体的に状態が悪い")) return "For Parts or Not Working";
  return "Used";
}

function detectPlatform(url: string): string {
  if (url.includes("amazon.co.jp")) return "Amazon JP";
  if (url.includes("amazon.com")) return "Amazon US";
  if (url.includes("rakuten.co.jp")) return "楽天";
  if (url.includes("jp.mercari.com")) return "メルカリ";
  if (url.includes("auctions.yahoo.co.jp")) return "ヤフオク";
  if (url.includes("shopping.yahoo.co.jp")) return "Yahoo!ショッピング";
  if (url.includes("yodobashi.com")) return "ヨドバシ";
  if (url.includes("biccamera.com") || url.includes("bic-camera.com")) return "ビックカメラ";
  if (url.includes("kakaku.com")) return "価格.com";
  if (url.includes("surugaya.co.jp")) return "駿河屋";
  if (url.includes("bookoff.co.jp")) return "ブックオフ";
  if (url.includes("jalan.net")) return "じゃらん";
  if (url.includes("dmm.com")) return "DMM";
  if (url.includes("paypaymarket") || url.includes("paypaymall")) return "PayPayモール";
  return "カスタムURL";
}

// Universal price extractor that runs inside the browser page
const PRICE_EVAL_SCRIPT = `(function(targetUrl) {
  function parsePrice(t) {
    if (!t) return 0;
    var c = t.replace(/[,，¥￥\\u3000\\s円税込]/g, '');
    var m = c.match(/[\\d]+(?:\\.\\d{1,2})?/);
    return m ? parseFloat(m[0]) : 0;
  }

  function addImg(arr, src) {
    if (src && typeof src === 'string' && src.startsWith('http') && arr.indexOf(src) < 0) arr.push(src);
  }

  var price = 0, currency = 'JPY', title = '', imageUrls = [];

  // 1. JSON-LD (most reliable for structured sites)
  var jsonLds = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (var i = 0; i < jsonLds.length; i++) {
    try {
      var raw = JSON.parse(jsonLds[i].textContent || '{}');
      var candidates = Array.isArray(raw) ? raw : [raw];
      for (var ci = 0; ci < candidates.length; ci++) {
        var obj = candidates[ci];
        if (obj.name && !title) title = obj.name;
        // Collect ALL images from JSON-LD
        if (obj.image) {
          var imgs = Array.isArray(obj.image) ? obj.image : [obj.image];
          imgs.forEach(function(img) {
            var s = typeof img === 'string' ? img : (img && img.url ? img.url : '');
            addImg(imageUrls, s);
          });
        }
        if (price > 0) continue;
        var offers = obj['@type'] === 'Offer' ? obj : (obj.offers || obj.Offers || null);
        if (!offers) continue;
        var offerList = Array.isArray(offers) ? offers : [offers];
        for (var oi = 0; oi < offerList.length && price === 0; oi++) {
          var o = offerList[oi];
          var pv = parseFloat(String(o.price || o.lowPrice || '0'));
          if (pv > 0) { price = pv; currency = o.priceCurrency || 'JPY'; break; }
        }
      }
    } catch(e) {}
  }

  // 2. Meta tags (OGP / Open Graph product)
  if (price === 0) {
    var mP = document.querySelector('meta[property="product:price:amount"]');
    var mC = document.querySelector('meta[property="product:price:currency"]');
    if (mP) { var pv2 = parseFloat(mP.getAttribute('content') || '0'); if (pv2 > 0) price = pv2; }
    if (mC) currency = mC.getAttribute('content') || currency;
  }

  // 3. Microdata [itemprop="price"]
  if (price === 0) {
    var itemprop = document.querySelector('[itemprop="price"]');
    if (itemprop) {
      var pp = parsePrice(itemprop.getAttribute('content') || itemprop.textContent || '');
      if (pp > 0) price = pp;
    }
  }

  // 4. Platform-specific selectors (ordered by priority)
  if (price === 0) {
    var PLATFORM_SELS = [
      '#priceblock_ourprice', '#priceblock_dealprice', '#priceblock_saleprice',
      '#corePrice_desktop .a-price .a-offscreen',
      '#corePrice_feature_div .a-price .a-offscreen',
      '#apex_desktop .a-price .a-offscreen',
      '#price_inside_buybox', '#tp_price_block_total_price_ww .a-offscreen',
      '#newBuyBoxPrice', '#buyNewSection .a-color-price',
      '.price2', '#priceCalculationConfig', '[class*="checkout-product-price"]',
      '#priceBlock .Price__value', '.priceBlock .price--emphasis',
      '[class*="price--emphasis"]', '[class*="ItemPrice"]', '.elPriceNum',
      '[class*="merPrice"] [class*="number"]', '[data-testid="price"]',
      '[class*="ItemPrice"]', '[class*="item-price"]',
      '.Price .Price__value', '#main-price span', '.decidePrice .price',
      '.price_sort_price', '#priceWrap .price', '.ProductPrice .price',
      '.ProductDetail__price', '#price', '.price',
      '[class*="price"]', '[id*="price"]',
    ];
    for (var si = 0; si < PLATFORM_SELS.length; si++) {
      try {
        var el = document.querySelector(PLATFORM_SELS[si]);
        if (el) {
          var t2 = el.getAttribute('content') || el.textContent || '';
          var p2 = parsePrice(t2);
          if (p2 > 10) { price = p2; break; }
        }
      } catch(e) {}
    }
  }

  // 5. Heuristic: scan all text nodes containing 円
  if (price === 0) {
    var allEls = Array.from(document.querySelectorAll('span, p, div, strong, b'));
    for (var ai = 0; ai < allEls.length && price === 0; ai++) {
      var txt = (allEls[ai].childNodes[0] && allEls[ai].childNodes[0].nodeType === 3)
        ? allEls[ai].childNodes[0].textContent || ''
        : allEls[ai].textContent || '';
      if (txt.includes('円') && !txt.includes('送料')) {
        var pp2 = parsePrice(txt);
        if (pp2 >= 100 && pp2 <= 5000000) { price = pp2; break; }
      }
    }
  }

  // Title from OGP if not found
  if (!title) {
    var ogT = document.querySelector('meta[property="og:title"]') || document.querySelector('meta[name="title"]');
    title = (ogT && ogT.getAttribute('content')) || document.title || '';
  }

  // OGP image (add to array if not already collected)
  var ogI = document.querySelector('meta[property="og:image"]');
  var ogImgSrc = (ogI && ogI.getAttribute('content')) || '';
  addImg(imageUrls, ogImgSrc);

  // Gallery images from DOM (platform-specific)
  var gallerySelectors = [
    '[class*="Carousel"] img', '[class*="carousel"] img',
    '[class*="Swiper"] img', '[class*="swiper"] img',
    '[class*="Gallery"] img', '[class*="gallery"] img',
    '[class*="Slider"] img', '[class*="slider"] img',
    '[class*="ItemPhoto"] img', '[class*="itemPhoto"] img',
    '[class*="thumbnail"] img', '[class*="Thumbnail"] img',
    '[data-testid*="image"] img', '[class*="mer-item"] img',
  ];
  var galSel = gallerySelectors.join(', ');
  try {
    var galEls = document.querySelectorAll(galSel);
    galEls.forEach(function(el) {
      var src = el.src || el.getAttribute('src') || el.getAttribute('data-src') || '';
      if (src && !src.startsWith('data:')) addImg(imageUrls, src);
    });
  } catch(e) {}

  // Currency detection
  var isEnSite = (document.documentElement.lang || '').startsWith('en') ||
    (!targetUrl.includes('.co.jp') && !targetUrl.includes('japan') && !targetUrl.includes('.jp'));
  if (isEnSite && price > 0 && price < 50000 && currency === 'JPY') currency = 'USD';

  return { price: price, currency: currency, title: title.replace(/\\s+/g, ' ').trim().substring(0, 100), imageUrls: imageUrls.slice(0, 20) };
})`;

/** メルカリ商品 HTML を HTTP のみで取得し、SSR に価格があれば Playwright を省略（高速） */
async function tryMercariProductFromHttp(targetUrl: string): Promise<UrlPriceResult | null> {
  if (!targetUrl.includes("jp.mercari.com")) return null;
  if (!targetUrl.includes("/item/") && !targetUrl.includes("/shops/product/")) return null;
  if (targetUrl.includes("/search")) return null;
  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
        Accept: "text/html,application/xhtml+xml",
        Referer: "https://jp.mercari.com/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(9_000),
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 450_000);

    const decodeEnt = (s: string) =>
      s
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");

    let price = 0;
    const metaAmt =
      html.match(/property="product:price:amount"\s+content="([\d.]+)"/i) ||
      html.match(/name="product:price:amount"\s+content="([\d.]+)"/i);
    if (metaAmt) price = Math.round(parseFloat(metaAmt[1]));
    if (price <= 0) {
      const rscMeta = html.match(/\\"name\\":\\"product:price:amount\\",\\"content\\":\\"([\d.]+)\\"/i);
      if (rscMeta) price = Math.round(parseFloat(rscMeta[1]));
    }

    if (price <= 0) {
      const m2 = html.match(/"price"\s*:\s*(\d{3,7})\b/);
      if (m2) {
        const p = parseInt(m2[1], 10);
        if (p >= 100 && p < 20_000_000) price = p;
      }
    }
    if (price <= 0) {
      const m3 = html.match(/"itemPrice"\s*:\s*(\d{3,7})\b/);
      if (m3) {
        const p = parseInt(m3[1], 10);
        if (p >= 100 && p < 20_000_000) price = p;
      }
    }

    let title = "";
    const ogT =
      html.match(/property="og:title"\s+content="([^"]+)"/i) ||
      html.match(/name="og:title"\s+content="([^"]+)"/i);
    if (ogT) title = decodeEnt(ogT[1]).trim();
    if (!title) {
      const rscTitle = html.match(/\\"(?:property|name)\\":\\"og:title\\",\\"content\\":\\"([^\\"]+)\\"/i);
      if (rscTitle) title = decodeEnt(rscTitle[1]).trim();
    }
    if (!title) {
      const t2 = html.match(/<title>([^<]{4,200})<\/title>/i);
      if (t2) title = decodeEnt(t2[1]).replace(/\s*-\s*メルカリ\s*$/, "").trim();
    }

    const imageUrls: string[] = [];
    const ogI = html.match(/(?:property|name)="og:image"\s+content="([^"]+)"/gi);
    if (ogI) {
      for (const m of ogI) {
        const sub = m.match(/content="([^"]+)"/i);
        if (sub) {
          const u = decodeEnt(sub[1]);
          if (u.startsWith("http") && imageUrls.indexOf(u) < 0) imageUrls.push(u);
        }
        if (imageUrls.length >= 6) break;
      }
    }
    if (imageUrls.length === 0) {
      const rscImages = [...html.matchAll(/\\"(?:property|name)\\":\\"og:image\\",\\"content\\":\\"([^\\"]+)\\"/gi)];
      for (const m of rscImages) {
        const u = decodeEnt(m[1]);
        if (u.startsWith("http") && imageUrls.indexOf(u) < 0) imageUrls.push(u);
        if (imageUrls.length >= 6) break;
      }
    }

    if (price <= 0) return null;

    console.log(`[fetchUrlPrice] Mercari HTTP fast path price=${price}`);
    return {
      title: title || targetUrl,
      price,
      currency: "JPY",
      url: targetUrl,
      platform: "メルカリ",
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    };
  } catch (e: any) {
    console.warn(`[fetchUrlPrice] Mercari HTTP skip: ${String(e?.message || e).slice(0, 60)}`);
    return null;
  }
}

export async function fetchUrlPrice(targetUrl: string): Promise<UrlPriceResult> {
    const platform = detectPlatform(targetUrl);

    // Platform-specific loading strategy
    const isMercariProduct =
      targetUrl.includes("jp.mercari.com") &&
      (targetUrl.includes("/item/") || targetUrl.includes("/shops/product/")) &&
      !targetUrl.includes("/search");

    if (isMercariProduct) {
      const httpHit = await tryMercariProductFromHttp(targetUrl);
      if (httpHit && httpHit.price > 0) return httpHit;
    }

    const ctx = await newContext();
    const page = await ctx.newPage();

    try {
    console.log(`[fetchUrlPrice] ${platform}: ${targetUrl.slice(0, 80)}`);

    const isYahooAuction = targetUrl.includes("page.auctions.yahoo.co.jp") || targetUrl.includes("yahoo.co.jp/item/");
    const isAmazon = targetUrl.includes("amazon.co.jp") || targetUrl.includes("amazon.com");

    const waitCondition = "domcontentloaded";
    const extraWait = isMercariProduct ? 1400 : isYahooAuction ? 900 : isAmazon ? 1200 : 700;

    await page.goto(targetUrl, {
      waitUntil: waitCondition as any,
      timeout: 50_000,
      ...(isMercariProduct ? { referer: "https://jp.mercari.com/" } : {}),
    });
    await sleep(extraWait);

    // For Mercari items, wait for price element（短めで失敗時は評価スクリプトへ）
    if (isMercariProduct) {
      await page.waitForSelector('[data-testid="price"], [class*="merPrice"], [class*="ItemPrice"], [class*="price"]', { timeout: 5_000 }).catch(() => {});
      try {
        await page.waitForFunction(
          () => /\d[\d,]*\s*円/.test(document.body?.innerText || ""),
          { timeout: 4_000 },
        );
      } catch {
        /* 続行 */
      }
    }
    // For Yahoo Auctions, wait for price
    if (isYahooAuction) {
      await page.waitForSelector('.Price, #main-price, .decidePrice', { timeout: 5000 }).catch(() => {});
    }
    // For Amazon JP, wait for price block
    if (isAmazon) {
      await page.waitForSelector('#corePrice_desktop, #apex_desktop, #price', { timeout: 6000 }).catch(() => {});
    }

    const evalScript = `${PRICE_EVAL_SCRIPT}(${JSON.stringify(targetUrl)})`;
    const result = await page.evaluate(evalScript) as { price: number; currency: string; title: string; imageUrls: string[] };

    // メルカリはクライアント描画のため、構造化抽出が 0 でも本文から価格行を拾う
    if (isMercariProduct && result.price === 0) {
      const fbPrice = await page.evaluate(() => {
        const lines = (document.body?.innerText || "")
          .split(/\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        const candidates: number[] = [];
        for (const line of lines.slice(0, 160)) {
          let m = line.match(/^([\d,]+)\s*円$/);
          if (!m) m = line.match(/^[¥￥]\s*([\d,]+)(?:\s*円)?$/);
          if (!m) m = line.match(/^([\d,]+)\s*円（税込）$/);
          if (!m) continue;
          const n = parseInt(m[1].replace(/,/g, ""), 10);
          if (n >= 100 && n < 20_000_000) candidates.push(n);
        }
        if (candidates.length === 0) return 0;
        candidates.sort((a, b) => a - b);
        for (let i = 0; i < candidates.length; i++) {
          if (candidates[i] >= 300) return candidates[i];
        }
        return candidates[0];
      });
      if (fbPrice > 0) {
        result.price = fbPrice;
        result.currency = "JPY";
      }
    }

    // メルカリのみ: 価格0のとき短い再試行（待ち過ぎない）
    if (isMercariProduct && result.price === 0) {
      await sleep(900);
      await page.mouse.wheel(0, 400).catch(() => {});
      const retry = (await page.evaluate(evalScript)) as {
        price: number;
        currency: string;
        title: string;
        imageUrls: string[];
      };
      if (retry.price > 0) {
        result.price = retry.price;
        result.currency = retry.currency || "JPY";
      }
      if ((!result.title || result.title.length < 2) && retry.title) result.title = retry.title;
      if ((retry.imageUrls || []).length > (result.imageUrls || []).length) result.imageUrls = retry.imageUrls;
      if (result.price === 0) {
        const fb2 = await page.evaluate(() => {
          const lines = (document.body?.innerText || "").split(/\n/).map((s) => s.trim()).filter(Boolean);
          for (const line of lines.slice(0, 100)) {
            const m = line.match(/^([\d,]+)\s*円$/) || line.match(/^[¥￥]\s*([\d,]+)/);
            if (!m) continue;
            const n = parseInt(m[1].replace(/,/g, ""), 10);
            if (n >= 300 && n < 20_000_000) return n;
          }
          return 0;
        });
        if (fb2 > 0) {
          result.price = fb2;
          result.currency = "JPY";
        }
      }
    }

    // For Mercari/Yahoo: scrape gallery + condition + description
    let sourceCondition;
    let sourceDescription;

    let sourceWeightG: number | undefined;

    if (isMercariProduct) {
      const mercariScript = "(function() { " +
        "var imgs = []; " +
        "var els = document.querySelectorAll('picture img, [class*=\"Carousel\"] img, [class*=\"carousel\"] img, [class*=\"Gallery\"] img, [class*=\"ItemPhoto\"] img, [class*=\"merCarousel\"] img, img[src*=\"mercdn\"], img[src*=\"mercari\"], meta[property=\"og:image\"]'); " +
        "els.forEach(function(el) { " +
        "  var src = el.tagName === 'META' ? (el.getAttribute('content') || '') : (el.currentSrc || el.src || el.getAttribute('data-src') || el.getAttribute('src') || ''); " +
        "  if (src && !src.startsWith('data:') && src.startsWith('http') && imgs.indexOf(src) < 0) imgs.push(src); " +
        "}); " +
        "var condition = ''; " +
        "var condKeywords = ['新品、未使用', '未使用に近い', '目立った傷や汚れなし', 'やや傷や汚れあり', '傷や汚れあり', '全体的に状態が悪い']; " +
        "var bodyText = document.body ? (document.body.innerText || '') : ''; " +
        "for (var ci = 0; ci < condKeywords.length; ci++) { if (bodyText.includes(condKeywords[ci])) { condition = condKeywords[ci]; break; } } " +
        "var description = ''; " +
        "var descEl = document.querySelector('[class*=\"ItemDescription\"], [class*=\"item-description\"], [data-testid=\"description\"]'); " +
        "if (descEl) description = (descEl.textContent || '').trim().substring(0, 800); " +
        // Extract weight from page text (e.g. "重量: 350g", "重さ 1.2kg")
        "var weightG = 0; " +
        "var wPat = /重[量さ][：:：\\s]*([0-9]+(?:\\.[0-9]+)?)\\s*(kg|g)/i; " +
        "var wMatch = bodyText.match(wPat); " +
        "if (wMatch) { var wNum = parseFloat(wMatch[1]); weightG = wMatch[2].toLowerCase() === 'kg' ? Math.round(wNum * 1000) : Math.round(wNum); } " +
        // Extract shipping size class
        "var shippingSize = ''; " +
        "var szPat = /(ネコポス|宅急便コンパクト|60サイズ|80サイズ|100サイズ|120サイズ|140サイズ|160サイズ)/; " +
        "var szMatch = bodyText.match(szPat); " +
        "if (szMatch) shippingSize = szMatch[1]; " +
        "return { imgs: imgs.slice(0, 20), condition: condition, description: description, weightG: weightG, shippingSize: shippingSize }; " +
        "})()";
      const mercariData = (await page.evaluate(mercariScript)) as {
        imgs: string[];
        condition?: string;
        description?: string;
        weightG?: number;
        shippingSize?: string;
      };
      if (Array.isArray(mercariData.imgs) && mercariData.imgs.length > result.imageUrls.length) {
        result.imageUrls = mercariData.imgs;
      }
      if (mercariData.condition) sourceCondition = mercariData.condition;
      if (mercariData.description) sourceDescription = mercariData.description;
      // Use explicit weight if found, else estimate from shipping size class
      if (mercariData.weightG && mercariData.weightG > 0) {
        sourceWeightG = mercariData.weightG;
      } else if (mercariData.shippingSize) {
        const sizeMap: Record<string, number> = {
          "ネコポス": 300, "宅急便コンパクト": 500, "60サイズ": 800,
          "80サイズ": 1500, "100サイズ": 3000, "120サイズ": 5000,
          "140サイズ": 8000, "160サイズ": 12000,
        };
        sourceWeightG = sizeMap[mercariData.shippingSize];
      }
      console.log('[fetchUrlPrice] Mercari weight=' + (sourceWeightG || 0) + 'g size=' + (mercariData.shippingSize || 'none'));
    }

    if (isYahooAuction && !sourceCondition) {
      const yahooScript = "(function() { " +
        "var bodyText = document.body ? (document.body.innerText || '') : ''; " +
        "var condition = ''; " +
        "var condKeywords = ['新品', '未使用に近い', '目立った傘や汚れなし', 'やや傘や汚れあり', '傘や汚れあり']; " +
        "for (var ci = 0; ci < condKeywords.length; ci++) { if (bodyText.includes(condKeywords[ci])) { condition = condKeywords[ci]; break; } } " +
        "var description = ''; " +
        "var descEl = document.querySelector('#description, .ProductDetail__description'); " +
        "if (descEl) description = (descEl.textContent || '').trim().substring(0, 800); " +
        "return { condition: condition, description: description }; " +
        "})()";
      const yahooData = (await page.evaluate(yahooScript)) as { condition?: string; description?: string };
      if (yahooData.condition) sourceCondition = yahooData.condition;
      if (yahooData.description) sourceDescription = yahooData.description;
    }

    const ebayConditionMapped = sourceCondition ? mapMercariConditionToEbay(sourceCondition) : undefined;

    console.log('[fetchUrlPrice] Done: price=' + result.price + ' images=' + result.imageUrls.length + ' cond="' + (sourceCondition || '') + '" weight=' + (sourceWeightG || 0) + 'g');

    return {
      title: result.title || targetUrl,
      price: result.price,
      currency: result.currency,
      url: targetUrl,
      platform,
      imageUrls: result.imageUrls.length > 0 ? result.imageUrls : undefined,
      sourceCondition: sourceCondition || undefined,
      sourceDescription: sourceDescription || undefined,
      ebayConditionMapped: ebayConditionMapped || undefined,
      sourceWeightG: sourceWeightG || undefined,
      error: result.price === 0 ? "価格を自動取得できませんでした。手動で入力してください。" : undefined,
    };
  } catch (err: any) {
    console.warn(`[fetchUrlPrice] Error (${platform}): ${err.message?.slice(0, 80)}`);
    return {
      title: "",
      price: 0,
      currency: "JPY",
      url: targetUrl,
      platform,
      error: "ページの読み込みに失敗しました。URLを確認するか手動で価格を入力してください。",
    };
  } finally {
    await page.close();
    await ctx.close();
  }
}
