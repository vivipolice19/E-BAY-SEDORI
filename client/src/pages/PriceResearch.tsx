import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { AppSettings } from "@shared/schema";
import {
  Search, ExternalLink, Loader2, TrendingUp, Store,
  ShoppingCart, FileSpreadsheet, Link2, RefreshCw,
  CheckCircle2, XCircle, ChevronDown, ChevronUp, Package, Users,
} from "lucide-react";
import { EbayReverseImageTools } from "@/components/EbayReverseImageTools";

// ---- Competitor Check Panel (used in research) ----
function CompetitorPanel({ keywords, exchangeRate }: { keywords: string; exchangeRate: number }) {
  const [enabled, setEnabled] = useState(false);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/ebay/competitors", keywords],
    queryFn: async () => {
      const res = await fetch(`/api/ebay/competitors?keywords=${encodeURIComponent(keywords)}`);
      if (!res.ok) throw new Error("取得失敗");
      return res.json() as Promise<{
        count: number; lowestPrice: number | null; highestPrice: number | null; avgPrice: number | null;
        items: Array<{ title: string; price: number; itemUrl: string; imageUrl?: string }>;
      }>;
    },
    enabled: enabled && !!keywords,
    staleTime: 3 * 60 * 1000,
  });

  if (!enabled) {
    return (
      <button onClick={() => setEnabled(true)}
        className="w-full text-[11px] font-medium py-1.5 rounded transition-colors bg-purple-100 hover:bg-purple-200 text-purple-800 dark:bg-purple-900 dark:text-purple-200 flex items-center justify-center gap-1"
        data-testid="button-competitor-check">
        <Users className="w-3 h-3" />ライバル出品を確認する
      </button>
    );
  }

  return (
    <div className="rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold flex items-center gap-1 text-purple-800 dark:text-purple-300">
          <Users className="w-3.5 h-3.5" />ライバル出品状況
        </p>
        <button onClick={() => refetch()} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
          <RefreshCw className="w-3 h-3" />更新
        </button>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />検索中...</div>
      ) : data ? (
        <div className="space-y-1.5">
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-md bg-background/80 border p-1.5">
              <p className="text-[10px] text-muted-foreground">出品数</p>
              <p className="text-sm font-bold">{data.count}件</p>
            </div>
            <div className="rounded-md bg-background/80 border p-1.5">
              <p className="text-[10px] text-muted-foreground">最安値</p>
              <p className="text-sm font-bold text-green-600">${data.lowestPrice?.toFixed(2) ?? "—"}</p>
            </div>
            <div className="rounded-md bg-background/80 border p-1.5">
              <p className="text-[10px] text-muted-foreground">平均価格</p>
              <p className="text-sm font-bold">${data.avgPrice?.toFixed(2) ?? "—"}</p>
            </div>
          </div>
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {data.items.slice(0, 6).map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded bg-background/60">
                {item.imageUrl && <img src={item.imageUrl} alt="" className="w-8 h-8 object-cover rounded flex-shrink-0" />}
                <span className="flex-1 truncate text-[10px]">{item.title}</span>
                <span className="font-bold text-green-700 dark:text-green-400 flex-shrink-0 text-xs">${item.price.toFixed(2)}</span>
                <a href={item.itemUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="w-3 h-3 text-muted-foreground hover:text-primary" />
                </a>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface EbayUrlResult {
  type: "item" | "search";
  keywords: string;
  itemId?: string;
  title?: string;
  priceJpy?: number;
  itemUrl?: string;
  imageUrl?: string;
  weightG?: number;
  mpn?: string; // MPN / Model Number from Item Specifics
  // Market comp data (for item URL)
  marketCount?: number;
  marketAvgJpy?: number;
  marketMinJpy?: number;
  marketMaxJpy?: number;
  marketAvgDaysToSell?: number;
  // Search stats
  count?: number;
  avgJpy?: number;
  minJpy?: number;
  maxJpy?: number;
  avgDaysToSell?: number;
  soldItems?: { title: string; priceJpy: number; imageUrl?: string; itemUrl: string; daysToSell?: number }[];
  error?: string;
}

/** 仕入れ候補の選択判定用（末尾スラッシュ・# の差で外れないようにする） */
function normalizeSourceItemUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    let s = x.href;
    if (s.endsWith("/") && x.pathname.length > 1) s = s.slice(0, -1);
    return s;
  } catch {
    return (u || "").trim();
  }
}

interface SourceUrlResult {
  title: string;
  price: number;
  currency: string;
  url: string;
  platform: string;
  imageUrls?: string[];
  sourceCondition?: string;
  sourceDescription?: string;
  ebayConditionMapped?: string;
  sourceWeightG?: number;
  error?: string;
}

interface SourceItem {
  title: string;
  price: number;
  url: string;
  imageUrl?: string;
  platform: string;
  condition?: string;
}

interface SourceApiResponse {
  mercari: { items: SourceItem[]; stats: any };
  yahoo: { items: SourceItem[]; stats: any };
  yahooShopping: { items: SourceItem[]; stats: any };
  rakuma: { items: SourceItem[]; stats: any };
  surugaya: { items: SourceItem[]; stats: any };
  overall: { stats: any };
  errors: Record<string, string>;
}

const PLATFORM_COLORS: Record<string, string> = {
  "メルカリ": "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800",
  "ヤフオク": "text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-950/30 dark:border-purple-800",
  "Yahoo!ショッピング": "text-cyan-600 bg-cyan-50 border-cyan-200 dark:bg-cyan-950/30 dark:border-cyan-800",
  "ラクマ": "text-pink-600 bg-pink-50 border-pink-200 dark:bg-pink-950/30 dark:border-pink-800",
  "駿河屋": "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800",
};

export default function PriceResearch() {
  const { toast } = useToast();
  const { data: settings } = useQuery<AppSettings>({ queryKey: ["/api/settings"] });

  const exchangeRate = settings?.exchangeRate || 150;
  const ebayFeeRate = settings?.ebayFeeRate || 13.25;
  const otherFees = settings?.otherFees || 500;
  const fwdDomestic = settings?.forwardingDomesticShipping ?? 800;
  const fwdAgent = settings?.forwardingAgentFee ?? 500;
  const fwdIntlBase = settings?.forwardingIntlBase ?? 2000;
  const fwdIntlPerGram = settings?.forwardingIntlPerGram ?? 3;

  // ---- localStorage persistence helpers ----
  const STORAGE_KEY = "priceResearch_v1";
  function loadSaved<T>(key: string, def: T): T {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return def; return JSON.parse(raw)[key] ?? def; } catch { return def; }
  }

  // Weight state for research stage (default 300g estimate)
  const [weightG, setWeightG] = useState<number>(() => loadSaved("weightG", 300));

  // eBay side (selling)
  const [ebayUrl, setEbayUrl] = useState<string>(() => loadSaved("ebayUrl", ""));
  const [ebayResult, setEbayResult] = useState<EbayUrlResult | null>(() => loadSaved("ebayResult", null));
  const [ebayOverrideJpy, setEbayOverrideJpy] = useState<number | null>(() => loadSaved("ebayOverrideJpy", null));

  // Source side (buying) - mode: "url" or "keyword"
  const [sourceMode, setSourceMode] = useState<"url" | "keyword">(() => loadSaved("sourceMode", "keyword"));
  const [sourceUrl, setSourceUrl] = useState<string>(() => loadSaved("sourceUrl", ""));
  const [sourceResult, setSourceResult] = useState<SourceUrlResult | null>(() => loadSaved("sourceResult", null));
  const [sourceKeyword, setSourceKeyword] = useState<string>(() => loadSaved("sourceKeyword", ""));
  const [fetchedKeyword, setFetchedKeyword] = useState<string>(() => loadSaved("fetchedKeyword", ""));
  const [showProfitOnly, setShowProfitOnly] = useState<boolean>(() => loadSaved("showProfitOnly", false));
  const [expandedPlatforms, setExpandedPlatforms] = useState<Record<string, boolean>>({
    "メルカリ": true, "ヤフオク": true, "Yahoo!ショッピング": true,
  });

  const [sourceOverrideJpy, setSourceOverrideJpy] = useState<number | null>(() => loadSaved("sourceOverrideJpy", null));
  const [selectedSourceUrl, setSelectedSourceUrl] = useState<string>(() => loadSaved("selectedSourceUrl", ""));
  const [selectedSourceImageUrls, setSelectedSourceImageUrls] = useState<string[]>(() => loadSaved("selectedSourceImageUrls", []));
  const [sourcePlatform, setSourcePlatform] = useState<string>(() => loadSaved("sourcePlatform", "その他"));
  const [isTranslating, setIsTranslating] = useState(false);
  // Source URL extracted metadata
  const [selectedSourceCondition, setSelectedSourceCondition] = useState<string | undefined>(() => loadSaved("selectedSourceCondition", undefined));
  const [selectedSourceDescription, setSelectedSourceDescription] = useState<string | undefined>(() => loadSaved("selectedSourceDescription", undefined));
  const [selectedEbayConditionMapped, setSelectedEbayConditionMapped] = useState<string | undefined>(() => loadSaved("selectedEbayConditionMapped", undefined));
  // Manual market (sold items) search for item-type eBay results
  const [extraMarketData, setExtraMarketData] = useState<{ avgJpy?: number; minJpy?: number; maxJpy?: number; count?: number } | null>(() => loadSaved("extraMarketData", null));

  // Manual overrides
  const [productName, setProductName] = useState<string>(() => loadSaved("productName", ""));
  const [manualEbayJpy, setManualEbayJpy] = useState<string>(() => loadSaved("manualEbayJpy", ""));
  const [manualSourceJpy, setManualSourceJpy] = useState<string>(() => loadSaved("manualSourceJpy", ""));

  // Persist state to localStorage on every change (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          weightG, ebayUrl, ebayResult, ebayOverrideJpy,
          sourceMode, sourceUrl, sourceResult, sourceKeyword, fetchedKeyword, showProfitOnly,
          sourceOverrideJpy, selectedSourceUrl, selectedSourceImageUrls, sourcePlatform,
          selectedSourceCondition, selectedSourceDescription, selectedEbayConditionMapped,
          extraMarketData, productName, manualEbayJpy, manualSourceJpy,
        }));
      } catch {}
    }, 400);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [weightG, ebayUrl, ebayResult, ebayOverrideJpy, sourceMode, sourceUrl, sourceResult,
      sourceKeyword, fetchedKeyword, showProfitOnly, sourceOverrideJpy, selectedSourceUrl,
      selectedSourceImageUrls, sourcePlatform, selectedSourceCondition, selectedSourceDescription,
      selectedEbayConditionMapped, extraMarketData, productName, manualEbayJpy, manualSourceJpy]);

  // Final values used for profit calc
  const ebayPriceJpy = ebayOverrideJpy ?? (manualEbayJpy ? parseInt(manualEbayJpy) : 0);
  const sourcePriceJpy = sourceOverrideJpy ?? (manualSourceJpy ? parseInt(manualSourceJpy) : 0);

  // Forwarding cost breakdown using actual weight
  const fwdIntlCost = fwdIntlBase + weightG * fwdIntlPerGram;
  const forwardingCost = fwdDomestic + fwdAgent + fwdIntlCost;

  const ebayFee = Math.round(ebayPriceJpy * (ebayFeeRate / 100));
  const profit = ebayPriceJpy - ebayFee - forwardingCost - otherFees - sourcePriceJpy;
  const profitRate = ebayPriceJpy > 0 ? (profit / ebayPriceJpy) * 100 : 0;
  const netFromEbay = ebayPriceJpy - ebayFee - forwardingCost - otherFees;
  const breakEven = Math.max(0, netFromEbay);

  /** 日本語比率（英語タイトルかどうかの判定用） */
  const jpRatio = (s: string) => {
    if (!s) return 0;
    const m = s.match(/[\u3040-\u30ff\u4e00-\u9fff]/g);
    return (m ? m.length : 0) / Math.max(s.length, 1);
  };

  /** eBay タイトル → 和訳（英語時）→ 仕入れキーワード欄に反映し、そのまま仕入れ検索を走らせる */
  const translateAndSearchSourcingKeyword = useCallback(async (raw: string) => {
    const kw = raw.trim().slice(0, 120);
    if (!kw) return;
    setSourceMode("keyword");
    setIsTranslating(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: kw }),
      });
      if (res.ok) {
        const data = (await res.json()) as { text?: string; translated?: boolean };
        const t = (data.text || "").trim();
        // API が translated:false でも、本文に日本語が入っていれば採用（MyMemory の不整合対策）
        const jaBetter =
          t.length >= 2 &&
          (jpRatio(t) >= 0.08 || jpRatio(t) > jpRatio(kw) + 0.03 || !!data.translated);
        const finalKw = jaBetter ? t.slice(0, 60) : kw.slice(0, 60);
        setSourceKeyword(finalKw);
        setFetchedKeyword(finalKw);
      } else {
        setSourceKeyword(kw.slice(0, 60));
        setFetchedKeyword(kw.slice(0, 60));
      }
    } catch {
      setSourceKeyword(kw.slice(0, 60));
      setFetchedKeyword(kw.slice(0, 60));
    } finally {
      setIsTranslating(false);
    }
  }, []);

  // eBay URL mutation
  const ebayMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await fetch("/api/ebay/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "取得失敗"); }
      return res.json() as Promise<EbayUrlResult>;
    },
    onSuccess: (data) => {
      setEbayResult(data);
      if (data.type === "item") {
        if (data.priceJpy) setEbayOverrideJpy(data.priceJpy);
        if (data.title) {
          setProductName(data.title);
          void translateAndSearchSourcingKeyword(data.title);
        }
        // Auto-set weight from Item Specifics if available
        if (data.weightG && data.weightG > 0) setWeightG(data.weightG);
      } else if (data.type === "search") {
        if (data.avgJpy) setEbayOverrideJpy(data.avgJpy);
        if (data.keywords) {
          setProductName(data.keywords);
          void translateAndSearchSourcingKeyword(data.keywords);
        }
      }
    },
    onError: (e: any) => setEbayResult({ type: "search", keywords: "", error: e.message }),
  });

  // eBay検索ページから遷移したURLを自動反映（?ebayUrl=...）
  const prefillHandledRef = useRef(false);
  useEffect(() => {
    if (prefillHandledRef.current) return;
    prefillHandledRef.current = true;
    try {
      const params = new URLSearchParams(window.location.search);
      const fromEbayUrl = (params.get("ebayUrl") || "").trim();
      if (!fromEbayUrl) return;
      setEbayUrl(fromEbayUrl);
      const titleFromSearch = (params.get("title") || "").trim();
      const autoFetch = params.get("autoFetch") !== "0";
      if (titleFromSearch) {
        setProductName(titleFromSearch.slice(0, 60));
        setFetchedKeyword("");
        // autoFetch で eBay を取る場合は onSuccess 側で和訳＋検索する（二重実行を避ける）
        if (!autoFetch || !fromEbayUrl.includes("ebay.")) {
          void translateAndSearchSourcingKeyword(titleFromSearch);
        }
      }
      if (autoFetch && fromEbayUrl.includes("ebay.")) {
        ebayMutation.mutate(fromEbayUrl);
      }
      // 手動リサーチ画面を再読み込みしても同じ自動実行を繰り返さない
      window.history.replaceState({}, "", "/research");
    } catch {
      // noop
    }
  }, [ebayMutation, translateAndSearchSourcingKeyword]);

  // Manual market (sold items) search mutation — for item-type results with no market data
  const marketSearchMutation = useMutation({
    mutationFn: async (keywords: string) => {
      const soldUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keywords)}&LH_Sold=1&LH_Complete=1`;
      const res = await fetch("/api/ebay/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: soldUrl }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "取得失敗"); }
      return res.json() as Promise<EbayUrlResult>;
    },
    onSuccess: (data) => {
      setExtraMarketData({
        avgJpy: data.avgJpy,
        minJpy: data.minJpy,
        maxJpy: data.maxJpy,
        count: data.count,
      });
    },
  });

  // Source URL mutation
  const sourceMutation = useMutation({
    onMutate: () => {
      setSourceResult(null);
      setSourceOverrideJpy(null);
      setSelectedSourceUrl("");
      setSelectedSourceImageUrls([]);
    },
    mutationFn: async (url: string) => {
      const ac = new AbortController();
      const SOURCE_URL_CLIENT_MS = 120_000;
      const tid = setTimeout(() => ac.abort(), SOURCE_URL_CLIENT_MS);
      try {
        const res = await fetch("/api/source-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          signal: ac.signal,
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || "取得失敗"); }
        return res.json() as Promise<SourceUrlResult>;
      } catch (e: any) {
        if (e?.name === "AbortError") {
          throw new Error(
            `URL取得がタイムアウトしました（${SOURCE_URL_CLIENT_MS / 1000}秒）。サーバー負荷やページの重さで遅延している可能性があります。再試行してください。`,
          );
        }
        throw e;
      } finally {
        clearTimeout(tid);
      }
    },
    onSuccess: (data) => {
      setSourceResult(data);
      const jpy = data.currency === "USD" ? Math.round(data.price * exchangeRate) : data.price;
      if (jpy > 0 && !data.error) {
        setSourceOverrideJpy(jpy);
        setSelectedSourceUrl(data.url);
        setSourcePlatform(data.platform);
        if (!productName && data.title) setProductName(data.title.slice(0, 60));
        if (data.sourceCondition) setSelectedSourceCondition(data.sourceCondition);
        if (data.sourceDescription) setSelectedSourceDescription(data.sourceDescription);
        if (data.ebayConditionMapped) setSelectedEbayConditionMapped(data.ebayConditionMapped);
        // Auto-apply weight from Mercari/Yahoo source URL
        if (data.sourceWeightG && data.sourceWeightG > 0) {
          setWeightG(data.sourceWeightG);
          toast({ title: `重量を自動設定しました: ${data.sourceWeightG}g`, description: "仕入れページから取得しました" });
        }
      }
    },
    onError: (e: any) => setSourceResult({ title: "", price: 0, currency: "JPY", url: sourceUrl, platform: "カスタムURL", error: e.message }),
  });

  // Keyword-based source price query
  const { data: sourcePriceData, isLoading: sourcePriceLoading, isError: sourcePriceError, refetch: refetchSourcePrices } = useQuery<SourceApiResponse>({
    queryKey: ["/api/source-prices", fetchedKeyword],
    queryFn: async () => {
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 96_000);
      try {
        const res = await fetch(`/api/source-prices/${encodeURIComponent(fetchedKeyword)}`, { signal: ac.signal });
        if (!res.ok) throw new Error("取得エラー");
        return res.json();
      } catch (e: any) {
        if (e?.name === "AbortError") throw new Error("仕入れ検索がタイムアウトしました（96秒）。サーバー負荷や Playwright 待機で時間がかかっている可能性があります。");
        throw e;
      } finally {
        clearTimeout(tid);
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
    enabled: !!fetchedKeyword,
  });

  // Save to list
  // Derive market data — extraMarketData (manual search) takes priority over auto-fetched values
  const marketAvgJpy = extraMarketData?.avgJpy ?? ebayResult?.marketAvgJpy ?? (ebayResult?.type === "search" ? ebayResult?.avgJpy : undefined);
  const marketMinJpy = extraMarketData?.minJpy ?? ebayResult?.marketMinJpy ?? (ebayResult?.type === "search" ? ebayResult?.minJpy : undefined);
  const marketMaxJpy = extraMarketData?.maxJpy ?? ebayResult?.marketMaxJpy ?? (ebayResult?.type === "search" ? ebayResult?.maxJpy : undefined);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/products", {
        name: productName || "手動リサーチ商品",
        ebayPrice: ebayPriceJpy / exchangeRate,
        ebayPriceJpy,
        ebayUrl: ebayResult?.itemUrl || (ebayUrl.includes("ebay.com") ? ebayUrl.trim() : undefined),
        ebayItemId: ebayResult?.itemId || undefined,
        sourcePrice: sourcePriceJpy || undefined,
        sourcePlatform: sourcePlatform || undefined,
        sourceUrl: selectedSourceUrl || sourceResult?.url || undefined,
        sourceImageUrls: (selectedSourceImageUrls.length > 0 ? selectedSourceImageUrls : sourceResult?.imageUrls) || undefined,
        forwardingCost,
        weight: weightG,
        profit: ebayPriceJpy > 0 && sourcePriceJpy > 0 ? profit : undefined,
        marketAvgJpy: marketAvgJpy ?? undefined,
        marketMinJpy: marketMinJpy ?? undefined,
        marketMaxJpy: marketMaxJpy ?? undefined,
        // Source URL metadata (Mercari condition/description)
        sourceCondition: selectedSourceCondition || undefined,
        sourceDescription: selectedSourceDescription || undefined,
        ebayConditionMapped: selectedEbayConditionMapped || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "保存しました", description: "保存リストに追加されました" });
    },
    onError: (e: any) => toast({ title: "エラー", description: e.message, variant: "destructive" }),
  });

  // Collect keyword search items
  const mercariItems = sourcePriceData?.mercari?.items || [];
  const yahooItems = sourcePriceData?.yahoo?.items || [];
  const yahooShoppingItems = sourcePriceData?.yahooShopping?.items || [];
  const rakumaItems = sourcePriceData?.rakuma?.items || [];
  const surugayaItems = sourcePriceData?.surugaya?.items || [];
  const allSourceItems = [...mercariItems, ...yahooItems, ...yahooShoppingItems, ...rakumaItems, ...surugayaItems];
  const filteredSourceItems = showProfitOnly && breakEven > 0
    ? allSourceItems.filter((i) => i.price <= breakEven)
    : allSourceItems;

  const triggerSourceSearch = (keyword: string) => {
    void translateAndSearchSourcingKeyword(keyword);
  };

  const handleSourceSelect = (item: SourceItem) => {
    setManualSourceJpy("");
    setSourceOverrideJpy(item.price);
    setSelectedSourceUrl(item.url);
    setSelectedSourceImageUrls(item.imageUrl ? [item.imageUrl] : []);
    setSourcePlatform(item.platform);
    if (!productName && item.title) setProductName(item.title.slice(0, 60));
  };

  const togglePlatform = (p: string) => setExpandedPlatforms((prev) => ({ ...prev, [p]: !prev[p] }));

  const renderSourceItems = (items: SourceItem[], platform: string) => {
    const errMsg = sourcePriceData?.errors?.[platform];
    const isExpanded = expandedPlatforms[platform] !== false;
    const displayItems = showProfitOnly && breakEven > 0
      ? items.filter((i) => i.price <= breakEven)
      : items;
    const colorClass = PLATFORM_COLORS[platform] || "text-gray-600";
    return (
      <div key={platform} className={`rounded-md border ${colorClass.split(" ").slice(1).join(" ")}`}>
        <button onClick={() => togglePlatform(platform)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium">
          <span className={colorClass.split(" ")[0]}>{platform} ({displayItems.length}件)</span>
          <div className="flex items-center gap-1.5">
            {(() => {
              const keyMap: Record<string, string> = { "メルカリ": "mercari", "ヤフオク": "yahoo", "Yahoo!ショッピング": "yahooShopping", "ラクマ": "rakuma", "駿河屋": "surugaya" };
              const key = keyMap[platform] || "mercari";
              const pd = sourcePriceData as any;
              return pd?.[key]?.stats ? (
                <span className="text-muted-foreground text-[10px]">
                  最安 ¥{pd[key].stats.min.toLocaleString()}
                </span>
              ) : null;
            })()}
            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </div>
        </button>
        {isExpanded && (
          <div className="px-2 pb-2 space-y-1 max-h-52 overflow-y-auto">
            {errMsg && (
              <p className="text-[10px] text-destructive px-1 pb-1 leading-snug break-words" title={errMsg}>
                取得エラー: {errMsg.length > 120 ? `${errMsg.slice(0, 120)}…` : errMsg}
              </p>
            )}
            {displayItems.length === 0 ? (
              <p className="text-[10px] text-muted-foreground px-1 pb-1">
                {showProfitOnly ? "利益商品なし" : errMsg ? "（上記のため候補なし）" : "このキーワードでは該当なし"}
              </p>
            ) : displayItems.map((item, i) => {
              const isSelected =
                normalizeSourceItemUrl(selectedSourceUrl) === normalizeSourceItemUrl(item.url) &&
                sourceOverrideJpy !== null &&
                Number(sourceOverrideJpy) === Number(item.price);
              const isProfitable = breakEven > 0 ? item.price <= breakEven : true;
              return (
                <div
                  key={`${item.url}-${i}`}
                  role="button"
                  tabIndex={0}
                  className={`relative z-[1] flex items-center gap-1.5 p-1.5 rounded cursor-pointer transition-colors border select-none ${
                    isSelected
                      ? "bg-orange-100 dark:bg-orange-900/40 border-orange-400"
                      : isProfitable
                        ? "bg-green-50/50 dark:bg-green-950/20 border-green-200/50 dark:border-green-800/30 hover:bg-green-100/70"
                        : "bg-background border-transparent hover:bg-muted"
                  }`}
                  onClick={() => handleSourceSelect(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSourceSelect(item);
                    }
                  }}>
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" className="w-8 h-8 object-cover rounded flex-shrink-0 border border-border/60" />
                  ) : (
                    <div className="w-8 h-8 rounded flex-shrink-0 bg-muted border border-dashed border-border flex items-center justify-center text-[7px] text-muted-foreground text-center leading-tight px-0.5">
                      画像なし
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] leading-snug line-clamp-2 text-foreground">{item.title}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className={`text-xs font-bold ${isProfitable ? "text-green-600 dark:text-green-400" : "text-foreground"}`}>
                      ¥{item.price.toLocaleString()}
                    </p>
                    {breakEven > 0 && (
                      <p className={`text-[9px] ${isProfitable ? "text-green-500" : "text-red-400"}`}>
                        {isProfitable ? `+¥${(breakEven - item.price).toLocaleString()}` : "赤字"}
                      </p>
                    )}
                  </div>
                  <a href={item.url} target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex-shrink-0 text-muted-foreground hover:text-foreground">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const sourceJpyDisplay = sourceResult
    ? sourceResult.currency === "USD" ? Math.round(sourceResult.price * exchangeRate) : sourceResult.price
    : 0;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />手動リサーチ
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          eBay URLで売値を調べ、仕入れ価格と突き合わせて利益を自動計算します
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* ===== LEFT: eBay Selling Side ===== */}
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
              <Search className="w-4 h-4" />eBay 売値リサーチ
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="flex gap-1.5">
              <Input
                type="url"
                placeholder="https://www.ebay.com/sch/... または /itm/..."
                value={ebayUrl}
                onChange={(e) => setEbayUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ebayUrl.includes("ebay.com") && ebayMutation.mutate(ebayUrl.trim())}
                className="text-xs h-9"
                data-testid="input-research-ebay-url" />
              <Button
                size="sm" className="h-9 px-3 bg-blue-600 hover:bg-blue-700 flex-shrink-0"
                onClick={() => ebayMutation.mutate(ebayUrl.trim())}
                disabled={ebayMutation.isPending || !ebayUrl.includes("ebay.com")}
                data-testid="button-fetch-research-ebay">
                {ebayMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "取得"}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">商品URL・検索URL・LH_Sold=1付き落札URLに対応</p>

            {ebayResult && (
              <div className={`rounded-lg p-3 border text-xs space-y-2 ${ebayResult.error ? "border-destructive/40 bg-destructive/5" : "border-blue-200 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/30"}`}>
                {ebayResult.error ? (
                  <p className="text-destructive">⚠ {ebayResult.error}</p>
                ) : ebayResult.type === "item" && ebayResult.priceJpy ? (
                  <>
                    <div className="flex items-start gap-2">
                      {ebayResult.imageUrl && <img src={ebayResult.imageUrl} alt="" className="w-14 h-14 object-cover rounded flex-shrink-0 border" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-foreground leading-snug line-clamp-2 mb-1">{ebayResult.title}</p>
                        {ebayResult.imageUrl && (
                          <div className="rounded-md border border-violet-200 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-950/30 p-2 mb-2 space-y-1">
                            <p className="text-[10px] font-semibold text-violet-800 dark:text-violet-200 flex items-center gap-1">
                              <Search className="w-3 h-3" />
                              画像で仕入先を探す（eBay検索と同じ）
                            </p>
                            <EbayReverseImageTools imageUrl={ebayResult.imageUrl} variant="panel" />
                            <p className="text-[9px] text-muted-foreground leading-snug">
                              GoogleがURLを拒否する場合は「画像を開く」→ 右クリックで「Googleレンズで画像を検索」が確実です。
                            </p>
                          </div>
                        )}
                        <p className="text-lg font-bold text-blue-700 dark:text-blue-300">¥{ebayResult.priceJpy.toLocaleString()}</p>
                        {ebayResult.weightG && (
                          <p className="text-[10px] text-green-600 font-medium">重量: {ebayResult.weightG}g（eBay取得）</p>
                        )}
                        <a href={ebayResult.itemUrl} target="_blank" rel="noreferrer"
                          className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5">
                          eBayで確認 <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    </div>

                    {/* Market comps (sold data) — auto or manual search */}
                    {(() => {
                      const hasAutoMarket = ebayResult.marketCount != null && ebayResult.marketCount > 0;
                      const mAvg = extraMarketData?.avgJpy ?? (hasAutoMarket ? ebayResult.marketAvgJpy : undefined);
                      const mMin = extraMarketData?.minJpy ?? (hasAutoMarket ? ebayResult.marketMinJpy : undefined);
                      const mMax = extraMarketData?.maxJpy ?? (hasAutoMarket ? ebayResult.marketMaxJpy : undefined);
                      const mCount = extraMarketData?.count ?? (hasAutoMarket ? ebayResult.marketCount : undefined);
                      const hasMarket = !!(mAvg || mMin || mMax);
                      return (
                        <div className="space-y-1.5">
                          {!hasMarket && (
                            <button
                              onClick={() => marketSearchMutation.mutate(ebayResult.keywords || ebayResult.title || "")}
                              disabled={marketSearchMutation.isPending}
                              className="w-full text-[11px] font-medium py-1.5 rounded transition-colors bg-green-100 hover:bg-green-200 text-green-800 dark:bg-green-900 dark:text-green-200 flex items-center justify-center gap-1 disabled:opacity-60"
                              data-testid="button-market-search">
                              {marketSearchMutation.isPending
                                ? <><Loader2 className="w-3 h-3 animate-spin" />落札相場を検索中...</>
                                : <><TrendingUp className="w-3 h-3" />落札相場（最安値・平均・最高値）を検索</>
                              }
                            </button>
                          )}
                          {hasMarket && (
                      <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-700 p-2 space-y-1.5">
                        <p className="text-[10px] font-semibold text-green-700 dark:text-green-300 flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" />
                          落札相場{mCount ? `（${mCount}件）` : ""}
                          {ebayResult.marketAvgDaysToSell && <span className="font-normal text-muted-foreground ml-1">平均{ebayResult.marketAvgDaysToSell}日で売却</span>}
                        </p>
                        <div className="grid grid-cols-3 gap-1">
                          {[
                            { label: "最安値", value: mMin, color: "text-blue-600" },
                            { label: "平均値", value: mAvg, color: "text-green-700 dark:text-green-300 font-bold" },
                            { label: "最高値", value: mMax, color: "text-orange-600" },
                          ].map(({ label, value, color }) => value ? (
                            <button key={label}
                              onClick={() => setEbayOverrideJpy(value)}
                              className={`rounded p-1.5 text-center border transition-colors hover:border-green-400 bg-background border-border ${ebayOverrideJpy === value ? "ring-1 ring-green-500" : ""}`}>
                              <div className="text-[9px] text-muted-foreground mb-0.5">{label}</div>
                              <div className={`text-[11px] font-bold ${color}`}>¥{value.toLocaleString()}</div>
                            </button>
                          ) : null)}
                        </div>
                        <p className="text-[9px] text-muted-foreground">クリックで計算に使用</p>
                      </div>
                          )}
                        </div>
                      );
                    })()}

                    <div className="flex gap-1.5">
                      <button onClick={() => setEbayOverrideJpy(ebayResult.priceJpy!)}
                        className={`flex-1 text-[11px] font-medium py-1.5 rounded transition-colors ${ebayOverrideJpy === ebayResult.priceJpy ? "bg-blue-600 text-white" : "bg-blue-100 hover:bg-blue-200 text-blue-800 dark:bg-blue-900 dark:text-blue-200"}`}
                        data-testid="button-use-research-ebay-price">
                        {ebayOverrideJpy === ebayResult.priceJpy ? "✓ 出品価格（現在）" : "この出品価格で計算"}
                      </button>
                      {ebayResult.title && (
                        <button
                          onClick={() => triggerSourceSearch(ebayResult.title!)}
                          disabled={isTranslating}
                          className={`flex-1 text-[11px] font-medium py-1.5 rounded transition-colors flex items-center justify-center gap-1 ${fetchedKeyword ? "bg-orange-500 text-white" : "bg-orange-100 hover:bg-orange-200 text-orange-800 dark:bg-orange-900 dark:text-orange-200"} disabled:opacity-60`}
                          data-testid="button-source-research-from-ebay">
                          {isTranslating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShoppingCart className="w-3 h-3" />}
                          {isTranslating ? "翻訳中..." : fetchedKeyword ? "仕入先検索済み" : "仕入先リサーチ"}
                        </button>
                      )}
                    </div>
                    {/* MPN / 型番 search button */}
                    {ebayResult.mpn && (
                      <button
                        onClick={() => void triggerSourceSearch(ebayResult.mpn!)}
                        className="w-full text-[11px] font-medium py-1.5 rounded transition-colors bg-indigo-100 hover:bg-indigo-200 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200 flex items-center justify-center gap-1"
                        data-testid="button-mpn-search">
                        <Search className="w-3 h-3" />型番「{ebayResult.mpn}」で仕入先検索
                      </button>
                    )}
                    {/* Competitor check for item-type eBay URL */}
                    {ebayResult.keywords && (
                      <CompetitorPanel keywords={ebayResult.keywords} exchangeRate={exchangeRate} />
                    )}
                  </>
                ) : ebayResult.type === "search" && ebayResult.count !== undefined ? (
                  ebayResult.count === 0 ? (
                    <p className="text-muted-foreground">結果が見つかりませんでした</p>
                  ) : (
                    <>
                      <div className="text-[10px] text-muted-foreground flex flex-wrap items-center gap-2">
                        <span>「{ebayResult.keywords}」— {ebayResult.count}件
                        {ebayUrl.includes("LH_Sold") ? "の落札データ" : "の出品"}</span>
                        {ebayResult.avgDaysToSell !== undefined && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium text-[10px]">
                            ⏱ 平均{ebayResult.avgDaysToSell}日で売却
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[
                          { label: "平均", value: ebayResult.avgJpy },
                          { label: "最安", value: ebayResult.minJpy },
                          { label: "最高", value: ebayResult.maxJpy },
                        ].map(({ label, value }) => value ? (
                          <button key={label}
                            onClick={() => value && setEbayOverrideJpy(value)}
                            className={`rounded-md p-2 text-center border transition-colors hover:border-blue-400 ${ebayOverrideJpy === value ? "bg-blue-600 text-white border-blue-600" : "bg-background border-border"}`}>
                            <div className="text-[9px] mb-0.5">{label}</div>
                            <div className="text-xs font-bold">¥{value.toLocaleString()}</div>
                          </button>
                        ) : null)}
                      </div>
                      {ebayResult.soldItems && ebayResult.soldItems.length > 0 && (
                        <div className="space-y-1.5 pt-1 border-t border-blue-200 dark:border-blue-700">
                          {ebayResult.soldItems.slice(0, 4).map((si, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              {si.imageUrl && <img src={si.imageUrl} alt="" className="w-8 h-8 object-cover rounded flex-shrink-0" />}
                              <span className="truncate flex-1 text-[10px] text-muted-foreground">{si.title.slice(0, 42)}</span>
                              {si.daysToSell !== undefined && (
                                <span className="flex-shrink-0 text-[10px] text-blue-600 dark:text-blue-400">{si.daysToSell}日</span>
                              )}
                              <span className="text-xs font-medium flex-shrink-0">¥{si.priceJpy.toLocaleString()}</span>
                              <a href={si.itemUrl} target="_blank" rel="noreferrer" className="flex-shrink-0">
                                <ExternalLink className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Source research button for search-type results */}
                      {ebayResult.keywords && (
                        <button
                          onClick={() => triggerSourceSearch(ebayResult.keywords)}
                          className={`w-full text-[11px] font-medium py-1.5 rounded transition-colors flex items-center justify-center gap-1 ${fetchedKeyword === ebayResult.keywords.trim().slice(0, 60) ? "bg-orange-500 text-white" : "bg-orange-100 hover:bg-orange-200 text-orange-800 dark:bg-orange-900 dark:text-orange-200"}`}
                          data-testid="button-source-research-from-ebay-search">
                          <ShoppingCart className="w-3 h-3" />
                          {fetchedKeyword === ebayResult.keywords.trim().slice(0, 60) ? "✓ 仕入先検索済み" : "仕入先リサーチ（メルカリ・ヤフオク・Yahoo!ショッピング）"}
                        </button>
                      )}
                      {/* Competitor check for search-type eBay results */}
                      {ebayResult.keywords && (
                        <CompetitorPanel keywords={ebayResult.keywords} exchangeRate={exchangeRate} />
                      )}
                    </>
                  )
                ) : null}
              </div>
            )}

            {/* Manual eBay price input */}
            <div className="border-t border-border pt-2 space-y-2">
              <Label className="text-[10px] text-muted-foreground font-medium">手動入力</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Input type="number" placeholder="eBay売値 ¥"
                    value={ebayOverrideJpy !== null ? String(ebayOverrideJpy) : manualEbayJpy}
                    onChange={(e) => { setEbayOverrideJpy(null); setManualEbayJpy(e.target.value); }}
                    className="h-8 text-sm" data-testid="input-manual-ebay-jpy" />
                </div>
                {ebayOverrideJpy !== null && (
                  <button onClick={() => { setEbayOverrideJpy(null); setManualEbayJpy(""); }}
                    className="text-[10px] text-muted-foreground hover:text-destructive underline whitespace-nowrap">
                    リセット
                  </button>
                )}
              </div>
              {/* Manual source research trigger: show when product name is set but no eBay URL result */}
              {!ebayResult && productName && (
                <button
                  onClick={() => triggerSourceSearch(productName)}
                  className={`w-full text-[11px] font-medium py-1.5 rounded transition-colors flex items-center justify-center gap-1 ${fetchedKeyword === productName.trim().slice(0, 60) ? "bg-orange-500 text-white" : "bg-orange-100 hover:bg-orange-200 text-orange-800 dark:bg-orange-900 dark:text-orange-200"}`}
                  data-testid="button-source-research-from-name">
                  <ShoppingCart className="w-3 h-3" />
                  {fetchedKeyword === productName.trim().slice(0, 60) ? "✓ 仕入先検索済み" : `「${productName.slice(0, 20)}」で仕入先リサーチ`}
                </button>
              )}
              {/* Competitor check for manual research (no eBay URL) */}
              {!ebayResult && productName && (
                <CompetitorPanel keywords={productName} exchangeRate={exchangeRate} />
              )}
            </div>
          </CardContent>
        </Card>

        {/* ===== RIGHT: Source (Buying) Side ===== */}
        <Card className="border-orange-200 dark:border-orange-800">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-1.5 text-orange-700 dark:text-orange-300">
                <ShoppingCart className="w-4 h-4" />仕入れ価格リサーチ
              </CardTitle>
              <span className="text-[10px] text-muted-foreground">
                URL専用取得と相場リサーチを分離
              </span>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">

            {/* ---- B. 相場リサーチ（複数サイト） ---- */}
            <div className="rounded-md border border-orange-200/70 dark:border-orange-800/50 p-2.5">
              <div className="text-[11px] font-semibold text-orange-700 dark:text-orange-300 mb-2">
                B. 相場リサーチ（キーワードで複数サイト比較）
              </div>
              <>
                <div className="flex gap-1.5">
                  <Input
                    placeholder="商品名・キーワードで仕入れ価格を検索"
                    value={sourceKeyword}
                    onChange={(e) => setSourceKeyword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && sourceKeyword.trim()) setFetchedKeyword(sourceKeyword.trim()); }}
                    className="text-xs h-9"
                    data-testid="input-research-source-keyword" />
                  <Button size="sm" className="h-9 px-3 bg-orange-500 hover:bg-orange-600 flex-shrink-0"
                    onClick={() => sourceKeyword.trim() && setFetchedKeyword(sourceKeyword.trim())}
                    disabled={sourcePriceLoading || !sourceKeyword.trim()}
                    data-testid="button-search-source-keyword">
                    {sourcePriceLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  </Button>
                  {fetchedKeyword && (
                    <Button size="sm" variant="outline" className="h-9 px-2 flex-shrink-0"
                      onClick={() => refetchSourcePrices()}
                      disabled={sourcePriceLoading}
                      data-testid="button-refresh-source-prices">
                      <RefreshCw className={`w-3.5 h-3.5 ${sourcePriceLoading ? "animate-spin" : ""}`} />
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground -mt-1">
                  メルカリ・ヤフオク・Yahoo!ショッピングを同時検索（Playwright経由）
                </p>

                {/* Results controls */}
                {fetchedKeyword && (
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-muted-foreground">「{fetchedKeyword}」の仕入れ相場</p>
                    <label className="flex items-center gap-1 cursor-pointer text-[10px]">
                      <input type="checkbox" checked={showProfitOnly}
                        onChange={(e) => setShowProfitOnly(e.target.checked)}
                        className="rounded w-3 h-3" data-testid="checkbox-profit-only" />
                      <span className={`font-medium ${showProfitOnly ? "text-green-600" : "text-muted-foreground"}`}>
                        利益商品のみ
                      </span>
                    </label>
                  </div>
                )}

                {sourcePriceLoading && (
                  <div className="space-y-2">
                    {["メルカリ", "ヤフオク", "Yahoo!ショッピング", "ラクマ", "駿河屋"].map((p) => (
                      <div key={p} className="h-10 rounded-md bg-muted animate-pulse" />
                    ))}
                    <p className="text-[10px] text-muted-foreground text-center">仕入れサイトから価格を取得中...（最大1分程度）</p>
                  </div>
                )}

                {sourcePriceError && (
                  <p className="text-xs text-destructive">取得エラーが発生しました。再試行してください。</p>
                )}

                {!sourcePriceLoading && fetchedKeyword && sourcePriceData && (
                  <div className="space-y-2">
                    {/* Summary stats */}
                    {sourcePriceData.overall.stats ? (
                      <div className="grid grid-cols-3 gap-1.5 text-center">
                        {[
                          { label: "最安値", val: sourcePriceData.overall.stats.min },
                          { label: "平均値", val: sourcePriceData.overall.stats.avg },
                          { label: "最高値", val: sourcePriceData.overall.stats.max },
                        ].map(({ label, val }) => (
                          <button key={label}
                            onClick={() => { setSourceOverrideJpy(val); setSourcePlatform("相場"); }}
                            className={`rounded-md border p-1.5 transition-colors hover:border-orange-400 ${sourceOverrideJpy === val ? "bg-orange-500 text-white border-orange-500" : "bg-background border-border"}`}>
                            <div className="text-[9px] opacity-70">{label}</div>
                            <div className="text-xs font-bold">¥{val.toLocaleString()}</div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-center text-muted-foreground py-1.5 px-2 rounded-md border border-dashed border-border bg-muted/30">
                        全サイト合算の相場は出せませんでした（候補0件）。下の<strong className="text-foreground">サイト別一覧</strong>で各エラーや0件を確認してください。
                      </p>
                    )}

                    <div className="text-[10px] text-muted-foreground rounded-md border border-dashed border-border px-2 py-1.5">
                      サイト内一覧の表示は停止しました。下の各サイトリンクから直接確認してください。
                    </div>

                    {/* External links */}
                    <div className="flex flex-wrap gap-1 pt-1 border-t border-border">
                      {[
                        { name: "メルカリ", url: `https://jp.mercari.com/search?keyword=${encodeURIComponent(fetchedKeyword)}&status=on_sale` },
                        { name: "ヤフオク", url: `https://auctions.yahoo.co.jp/search/search?p=${encodeURIComponent(fetchedKeyword)}` },
                        { name: "ラクマ", url: `https://fril.jp/s?query=${encodeURIComponent(fetchedKeyword)}` },
                        { name: "駿河屋", url: `https://www.suruga-ya.jp/search?search_word=${encodeURIComponent(fetchedKeyword)}` },
                        { name: "楽天", url: `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(fetchedKeyword)}/` },
                        { name: "Amazon", url: `https://www.amazon.co.jp/s?k=${encodeURIComponent(fetchedKeyword)}` },
                      ].map((p) => (
                        <a key={p.name} href={p.url} target="_blank" rel="noreferrer"
                          className="text-[10px] px-2 py-0.5 rounded border bg-background hover:bg-muted transition-colors text-muted-foreground hover:text-foreground flex items-center gap-0.5">
                          {p.name} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {!fetchedKeyword && (
                  <div className="text-center py-6 text-muted-foreground">
                    <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-xs">キーワードを入力して検索</p>
                    <p className="text-[10px] mt-0.5 opacity-70">eBay URLを取得すると商品名が自動入力されます</p>
                  </div>
                )}
              </>
            </div>

            {/* ---- A. URL専用取得 ---- */}
            <div className="rounded-md border border-orange-300/80 dark:border-orange-700/60 p-2.5 bg-orange-50/30 dark:bg-orange-950/20">
              <div className="text-[11px] font-semibold text-orange-800 dark:text-orange-200 mb-2">
                A. URL専用（価格・画像・説明を自動取得）
              </div>
              <>
                <div className="flex gap-1.5">
                  <Input
                    type="url"
                    placeholder="https://jp.mercari.com/item/... または .../shops/product/... など"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sourceUrl.startsWith("http") && sourceMutation.mutate(sourceUrl.trim())}
                    className="text-xs h-9"
                    data-testid="input-research-source-url" />
                  <Button
                    size="sm" className="h-9 px-3 bg-orange-500 hover:bg-orange-600 flex-shrink-0"
                    onClick={() => sourceMutation.mutate(sourceUrl.trim())}
                    disabled={sourceMutation.isPending || !sourceUrl.startsWith("http")}
                    data-testid="button-fetch-research-source">
                    {sourceMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "取得"}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground -mt-1">
                  楽天・Amazon・メルカリ（個人出品 / Shops 商品URL）・ヤフオク・Yahoo!ショッピング等に対応
                </p>

                {sourceMutation.isPending && (
                  <p className="text-[11px] text-muted-foreground text-center py-2 animate-pulse">
                    ページから価格を取得中... (最大約2分)
                  </p>
                )}

                {sourceResult && (
                  <div className={`rounded-lg p-3 border text-xs space-y-2 ${sourceResult.error && sourceResult.price === 0 ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800" : "border-orange-200 dark:border-orange-700 bg-orange-50/50 dark:bg-orange-950/30"}`}>
                    {sourceResult.price === 0 ? (
                      <div className="space-y-1">
                        <p className="text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5" />価格を自動取得できませんでした
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {sourceResult.error || "このサイトは自動取得に対応していません。手動で価格を入力してください。"}
                        </p>
                        {sourceResult.platform !== "カスタムURL" && (
                          <a href={sourceUrl} target="_blank" rel="noreferrer"
                            className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                            {sourceResult.platform}でページを確認 <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start gap-2">
                          {sourceResult.imageUrls && sourceResult.imageUrls.length > 0 && (
                            <div className="flex gap-1 flex-shrink-0 flex-wrap max-w-[100px]">
                              {sourceResult.imageUrls.slice(0, 4).map((url, idx) => (
                                <img key={idx} src={url} alt="" className="w-12 h-12 object-cover rounded border" />
                              ))}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] text-muted-foreground mb-0.5">{sourceResult.platform}</div>
                            <p className="text-[11px] text-foreground leading-snug line-clamp-2 mb-1">{sourceResult.title}</p>
                            <p className="text-lg font-bold text-orange-700 dark:text-orange-300">¥{sourceJpyDisplay.toLocaleString()}</p>
                            {ebayPriceJpy > 0 && sourceJpyDisplay > 0 && (
                              <p className={`text-[10px] font-medium flex items-center gap-0.5 ${sourceJpyDisplay <= breakEven ? "text-green-600" : "text-red-500"}`}>
                                {sourceJpyDisplay <= breakEven
                                  ? <><CheckCircle2 className="w-3 h-3" />利益商品 — 上限まで ¥{(breakEven - sourceJpyDisplay).toLocaleString()} 余裕</>
                                  : <><XCircle className="w-3 h-3" />赤字 — 仕入れ上限 ¥{breakEven.toLocaleString()}</>
                                }
                              </p>
                            )}
                          </div>
                        </div>
                        {/* Condition and description from Mercari/Yahoo */}
                        {sourceResult.sourceCondition && (
                          <div className="p-2 rounded-md bg-orange-100 dark:bg-orange-900/40 border border-orange-200 dark:border-orange-800 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-semibold text-orange-700 dark:text-orange-300">商品状態:</span>
                              <span className="text-[11px] font-medium">{sourceResult.sourceCondition}</span>
                              {sourceResult.ebayConditionMapped && (
                                <span className="text-[10px] bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded font-medium">
                                  → eBay: {sourceResult.ebayConditionMapped}
                                </span>
                              )}
                            </div>
                            {sourceResult.sourceDescription && (
                              <div>
                                <p className="text-[10px] text-orange-600 dark:text-orange-400 mb-0.5">説明文（抜粋）:</p>
                                <p className="text-[10px] text-foreground line-clamp-3 leading-relaxed">{sourceResult.sourceDescription.slice(0, 200)}</p>
                              </div>
                            )}
                          </div>
                        )}
                        <button onClick={() => {
                          setSourceOverrideJpy(sourceJpyDisplay);
                          setSelectedSourceUrl(sourceResult.url);
                          setSourcePlatform(sourceResult.platform);
                          if (sourceResult.sourceCondition) setSelectedSourceCondition(sourceResult.sourceCondition);
                          if (sourceResult.sourceDescription) setSelectedSourceDescription(sourceResult.sourceDescription);
                          if (sourceResult.ebayConditionMapped) setSelectedEbayConditionMapped(sourceResult.ebayConditionMapped);
                        }}
                          className={`w-full text-[11px] font-medium py-1.5 rounded transition-colors ${sourceOverrideJpy === sourceJpyDisplay ? "bg-orange-500 text-white" : "bg-orange-100 hover:bg-orange-200 text-orange-800 dark:bg-orange-900 dark:text-orange-200"}`}
                          data-testid="button-use-research-source-price">
                          {sourceOverrideJpy === sourceJpyDisplay ? "✓ 使用中（条件・説明文も取得済み）" : "この価格で計算（条件・説明文も取得）"}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            </div>

            {/* Selected source price display */}
            {sourceOverrideJpy !== null && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700">
                <CheckCircle2 className="w-4 h-4 text-orange-600 flex-shrink-0" />
                <div className="flex-1 min-w-0 text-xs">
                  <span className="font-medium text-orange-700 dark:text-orange-300">選択中: </span>
                  <span className="font-bold">¥{sourceOverrideJpy.toLocaleString()}</span>
                  <span className="text-muted-foreground ml-1">({sourcePlatform})</span>
                </div>
                <button onClick={() => { setSourceOverrideJpy(null); setSelectedSourceUrl(""); setManualSourceJpy(""); }}
                  className="text-[10px] text-muted-foreground hover:text-destructive underline flex-shrink-0">
                  解除
                </button>
              </div>
            )}

            {/* Manual source price */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-[10px] text-muted-foreground">手動入力（¥）</Label>
                <Input type="number" placeholder="仕入れ価格 ¥"
                  value={sourceOverrideJpy !== null ? "" : manualSourceJpy}
                  disabled={sourceOverrideJpy !== null}
                  onChange={(e) => { setManualSourceJpy(e.target.value); setSelectedSourceUrl(""); }}
                  className="h-8 text-sm" data-testid="input-manual-source-jpy" />
              </div>
              <div className="flex-1">
                <Label className="text-[10px] text-muted-foreground">仕入れ先</Label>
                <Select value={sourcePlatform} onValueChange={setSourcePlatform}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-research-platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="メルカリ">メルカリ</SelectItem>
                    <SelectItem value="ヤフオク">ヤフオク</SelectItem>
                    <SelectItem value="Yahoo!ショッピング">Yahoo!ショッピング</SelectItem>
                    <SelectItem value="Amazon JP">Amazon JP</SelectItem>
                    <SelectItem value="楽天市場">楽天市場</SelectItem>
                    <SelectItem value="相場">相場（平均）</SelectItem>
                    <SelectItem value="店舗">店舗</SelectItem>
                    <SelectItem value="その他">その他</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===== PROFIT SUMMARY ===== */}
      {(ebayPriceJpy > 0 || sourcePriceJpy > 0) && (
        <Card className={`border-2 ${profit >= 0 && sourcePriceJpy > 0 ? "border-green-400 bg-green-50/50 dark:bg-green-950/20" : sourcePriceJpy > 0 ? "border-red-400 bg-red-50/50 dark:bg-red-950/20" : "border-border"}`}>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left: cost breakdown */}
              <div className="space-y-1.5 text-xs">
                <p className="font-semibold text-foreground mb-2">費用内訳</p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">eBay売値</span>
                  <span className="font-medium">{ebayPriceJpy > 0 ? `¥${ebayPriceJpy.toLocaleString()}` : "—"}</span>
                </div>
                {ebayPriceJpy > 0 && <>
                  <div className="flex justify-between text-destructive">
                    <span>eBay手数料 ({ebayFeeRate}%)</span>
                    <span>-¥{ebayFee.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-orange-500 font-medium">
                    <span>発送代行費合計</span>
                    <span>-¥{forwardingCost.toLocaleString()}</span>
                  </div>
                  <div className="pl-3 space-y-0.5 text-muted-foreground border-l-2 border-orange-200">
                    <div className="flex justify-between">
                      <span>　国内送料</span>
                      <span>¥{fwdDomestic.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>　代行手数料</span>
                      <span>¥{fwdAgent.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>　国際送料（{weightG}g）</span>
                      <span>¥{fwdIntlCost.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <span>　重量（概算）</span>
                      <input
                        type="number"
                        value={weightG}
                        onChange={e => setWeightG(Math.max(1, parseInt(e.target.value) || 300))}
                        className="w-16 h-5 text-xs border border-border rounded px-1 text-foreground bg-background"
                        data-testid="input-research-weight"
                      />
                      <span>g</span>
                    </div>
                  </div>
                  <div className="flex justify-between text-destructive">
                    <span>その他費用</span>
                    <span>-¥{otherFees.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between font-medium text-foreground border-t border-border pt-1">
                    <span>仕入れ上限（損益ゼロ）</span>
                    <span className="text-primary">¥{breakEven.toLocaleString()}</span>
                  </div>
                </>}
                {sourcePriceJpy > 0 && (
                  <div className="flex justify-between text-destructive">
                    <span>仕入れ価格 ({sourcePlatform})</span>
                    <span>-¥{sourcePriceJpy.toLocaleString()}</span>
                  </div>
                )}
              </div>
              {/* Right: profit display + save */}
              <div className="flex flex-col items-center justify-center gap-3">
                {ebayPriceJpy > 0 && sourcePriceJpy > 0 ? (
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-0.5">純利益</p>
                    <p className={`text-3xl font-bold ${profit >= 0 ? "text-green-600" : "text-red-500"}`}
                      data-testid="text-research-profit">
                      {profit >= 0 ? "+" : ""}¥{profit.toLocaleString()}
                    </p>
                    <p className={`text-sm font-medium mt-0.5 ${profit >= 0 ? "text-green-600" : "text-red-500"}`}
                      data-testid="text-research-profit-rate">
                      利益率 {profitRate.toFixed(1)}%
                    </p>
                  </div>
                ) : (
                  <div className="text-center">
                    {ebayPriceJpy > 0 && (
                      <>
                        <p className="text-xs text-muted-foreground">仕入れ上限</p>
                        <p className="text-2xl font-bold text-primary">¥{breakEven.toLocaleString()}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">この金額以下で仕入れれば利益が出ます</p>
                      </>
                    )}
                    {!sourcePriceJpy && (
                      <p className="text-xs text-muted-foreground mt-1">仕入れ価格を選択すると利益が計算されます</p>
                    )}
                  </div>
                )}

                <div className="w-full space-y-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">商品名</Label>
                    <Input placeholder="商品名（任意）"
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      className="h-8 text-xs" data-testid="input-research-product-name" />
                  </div>
                  <div className="flex gap-2">
                    <Button className="flex-1 gap-2 h-9" onClick={() => saveMutation.mutate()}
                      disabled={saveMutation.isPending || !ebayPriceJpy}
                      data-testid="button-save-research">
                      {saveMutation.isPending
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <FileSpreadsheet className="w-4 h-4" />}
                      保存リストに追加
                    </Button>
                    <Button variant="outline" className="h-9 px-3 text-xs text-muted-foreground" title="リサーチをリセット"
                      onClick={() => {
                        localStorage.removeItem("priceResearch_v1");
                        setEbayUrl(""); setEbayResult(null); setEbayOverrideJpy(null);
                        setSourceMode("keyword"); setSourceUrl(""); setSourceResult(null);
                        setSourceKeyword(""); setFetchedKeyword(""); setShowProfitOnly(false);
                        setSourceOverrideJpy(null); setSelectedSourceUrl(""); setSelectedSourceImageUrls([]);
                        setSourcePlatform("その他"); setSelectedSourceCondition(undefined);
                        setSelectedSourceDescription(undefined); setSelectedEbayConditionMapped(undefined);
                        setExtraMarketData(null); setProductName(""); setManualEbayJpy(""); setManualSourceJpy(""); setWeightG(300);
                        toast({ title: "リセットしました" });
                      }}
                      data-testid="button-reset-research">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== EMPTY STATE ===== */}
      {ebayPriceJpy === 0 && sourcePriceJpy === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Store className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">eBay URLを入力して売値を調べましょう</p>
          <p className="text-xs mt-1">取得後、仕入れキーワードが自動入力されます</p>
        </div>
      )}
    </div>
  );
}
