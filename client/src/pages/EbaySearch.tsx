import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryClient, parseApiResponse } from "@/lib/queryClient";
import type { EbayItem, AppSettings, EbaySoldResearchMeta } from "@shared/schema";
import {
  Search, Bookmark, ExternalLink, Package, Tag,
  Filter, Loader2, TrendingUp, Store, X, Zap,
  ShoppingCart, CheckCircle2, RefreshCw, Calendar, AlertTriangle,
} from "lucide-react";
import { EbayReverseImageTools } from "@/components/EbayReverseImageTools";

const SORT_OPTIONS = [
  { value: "BestMatch", label: "ベストマッチ" },
  { value: "PricePlusShippingLowest", label: "価格が安い順" },
  { value: "PricePlusShippingHighest", label: "価格が高い順" },
  { value: "StartTimeNewest", label: "新着順" },
];

const DAYS_OPTIONS = [
  { value: "0", label: "期間制限なし" },
  { value: "7", label: "直近7日" },
  { value: "14", label: "直近14日" },
  { value: "30", label: "直近30日" },
  { value: "60", label: "直近60日" },
  { value: "90", label: "直近90日" },
];

/** 落札終了が直近この期間内のデータに絞る（相場の鮮度） */
const SOLD_WINDOW_OPTIONS = [
  { value: "30", label: "落札: 直近30日" },
  { value: "60", label: "落札: 直近60日" },
  { value: "90", label: "落札: 直近90日" },
  { value: "180", label: "落札: 直近180日" },
  { value: "0", label: "落札: 期間指定なし" },
];

// eBay US 公式トップレベルカテゴリ
const EBAY_CATEGORIES = [
  { id: "", name: "すべてのカテゴリ" },
  { id: "20081", name: "骨董品" },
  { id: "550", name: "美術" },
  { id: "2984", name: "赤ちゃん" },
  { id: "267", name: "本" },
  { id: "12576", name: "ビジネス・産業" },
  { id: "625", name: "カメラ&写真" },
  { id: "15032", name: "携帯電話およびアクセサリー" },
  { id: "11450", name: "衣料品、靴、アクセサリー" },
  { id: "3342", name: "硬貨と紙幣" },
  { id: "1", name: "コレクターズアイテム" },
  { id: "58058", name: "コンピューター/タブレットおよびネットワーク" },
  { id: "293", name: "家電" },
  { id: "14339", name: "工芸品" },
  { id: "238", name: "人形とクマ" },
  { id: "11232", name: "映画&テレビ" },
  { id: "6028", name: "eBay Motors" },
  { id: "45100", name: "エンターテイメント関連の記念品" },
  { id: "172008", name: "ギフトカードとクーポン" },
  { id: "26395", name: "健康と美容" },
  { id: "11700", name: "ホーム&ガーデン" },
  { id: "281", name: "ジュエリー&時計" },
  { id: "11233", name: "音楽" },
  { id: "619", name: "楽器と機材" },
  { id: "1281", name: "ペット用品" },
  { id: "7996", name: "陶器とガラス" },
  { id: "10542", name: "不動産" },
  { id: "316", name: "専門サービス" },
  { id: "888", name: "スポーツ用品" },
  { id: "64482", name: "スポーツ記念品、カード、ファンショップ" },
  { id: "260", name: "切手" },
  { id: "1305", name: "チケット&体験" },
  { id: "220", name: "おもちゃ&ホビー" },
  { id: "3252", name: "旅行" },
  { id: "1249", name: "ビデオゲーム&ゲーム機" },
  { id: "99", name: "その他すべて" },
];

// 売れ筋タブ用の絞り込みカテゴリ（セドリ向け主要カテゴリ）
const POPULAR_CATEGORIES = [
  { id: "1249", name: "ビデオゲーム&ゲーム機" },
  { id: "11450", name: "衣料品・ファッション" },
  { id: "293", name: "家電" },
  { id: "220", name: "おもちゃ&ホビー" },
  { id: "625", name: "カメラ&写真" },
  { id: "281", name: "ジュエリー&時計" },
  { id: "64482", name: "スポーツカード" },
  { id: "550", name: "アート" },
];

const QUICK_KEYWORDS = [
  "Nintendo Switch", "Pokemon Cards", "Sony Camera", "Vintage Watch",
  "Gundam Model", "Air Jordan", "iPhone", "MacBook",
];

interface SourceItem {
  title: string;
  price: number;
  url: string;
  imageUrl?: string;
  platform: string;
}

interface PlatformData {
  items: SourceItem[];
  stats: { min: number; max: number; avg: number; median: number; count: number } | null;
}

interface SourceApiResponse {
  mercari: PlatformData;
  yahoo: PlatformData;
  yahooShopping: PlatformData;
  rakuma?: PlatformData;
  surugaya?: PlatformData;
  overall: { stats: { min: number; max: number; avg: number; median: number; count: number } | null };
  errors: Record<string, string>;
}

const PLATFORM_STYLES: Record<string, { label: string; color: string; linkColor: string }> = {
  "メルカリ": { label: "メルカリ", color: "text-red-600 dark:text-red-400", linkColor: "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800" },
  "ヤフオク": { label: "ヤフオク", color: "text-purple-600 dark:text-purple-400", linkColor: "bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800" },
  "Yahoo!ショッピング": { label: "Yahoo!ショッピング", color: "text-yellow-600 dark:text-yellow-400", linkColor: "bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800" },
  "ラクマ": { label: "ラクマ", color: "text-teal-600 dark:text-teal-400", linkColor: "bg-teal-50 dark:bg-teal-950 border-teal-200 dark:border-teal-800" },
  "駿河屋": { label: "駿河屋", color: "text-amber-700 dark:text-amber-400", linkColor: "bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800" },
};

function PriceResultList({
  items,
  platform,
  onSelectItem,
  limitBreakEven,
  selectedUrl,
}: {
  items: SourceItem[];
  platform: string;
  onSelectItem: (price: number, platform: string, url: string, imageUrls?: string[]) => void;
  limitBreakEven: number;
  selectedUrl: string;
}) {
  if (items.length === 0) return null;
  const style = PLATFORM_STYLES[platform] || { label: platform, color: "text-foreground", linkColor: "bg-muted border-border" };
  return (
    <div className="space-y-1">
      {items.slice(0, 10).map((item, i) => {
        const isGood = item.price <= limitBreakEven;
        const isSelected = selectedUrl === item.url;
        return (
          <div key={i}
            className={`flex items-center gap-2 p-2 rounded-md border text-xs transition-all ${
              isSelected
                ? "ring-2 ring-primary bg-primary/5 border-primary"
                : isGood
                ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
                : "bg-muted/40 border-border"
            }`}
            data-testid={`price-item-${platform}-${i}`}>
            {item.imageUrl && (
              <img src={item.imageUrl} alt="" className="w-8 h-8 object-cover rounded flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="truncate text-foreground leading-tight">{item.title}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => onSelectItem(item.price, platform, item.url, item.imageUrl ? [item.imageUrl] : undefined)}
                className={`font-bold px-1.5 py-0.5 rounded transition-colors hover:opacity-80 ${
                  isSelected
                    ? "text-primary bg-primary/10"
                    : isGood
                    ? "text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900"
                    : "text-foreground bg-muted hover:bg-muted/80"
                }`}
                data-testid={`set-price-${platform}-${i}`}>
                ¥{item.price.toLocaleString()}
              </button>
              {isGood && !isSelected && <CheckCircle2 className="w-3 h-3 text-green-500" />}
              {isSelected && <CheckCircle2 className="w-3 h-3 text-primary" />}
              <button onClick={() => window.open(item.url, "_blank")}
                className="text-muted-foreground hover:text-foreground transition-colors"
                data-testid={`open-item-${platform}-${i}`}>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EbayUrlPanel({
  forwardingCost,
  otherFees,
  ebayFeeRate,
  exchangeRate,
  onUsePrice,
  overridePrice,
}: {
  forwardingCost: number;
  otherFees: number;
  ebayFeeRate: number;
  exchangeRate: number;
  onUsePrice: (priceJpy: number, url: string) => void;
  overridePrice: number | null;
}) {
  const [ebayUrl, setEbayUrl] = useState("");
  const [result, setResult] = useState<{
    type: "item" | "search"; keywords: string;
    title?: string; priceJpy?: number; itemUrl?: string; imageUrl?: string;
    count?: number; avgJpy?: number; minJpy?: number; maxJpy?: number;
    avgDaysToSell?: number;
    soldItems?: { title: string; priceJpy: number; imageUrl?: string; itemUrl: string; daysToSell?: number }[];
    error?: string;
  } | null>(null);

  const mutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await fetch("/api/ebay/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "取得失敗"); }
      return res.json();
    },
    onSuccess: (data) => setResult(data),
    onError: (e: any) => setResult({ type: "search", keywords: "", error: e.message }),
  });

  const calcProfit = (sellJpy: number) => {
    const fee = Math.round(sellJpy * (ebayFeeRate / 100));
    return sellJpy - fee - forwardingCost - otherFees;
  };

  const isValid = ebayUrl.trim().includes("ebay.com");
  const usedJpy = result?.type === "item" ? result.priceJpy : result?.avgJpy;
  const isUsed = overridePrice !== null && overridePrice === usedJpy;

  return (
    <div className="border-2 border-blue-300 dark:border-blue-700 rounded-lg p-3 bg-blue-50/40 dark:bg-blue-950/20">
      <p className="text-[11px] font-semibold text-blue-800 dark:text-blue-300 mb-2 flex items-center gap-1">
        <Search className="w-3.5 h-3.5" />eBay URL入力（手動リサーチ結果を反映）
      </p>
      <div className="flex gap-1.5 mb-2">
        <Input
          type="url"
          placeholder="https://www.ebay.com/sch/... または .../itm/..."
          value={ebayUrl}
          onChange={(e) => setEbayUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && isValid && mutation.mutate(ebayUrl.trim())}
          className="text-xs h-8 flex-1 border-blue-300"
          data-testid="input-ebay-url" />
        <Button size="sm" className="h-8 px-3 text-xs bg-blue-600 hover:bg-blue-700"
          onClick={() => mutation.mutate(ebayUrl.trim())}
          disabled={mutation.isPending || !isValid}
          data-testid="button-fetch-ebay-url">
          {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "取得"}
        </Button>
      </div>

      {result && (
        <div className={`rounded-md p-2.5 border text-xs space-y-2 ${result.error ? "border-destructive/40 bg-destructive/5" : "border-blue-300 dark:border-blue-700 bg-white dark:bg-blue-950/40"}`}>
          {result.error ? (
            <p className="text-destructive text-[11px]">⚠ {result.error}</p>
          ) : result.type === "item" && result.priceJpy ? (
            <>
              <div className="flex items-start gap-2">
                {result.imageUrl && <img src={result.imageUrl} alt="" className="w-12 h-12 object-cover rounded flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-foreground leading-snug line-clamp-2 mb-1">{result.title}</p>
                  <p className="text-base font-bold text-blue-700 dark:text-blue-300">¥{result.priceJpy.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground">純利益予測: <span className={calcProfit(result.priceJpy) >= 0 ? "text-green-600 font-medium" : "text-red-500 font-medium"}>
                    {calcProfit(result.priceJpy) >= 0 ? "+" : ""}¥{calcProfit(result.priceJpy).toLocaleString()}
                  </span></p>
                </div>
              </div>
              <button onClick={() => onUsePrice(result.priceJpy!, ebayUrl.trim())}
                className={`w-full text-[11px] font-medium py-1.5 rounded transition-colors ${isUsed ? "bg-blue-600 text-white" : "bg-blue-100 hover:bg-blue-200 text-blue-800 dark:bg-blue-900 dark:hover:bg-blue-800 dark:text-blue-200"}`}
                data-testid="button-use-ebay-price">
                {isUsed ? "✓ この価格を使用中" : "この価格でeBay売値を計算"}
              </button>
            </>
          ) : result.type === "search" && result.count !== undefined ? (
            result.count === 0 ? (
              <p className="text-muted-foreground text-[11px]">結果が見つかりませんでした。キーワードを変えてお試しください。</p>
            ) : (
              <>
                <div className="text-[10px] text-muted-foreground mb-1 flex flex-wrap items-center gap-1.5">
                  <span>「{result.keywords}」 — {result.count}件の{ebayUrl.includes("LH_Sold") ? "落札済み" : "出品"}データ</span>
                  {result.avgDaysToSell !== undefined && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium">
                      ⏱ 平均{result.avgDaysToSell}日で売却
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1 mb-2">
                  {[
                    { label: "平均", value: result.avgJpy, highlight: true },
                    { label: "最安", value: result.minJpy },
                    { label: "最高", value: result.maxJpy },
                  ].map(({ label, value, highlight }) => value ? (
                    <div key={label} className={`rounded p-1.5 text-center ${highlight ? "bg-blue-100 dark:bg-blue-900/50" : "bg-muted/50"}`}>
                      <div className="text-[9px] text-muted-foreground">{label}</div>
                      <div className={`text-xs font-bold ${highlight ? "text-blue-700 dark:text-blue-300" : ""}`}>¥{value.toLocaleString()}</div>
                      <div className={`text-[9px] ${calcProfit(value) >= 0 ? "text-green-600" : "text-red-500"}`}>
                        純利益 {calcProfit(value) >= 0 ? "+" : ""}¥{calcProfit(value).toLocaleString()}
                      </div>
                    </div>
                  ) : null)}
                </div>
                {result.soldItems && result.soldItems.length > 0 && (
                  <div className="space-y-1">
                    {result.soldItems.slice(0, 4).map((si, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 text-[10px]">
                        {si.imageUrl && <img src={si.imageUrl} alt="" className="w-7 h-7 object-cover rounded flex-shrink-0" />}
                        <span className="truncate flex-1 text-muted-foreground">{si.title.slice(0, 45)}</span>
                        {si.daysToSell !== undefined && (
                          <span className="flex-shrink-0 text-blue-600 dark:text-blue-400">{si.daysToSell}日</span>
                        )}
                        <span className="font-medium flex-shrink-0">¥{si.priceJpy.toLocaleString()}</span>
                        <a href={si.itemUrl} target="_blank" rel="noreferrer" className="flex-shrink-0 hover:opacity-70">
                          <ExternalLink className="w-3 h-3 text-muted-foreground" />
                        </a>
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={() => result.avgJpy && onUsePrice(result.avgJpy, ebayUrl.trim())}
                  disabled={!result.avgJpy}
                  className={`w-full text-[11px] font-medium py-1.5 rounded transition-colors mt-1 ${isUsed ? "bg-blue-600 text-white" : "bg-blue-100 hover:bg-blue-200 text-blue-800 dark:bg-blue-900 dark:hover:bg-blue-800 dark:text-blue-200"}`}
                  data-testid="button-use-ebay-avg-price">
                  {isUsed ? "✓ 平均価格を使用中" : "平均価格でeBay売値を計算"}
                </button>
              </>
            )
          ) : null}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground mt-1.5">商品URL・検索URL（LH_Sold=1付き落札URLも可）対応</p>
    </div>
  );
}

function CustomUrlPanel({
  limitBreakEven,
  exchangeRate,
  onSelectItem,
  selectedUrl,
}: {
  limitBreakEven: number;
  exchangeRate: number;
  onSelectItem: (price: number, platform: string, url: string, imageUrls?: string[]) => void;
  selectedUrl: string;
}) {
  const [customUrl, setCustomUrl] = useState("");
  type UrlResult = {
    title: string;
    price: number;
    currency: string;
    platform: string;
    imageUrls?: string[];
    sourceCondition?: string;
    sourceDescription?: string;
    ebayConditionMapped?: string;
    error?: string;
  };
  const [urlResult, setUrlResult] = useState<UrlResult | null>(null);
  const [bulkUrlsText, setBulkUrlsText] = useState("");
  const [bulkResults, setBulkResults] = useState<Array<UrlResult & { url: string; priceInJpy: number }>>([]);
  const [isBulkFetching, setIsBulkFetching] = useState(false);

  const fetchUrlInfo = async (url: string): Promise<UrlResult> => {
    const res = await fetch("/api/source-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    return parseApiResponse<UrlResult>(res);
  };

  const urlMutation = useMutation({
    mutationFn: async (url: string) => {
      return fetchUrlInfo(url);
    },
    onSuccess: (data) => setUrlResult(data),
    onError: (e: any) => setUrlResult({ title: "", price: 0, currency: "JPY", platform: "カスタムURL", error: e.message }),
  });

  const handleBulkFetch = async () => {
    const matches = Array.from(
      new Set(
        (bulkUrlsText.match(/https?:\/\/[^\s"'<>]+/g) || [])
          .map((u) => u.replace(/[),.;]+$/, "").trim())
          .filter((u) => u.startsWith("http")),
      ),
    ).slice(0, 15);
    if (matches.length === 0) return;
    setIsBulkFetching(true);
    setBulkResults([]);
    const out: Array<UrlResult & { url: string; priceInJpy: number }> = [];
    for (const url of matches) {
      const res = await fetch("/api/source-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      let data: UrlResult;
      try {
        data = await parseApiResponse<UrlResult>(res);
      } catch (e: any) {
        out.push({
          url,
          title: "",
          price: 0,
          currency: "JPY",
          platform: "カスタムURL",
          error: e?.message || "取得失敗",
          priceInJpy: 0,
        });
        continue;
      }
      const jpy = data.currency === "USD" ? Math.round(data.price * exchangeRate) : data.price;
      out.push({ ...data, url, priceInJpy: jpy || 0 });
    }
    out.sort((a, b) => {
      const av = a.priceInJpy > 0 ? a.priceInJpy : Number.MAX_SAFE_INTEGER;
      const bv = b.priceInJpy > 0 ? b.priceInJpy : Number.MAX_SAFE_INTEGER;
      return av - bv;
    });
    setBulkResults(out);
    setIsBulkFetching(false);
  };

  const handleFetch = () => {
    const trimmed = customUrl.trim();
    if (!trimmed.startsWith("http")) return;
    setUrlResult(null);
    urlMutation.mutate(trimmed);
  };

  const priceInJpy = urlResult
    ? urlResult.currency === "USD" ? Math.round(urlResult.price * exchangeRate) : urlResult.price
    : 0;
  const isGood = priceInJpy > 0 && priceInJpy <= limitBreakEven;
  const isSelected = selectedUrl === customUrl.trim() && priceInJpy > 0;

  return (
    <div className="border border-border rounded-lg p-3 bg-muted/20">
      <p className="text-[11px] font-semibold text-foreground mb-2 flex items-center gap-1">
        <ExternalLink className="w-3.5 h-3.5" />カスタムURL仕入れ調査
      </p>
      <div className="flex gap-1.5 mb-2">
        <Input
          type="url"
          placeholder="https://... 仕入先URLを貼り付け"
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleFetch()}
          className="text-xs h-8 flex-1"
          data-testid="input-custom-url" />
        <Button size="sm" className="h-8 px-3 text-xs" onClick={handleFetch}
          disabled={urlMutation.isPending || !customUrl.trim().startsWith("http")}
          data-testid="button-fetch-url">
          {urlMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "取得"}
        </Button>
      </div>
      {urlResult && (
        <div className={`rounded-md p-2 border text-xs space-y-1 ${urlResult.error ? "border-destructive/40 bg-destructive/5" : isGood ? "border-green-400 bg-green-50 dark:bg-green-950" : "border-border bg-background"}`}>
          {urlResult.error ? (
            <p className="text-destructive text-[11px]">⚠ {urlResult.error}</p>
          ) : urlResult.price === 0 ? (
            <p className="text-muted-foreground text-[11px]">価格を自動取得できませんでした。手動で入力してください。</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground truncate flex-1">{urlResult.platform}</span>
                {isGood && <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">✅ 利益商品</span>}
              </div>
              <p className="text-xs text-foreground leading-snug line-clamp-2">{urlResult.title}</p>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm">
                  ¥{priceInJpy.toLocaleString()}
                  {urlResult.currency === "USD" && <span className="text-[10px] text-muted-foreground ml-1">(${urlResult.price.toFixed(2)})</span>}
                </span>
                <button
                  onClick={() => { onSelectItem(priceInJpy, urlResult.platform, customUrl.trim(), urlResult.imageUrls); }}
                  className={`text-[11px] font-medium px-2 py-0.5 rounded transition-colors ${isSelected ? "bg-primary text-primary-foreground" : isGood ? "bg-green-600 text-white hover:bg-green-700" : "bg-muted hover:bg-muted/80 text-foreground"}`}
                  data-testid="button-select-custom-url">
                  {isSelected ? "選択済み ✓" : "この価格を使用"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="mt-2 pt-2 border-t border-border space-y-1.5">
        <p className="text-[11px] font-medium text-foreground">Google画像検索で見つけたURLを一括解析</p>
        <textarea
          value={bulkUrlsText}
          onChange={(e) => setBulkUrlsText(e.target.value)}
          placeholder={"Google画像検索結果などのURLを複数行で貼り付け\nhttps://jp.mercari.com/item/...\nhttps://auctions.yahoo.co.jp/...\n..."}
          className="w-full min-h-[84px] resize-y rounded-md border border-border bg-background px-2 py-1.5 text-[11px]"
          data-testid="textarea-bulk-source-urls"
        />
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={handleBulkFetch}
            disabled={isBulkFetching || !bulkUrlsText.trim()}
            data-testid="button-bulk-fetch-urls"
          >
            {isBulkFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "URL一覧を解析"}
          </Button>
          <span className="text-[10px] text-muted-foreground self-center">最大15件 / 価格順</span>
        </div>
        {bulkResults.length > 0 && (
          <div className="max-h-44 overflow-y-auto space-y-1">
            {bulkResults.map((r, idx) => {
              const good = r.priceInJpy > 0 && r.priceInJpy <= limitBreakEven;
              const selected = selectedUrl === r.url && r.priceInJpy > 0;
              return (
                <div key={`${r.url}-${idx}`} className={`rounded border p-1.5 text-[11px] ${r.error ? "border-destructive/40 bg-destructive/5" : selected ? "border-primary bg-primary/5" : good ? "border-green-300 bg-green-50 dark:bg-green-950/30" : "border-border bg-background"}`}>
                  {r.error ? (
                    <p className="text-destructive">⚠ {r.error}</p>
                  ) : (
                    <>
                      <p className="text-[10px] text-muted-foreground">{r.platform}</p>
                      <p className="line-clamp-2 text-foreground">{r.title || r.url}</p>
                      {r.sourceCondition && <p className="text-[10px] text-amber-700 dark:text-amber-300">状態: {r.sourceCondition}{r.ebayConditionMapped ? ` → eBay ${r.ebayConditionMapped}` : ""}</p>}
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="font-bold">
                          {r.priceInJpy > 0 ? `¥${r.priceInJpy.toLocaleString()}` : "価格不明"}
                          {r.currency === "USD" && r.price > 0 && <span className="text-[10px] text-muted-foreground ml-1">(${r.price.toFixed(2)})</span>}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => window.open(r.url, "_blank")}
                            className="text-muted-foreground hover:text-foreground"
                            data-testid={`button-open-bulk-url-${idx}`}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => r.priceInJpy > 0 && onSelectItem(r.priceInJpy, r.platform, r.url, r.imageUrls)}
                            disabled={r.priceInJpy <= 0}
                            className={`text-[10px] px-2 py-0.5 rounded ${selected ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-foreground"} disabled:opacity-50`}
                            data-testid={`button-select-bulk-url-${idx}`}
                          >
                            {selected ? "選択済み" : "使う"}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">Amazon JP・楽天・ヤフオク・メルカリ等どのURLでも対応</p>
    </div>
  );
}

function SourcePanel({
  item,
  settings,
  onSave,
  isSaving,
  onClose,
}: {
  item: EbayItem;
  settings: AppSettings | undefined;
  onSave: (item: EbayItem, sourcePrice?: number, sourcePlatform?: string, sourceUrl?: string, sourceImageUrls?: string[]) => void;
  isSaving: boolean;
  onClose: () => void;
}) {
  /** 仕入れAPI用（英語タイトル→日本語にしてから検索） */
  const [searchKeyword, setSearchKeyword] = useState("");
  const [fetchKeyword, setFetchKeyword] = useState("");
  const [isTranslatingKeyword, setIsTranslatingKeyword] = useState(true);
  const [sourcePrice, setSourcePrice] = useState("");
  const [sourcePlatform, setSourcePlatform] = useState("メルカリ");
  const [selectedSourceUrl, setSelectedSourceUrl] = useState("");
  const [selectedSourceImageUrls, setSelectedSourceImageUrls] = useState<string[]>([]);
  const [showProfitOnly, setShowProfitOnly] = useState(false);
  // eBay override: user manually found a better eBay price via URL input
  const [ebayOverrideJpy, setEbayOverrideJpy] = useState<number | null>(null);
  const [ebayOverrideUrl, setEbayOverrideUrl] = useState("");

  const exchangeRate = settings?.exchangeRate || 150;
  const ebayFeeRate = settings?.ebayFeeRate || 13.25;
  const otherFees = settings?.otherFees || 500;

  // Forwarding cost calculation (default 300g estimate for research stage)
  const fwdDomestic = settings?.forwardingDomesticShipping ?? 800;
  const fwdAgent = settings?.forwardingAgentFee ?? 500;
  const fwdIntlBase = settings?.forwardingIntlBase ?? 2000;
  const fwdIntlPerGram = settings?.forwardingIntlPerGram ?? 3;
  const [estWeight, setEstWeight] = useState(300);
  const fwdIntl = fwdIntlBase + Math.round(estWeight * fwdIntlPerGram);
  const forwardingCost = fwdDomestic + fwdAgent + fwdIntl;
  const [showCostBreakdown, setShowCostBreakdown] = useState(false);

  const ebayPriceJpy = ebayOverrideJpy !== null ? ebayOverrideJpy : Math.round(item.price * exchangeRate);
  const isOverridden = ebayOverrideJpy !== null;
  const ebayFee = Math.round(ebayPriceJpy * (ebayFeeRate / 100));
  const totalCosts = ebayFee + forwardingCost + otherFees;
  const netFromEbay = ebayPriceJpy - totalCosts;

  const limitBreakEven = Math.max(0, netFromEbay);
  const limit20 = Math.max(0, Math.round(netFromEbay * 0.80));
  const limit30 = Math.max(0, Math.round(netFromEbay * 0.70));

  const sourcePriceNum = sourcePrice ? parseInt(sourcePrice) : null;
  const realProfit = sourcePriceNum !== null ? netFromEbay - sourcePriceNum : null;
  const realProfitRate = realProfit !== null && ebayPriceJpy > 0
    ? (realProfit / ebayPriceJpy) * 100 : null;

  useEffect(() => {
    let cancelled = false;
    setIsTranslatingKeyword(true);
    setFetchKeyword("");
    setSearchKeyword("");
    const raw = item.title.trim().slice(0, 60);
    if (!raw) {
      setSearchKeyword("");
      setFetchKeyword("");
      setIsTranslatingKeyword(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: raw }),
        });
        const data = res.ok ? await res.json() : null;
        const jp = data?.translated ? String(data.text).trim().slice(0, 60) : raw;
        if (!cancelled) {
          setSearchKeyword(jp);
          setFetchKeyword(jp);
        }
      } catch {
        if (!cancelled) {
          setSearchKeyword(raw);
          setFetchKeyword(raw);
        }
      } finally {
        if (!cancelled) setIsTranslatingKeyword(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.itemId, item.title]);

  const { data: priceData, isLoading: priceLoading, refetch: refetchPrices, isError: priceError } = useQuery<SourceApiResponse>({
    queryKey: ["/api/source-prices", fetchKeyword],
    queryFn: async () => {
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 80_000);
      try {
        const res = await fetch(`/api/source-prices/${encodeURIComponent(fetchKeyword)}`, { signal: ac.signal });
        if (!res.ok) throw new Error("取得エラー");
        return res.json();
      } catch (e: any) {
        if (e?.name === "AbortError") throw new Error("仕入れ検索がタイムアウトしました。サーバーに Chromium が無い可能性があります（Render ではビルドに playwright install を追加）。");
        throw e;
      } finally {
        clearTimeout(tid);
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
    enabled: !!fetchKeyword && !isTranslatingKeyword,
  });

  const handleSearch = async () => {
    const kw = searchKeyword.trim().slice(0, 60);
    if (!kw) return;
    setIsTranslatingKeyword(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: kw }),
      });
      const data = res.ok ? await res.json() : null;
      const jp = data?.translated ? String(data.text).trim().slice(0, 60) : kw;
      setSearchKeyword(jp);
      setFetchKeyword(jp);
    } catch {
      setFetchKeyword(kw);
      setSearchKeyword(kw);
    } finally {
      setIsTranslatingKeyword(false);
    }
  };

  const handleSelectItem = (price: number, platform: string, url: string, imageUrls?: string[]) => {
    setSourcePrice(String(price));
    setSourcePlatform(platform);
    setSelectedSourceUrl(url);
    setSelectedSourceImageUrls(imageUrls || []);
  };

  // Collect all items and sort: profitable first, then by price asc
  const mercariItems = priceData?.mercari?.items || [];
  const yahooItems = priceData?.yahoo?.items || [];
  const yahooShoppingItems = priceData?.yahooShopping?.items || [];
  const rakumaItems = priceData?.rakuma?.items || [];
  const surugayaItems = priceData?.surugaya?.items || [];
  const allItems = [...mercariItems, ...yahooItems, ...yahooShoppingItems, ...rakumaItems, ...surugayaItems];
  const goodItems = allItems.filter(it => it.price <= limitBreakEven);

  // Sort each platform's items: profitable first
  const sortItems = (items: SourceItem[]) =>
    showProfitOnly
      ? items.filter(it => it.price <= limitBreakEven).sort((a, b) => a.price - b.price)
      : [...items].sort((a, b) => {
          const aGood = a.price <= limitBreakEven ? 0 : 1;
          const bGood = b.price <= limitBreakEven ? 0 : 1;
          if (aGood !== bGood) return aGood - bGood;
          return a.price - b.price;
        });

  const EXTERNAL_LINKS = [
    {
      id: "amazon",
      name: "Amazon JP",
      color: "text-orange-600 dark:text-orange-400",
      getUrl: (q: string) => `https://www.amazon.co.jp/s?k=${encodeURIComponent(q)}&s=price-asc-rank`,
    },
    {
      id: "rakuten",
      name: "楽天市場",
      color: "text-pink-600 dark:text-pink-400",
      getUrl: (q: string) => `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(q)}/?s=6`,
    },
  ];

  return (
    <div className="flex flex-col gap-3 text-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground line-clamp-2 leading-snug text-xs">{item.title}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-base font-bold text-blue-600">${item.price.toFixed(2)}</span>
            <span className={`text-xs ${isOverridden ? "text-blue-700 dark:text-blue-400 font-semibold" : "text-muted-foreground"}`}>
              ≈ ¥{ebayPriceJpy.toLocaleString()}
              {isOverridden && <span className="ml-1 text-[10px] bg-blue-100 dark:bg-blue-900 px-1 rounded">手動</span>}
            </span>
            {isOverridden && (
              <button onClick={() => { setEbayOverrideJpy(null); setEbayOverrideUrl(""); }}
                className="text-[10px] text-muted-foreground hover:text-destructive underline">
                リセット
              </button>
            )}
            <Badge variant="secondary" className="text-[10px]">{item.condition}</Badge>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 flex-shrink-0">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {item.imageUrl && (
        <div className="rounded-md border border-violet-200 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-950/30 p-2 space-y-1.5">
          <p className="text-[10px] font-semibold text-violet-800 dark:text-violet-200 flex items-center gap-1">
            <Search className="w-3 h-3" />
            画像で仕入先を探す（転用写真の追跡）
          </p>
          <div className="flex gap-2 items-start">
            <img
              src={item.imageUrl}
              alt=""
              className="w-14 h-14 object-contain rounded bg-background border flex-shrink-0"
            />
            <div className="flex-1 min-w-0 space-y-1">
              <EbayReverseImageTools imageUrl={item.imageUrl} variant="panel" />
              <p className="text-[9px] text-muted-foreground leading-snug">
                同一商品の価格競争の手掛かりに。GoogleがURLを拒否する場合は「画像を開く」→ 右クリックで「Googleレンズで画像を検索」が確実です。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Profit targets */}
      <div className="grid grid-cols-3 gap-1">
        <div className="p-1.5 rounded-md bg-gray-50 dark:bg-gray-900 text-center border">
          <p className="text-[10px] text-muted-foreground leading-tight">損益ゼロ<br/>仕入れ上限</p>
          <p className="text-xs font-bold text-foreground mt-0.5">¥{limitBreakEven.toLocaleString()}</p>
        </div>
        <div className="p-1.5 rounded-md bg-blue-50 dark:bg-blue-950 text-center border border-blue-200 dark:border-blue-800">
          <p className="text-[10px] text-muted-foreground leading-tight">利益率20%<br/>の上限</p>
          <p className="text-xs font-bold text-blue-700 dark:text-blue-400 mt-0.5">¥{limit20.toLocaleString()}</p>
        </div>
        <div className="p-1.5 rounded-md bg-green-50 dark:bg-green-950 text-center border border-green-200 dark:border-green-800">
          <p className="text-[10px] text-muted-foreground leading-tight">利益率30%<br/>の上限</p>
          <p className="text-xs font-bold text-green-700 dark:text-green-400 mt-0.5">¥{limit30.toLocaleString()}</p>
        </div>
      </div>

      {/* Cost breakdown - expandable */}
      <div className="rounded-md border border-border overflow-hidden">
        <button
          onClick={() => setShowCostBreakdown(!showCostBreakdown)}
          className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 text-xs"
        >
          <span className="font-medium text-foreground flex items-center gap-1.5">
            諸経費内訳（合計 ¥{totalCosts.toLocaleString()}）
          </span>
          <span className="text-muted-foreground">{showCostBreakdown ? "▲" : "▼"}</span>
        </button>
        {showCostBreakdown && (
          <div className="p-3 space-y-2">
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <div className="flex justify-between p-1.5 bg-muted/20 rounded border">
                <span className="text-muted-foreground">eBay手数料 ({ebayFeeRate}%)</span>
                <span className="font-medium text-red-500">-¥{ebayFee.toLocaleString()}</span>
              </div>
              <div className="flex justify-between p-1.5 bg-muted/20 rounded border">
                <span className="text-muted-foreground">国内送料</span>
                <span className="font-medium">-¥{fwdDomestic.toLocaleString()}</span>
              </div>
              <div className="flex justify-between p-1.5 bg-muted/20 rounded border">
                <span className="text-muted-foreground">代行手数料</span>
                <span className="font-medium">-¥{fwdAgent.toLocaleString()}</span>
              </div>
              <div className="flex justify-between p-1.5 bg-muted/20 rounded border">
                <span className="text-muted-foreground">国際送料 ({estWeight}g)</span>
                <span className="font-medium">-¥{fwdIntl.toLocaleString()}</span>
              </div>
              <div className="flex justify-between p-1.5 bg-muted/20 rounded border">
                <span className="text-muted-foreground">その他費用</span>
                <span className="font-medium">-¥{otherFees.toLocaleString()}</span>
              </div>
              <div className="flex justify-between p-1.5 bg-primary/10 rounded border border-primary/20 font-medium">
                <span className="text-primary">合計諸経費</span>
                <span className="text-primary">-¥{totalCosts.toLocaleString()}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground whitespace-nowrap">推定重量(g)</span>
              <input
                type="number"
                value={estWeight}
                onChange={(e) => setEstWeight(parseInt(e.target.value) || 0)}
                className="h-6 w-20 text-xs border rounded px-1.5 bg-background text-foreground"
                placeholder="300"
              />
              <span className="text-muted-foreground text-[10px]">変更すると国際送料が再計算されます</span>
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Auto price search */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
            <Store className="w-3.5 h-3.5" />仕入れ価格を自動検索
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowProfitOnly(!showProfitOnly)}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${showProfitOnly ? "bg-green-100 dark:bg-green-900 border-green-400 text-green-700 dark:text-green-300" : "bg-background border-border text-muted-foreground hover:bg-muted"}`}
              data-testid="button-profit-filter">
              利益品のみ
            </button>
            {priceData && (
              <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={() => refetchPrices()}
                data-testid="button-refetch-prices">
                <RefreshCw className="w-3 h-3" />再検索
              </Button>
            )}
          </div>
        </div>

        <div className="flex gap-1 mb-2">
          <Input value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="text-xs h-7 flex-1" placeholder="検索キーワード（日本語推奨）"
            data-testid="input-source-keyword" />
          <Button size="sm" className="h-7 text-xs px-2" onClick={handleSearch}
            data-testid="button-search-prices">
            <Search className="w-3 h-3" />
          </Button>
        </div>

        {/* Loading */}
        {(isTranslatingKeyword || priceLoading) && (
          <div className="flex flex-col gap-1.5 py-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              <span>
                {isTranslatingKeyword
                  ? "タイトルを日本語に変換しています…"
                  : "メルカリ・ヤフオク・Yahoo!ショッピング・ラクマ・駿河屋を検索中..."}
              </span>
            </div>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {/* Results */}
        {!isTranslatingKeyword && !priceLoading && priceData && (
          <div className="space-y-3">
            {/* Summary banner */}
            {goodItems.length > 0 && (
              <div className="px-2 py-1.5 rounded-md bg-green-50 dark:bg-green-950 border border-green-300 dark:border-green-700 text-xs text-green-700 dark:text-green-400">
                ✅ <strong>{goodItems.length}件</strong>が利益商品（上限¥{limitBreakEven.toLocaleString()}以下）
                {selectedSourceUrl && (
                  <span className="ml-1 text-green-600 dark:text-green-500">・URL選択済み</span>
                )}
              </div>
            )}
            {allItems.length === 0 && (
              <div className="text-xs text-center py-2 space-y-1">
                {priceData.errors?.["全体"] ? (
                  <p className="text-destructive font-medium">{priceData.errors["全体"]}</p>
                ) : (
                  <p className="text-muted-foreground">商品が見つかりませんでした。日本語キーワードで試してみてください。</p>
                )}
                {priceData.errors?.["全体"] && (
                  <p className="text-[10px] text-muted-foreground">
                    Render ではビルドに <code className="bg-muted px-1 rounded">npm run playwright:install-chromium</code> を含めると Chromium が入ります。
                  </p>
                )}
              </div>
            )}

            {/* Mercari */}
            {sortItems(mercariItems).length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                    メルカリ ({priceData.mercari.items.length}件
                    {goodItems.filter(i => i.platform === "メルカリ").length > 0 &&
                      <span className="text-green-600 dark:text-green-400">・利益{goodItems.filter(i => i.platform === "メルカリ").length}件</span>
                    })
                  </span>
                  {priceData.mercari.stats && (
                    <span className="text-[10px] text-muted-foreground">
                      最安¥{priceData.mercari.stats.min.toLocaleString()} 平均¥{priceData.mercari.stats.avg.toLocaleString()}
                    </span>
                  )}
                </div>
                <PriceResultList items={sortItems(mercariItems)} platform="メルカリ"
                  onSelectItem={handleSelectItem} limitBreakEven={limitBreakEven} selectedUrl={selectedSourceUrl} />
              </div>
            )}

            {/* Yahoo Auctions */}
            {sortItems(yahooItems).length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-purple-600 dark:text-purple-400">
                    ヤフオク ({priceData.yahoo.items.length}件
                    {goodItems.filter(i => i.platform === "ヤフオク").length > 0 &&
                      <span className="text-green-600 dark:text-green-400">・利益{goodItems.filter(i => i.platform === "ヤフオク").length}件</span>
                    })
                  </span>
                  {priceData.yahoo.stats && (
                    <span className="text-[10px] text-muted-foreground">
                      最安¥{priceData.yahoo.stats.min.toLocaleString()} 平均¥{priceData.yahoo.stats.avg.toLocaleString()}
                    </span>
                  )}
                </div>
                <PriceResultList items={sortItems(yahooItems)} platform="ヤフオク"
                  onSelectItem={handleSelectItem} limitBreakEven={limitBreakEven} selectedUrl={selectedSourceUrl} />
              </div>
            )}

            {/* Yahoo Shopping */}
            {sortItems(yahooShoppingItems).length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-yellow-600 dark:text-yellow-400">
                    Yahoo!ショッピング ({priceData.yahooShopping.items.length}件
                    {goodItems.filter(i => i.platform === "Yahoo!ショッピング").length > 0 &&
                      <span className="text-green-600 dark:text-green-400">・利益{goodItems.filter(i => i.platform === "Yahoo!ショッピング").length}件</span>
                    })
                  </span>
                  {priceData.yahooShopping.stats && (
                    <span className="text-[10px] text-muted-foreground">
                      最安¥{priceData.yahooShopping.stats.min.toLocaleString()} 平均¥{priceData.yahooShopping.stats.avg.toLocaleString()}
                    </span>
                  )}
                </div>
                <PriceResultList items={sortItems(yahooShoppingItems)} platform="Yahoo!ショッピング"
                  onSelectItem={handleSelectItem} limitBreakEven={limitBreakEven} selectedUrl={selectedSourceUrl} />
              </div>
            )}

            {/* ラクマ */}
            {sortItems(rakumaItems).length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-teal-600 dark:text-teal-400">
                    ラクマ ({(priceData.rakuma?.items.length ?? 0)}件
                    {goodItems.filter(i => i.platform === "ラクマ").length > 0 &&
                      <span className="text-green-600 dark:text-green-400">・利益{goodItems.filter(i => i.platform === "ラクマ").length}件</span>
                    })
                  </span>
                  {priceData.rakuma?.stats && (
                    <span className="text-[10px] text-muted-foreground">
                      最安¥{priceData.rakuma.stats.min.toLocaleString()} 平均¥{priceData.rakuma.stats.avg.toLocaleString()}
                    </span>
                  )}
                </div>
                <PriceResultList items={sortItems(rakumaItems)} platform="ラクマ"
                  onSelectItem={handleSelectItem} limitBreakEven={limitBreakEven} selectedUrl={selectedSourceUrl} />
              </div>
            )}

            {/* 駿河屋 */}
            {sortItems(surugayaItems).length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                    駿河屋 ({(priceData.surugaya?.items.length ?? 0)}件
                    {goodItems.filter(i => i.platform === "駿河屋").length > 0 &&
                      <span className="text-green-600 dark:text-green-400">・利益{goodItems.filter(i => i.platform === "駿河屋").length}件</span>
                    })
                  </span>
                  {priceData.surugaya?.stats && (
                    <span className="text-[10px] text-muted-foreground">
                      最安¥{priceData.surugaya.stats.min.toLocaleString()} 平均¥{priceData.surugaya.stats.avg.toLocaleString()}
                    </span>
                  )}
                </div>
                <PriceResultList items={sortItems(surugayaItems)} platform="駿河屋"
                  onSelectItem={handleSelectItem} limitBreakEven={limitBreakEven} selectedUrl={selectedSourceUrl} />
              </div>
            )}

            {/* Errors */}
            {Object.entries(priceData.errors || {}).map(([site, err]) => (
              <p key={site} className="text-[10px] text-muted-foreground">⚠ {site}: {err}</p>
            ))}

            {/* External links for Amazon/Rakuten */}
            <div className="pt-1 border-t border-border">
              <p className="text-[10px] text-muted-foreground mb-1">他のサイトで確認（外部リンク）：</p>
              <div className="flex flex-wrap gap-1">
                {EXTERNAL_LINKS.map((p) => (
                  <button key={p.id} onClick={() => window.open(p.getUrl(fetchKeyword), "_blank")}
                    className={`text-[10px] px-2 py-1 rounded border bg-background hover:bg-muted transition-colors ${p.color}`}
                    data-testid={`link-other-${p.id}`}>
                    {p.name} →
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* eBay URL manual research panel */}
        <EbayUrlPanel
          forwardingCost={forwardingCost}
          otherFees={otherFees}
          ebayFeeRate={ebayFeeRate}
          exchangeRate={exchangeRate}
          onUsePrice={(priceJpy, url) => { setEbayOverrideJpy(priceJpy); setEbayOverrideUrl(url); }}
          overridePrice={ebayOverrideJpy} />

        {/* Custom URL sourcing */}
        <CustomUrlPanel
          limitBreakEven={limitBreakEven}
          exchangeRate={exchangeRate}
          onSelectItem={handleSelectItem}
          selectedUrl={selectedSourceUrl} />

        {priceError && (
          <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
            取得に失敗しました。再検索ボタンをお試しください。
          </div>
        )}
      </div>

      <Separator />

      {/* Profit calculation */}
      <div>
        <p className="font-semibold text-foreground mb-1.5 text-xs">
          仕入れ価格を入力 → 利益率を確認
        </p>
        <div className="flex gap-2 mb-2">
          <Input type="number" placeholder="仕入れ価格 ¥" value={sourcePrice}
            onChange={(e) => { setSourcePrice(e.target.value); if (!e.target.value) setSelectedSourceUrl(""); }}
            className={`h-9 text-sm font-medium flex-1 ${realProfit !== null ? (realProfit >= 0 ? "border-green-400" : "border-red-400") : ""}`}
            data-testid="input-source-price" />
          <Select value={sourcePlatform} onValueChange={setSourcePlatform}>
            <SelectTrigger className="w-28 h-9 text-xs" data-testid="select-save-platform">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="メルカリ">メルカリ</SelectItem>
              <SelectItem value="ヤフオク">ヤフオク</SelectItem>
              <SelectItem value="Yahoo!ショッピング">Yahoo!ショッピング</SelectItem>
              <SelectItem value="ラクマ">ラクマ</SelectItem>
              <SelectItem value="駿河屋">駿河屋</SelectItem>
              <SelectItem value="Amazon">Amazon JP</SelectItem>
              <SelectItem value="楽天市場">楽天市場</SelectItem>
              <SelectItem value="店舗">店舗</SelectItem>
              <SelectItem value="その他">その他</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Show selected source URL */}
        {selectedSourceUrl && (
          <div className="flex items-center gap-1 mb-2 px-2 py-1 bg-primary/5 border border-primary/30 rounded text-[10px] text-primary">
            <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
            <span className="truncate flex-1">仕入先URL選択済み</span>
            <button onClick={() => window.open(selectedSourceUrl, "_blank")}
              className="flex-shrink-0 hover:opacity-70">
              <ExternalLink className="w-3 h-3" />
            </button>
            <button onClick={() => setSelectedSourceUrl("")}
              className="flex-shrink-0 hover:opacity-70">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {realProfit !== null ? (
          <div className={`p-3 rounded-lg border-2 ${realProfit >= 0 ? "bg-green-50 dark:bg-green-950 border-green-400" : "bg-red-50 dark:bg-red-950 border-red-400"}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">実際の利益</span>
              <span className={`text-lg font-bold ${realProfit >= 0 ? "text-green-600" : "text-red-600"}`}
                data-testid="text-real-profit">
                {realProfit >= 0 ? "+" : ""}¥{realProfit.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">実際の利益率</span>
              <span className={`text-3xl font-extrabold ${realProfitRate! >= 20 ? "text-green-600" : realProfitRate! >= 10 ? "text-yellow-600" : "text-red-600"}`}
                data-testid="text-real-profit-rate">
                {realProfitRate?.toFixed(1)}%
              </span>
            </div>
            <div className="text-[11px] space-y-0.5 pt-2 border-t">
              <div className="flex justify-between text-foreground font-medium"><span>eBay販売額</span><span>¥{ebayPriceJpy.toLocaleString()}</span></div>
              <div className="flex justify-between text-red-500"><span>　eBay手数料 ({ebayFeeRate}%)</span><span>-¥{ebayFee.toLocaleString()}</span></div>
              <div className="flex justify-between text-red-500"><span>　国内送料</span><span>-¥{fwdDomestic.toLocaleString()}</span></div>
              <div className="flex justify-between text-red-500"><span>　代行手数料</span><span>-¥{fwdAgent.toLocaleString()}</span></div>
              <div className="flex justify-between text-red-500"><span>　国際送料 ({estWeight}g)</span><span>-¥{fwdIntl.toLocaleString()}</span></div>
              <div className="flex justify-between text-red-500"><span>　その他費用</span><span>-¥{otherFees.toLocaleString()}</span></div>
              <div className="flex justify-between text-red-500 font-medium border-t pt-0.5 mt-0.5"><span>　合計諸経費</span><span>-¥{totalCosts.toLocaleString()}</span></div>
              <div className="flex justify-between text-red-600 font-semibold"><span>仕入れ価格</span><span>-¥{sourcePriceNum!.toLocaleString()}</span></div>
            </div>
          </div>
        ) : (
          <div className="p-2 rounded-lg bg-muted/40 border border-dashed text-center">
            <p className="text-xs text-muted-foreground">
              上のリストから価格をクリックするか、直接入力してください
            </p>
          </div>
        )}
      </div>

      <Button className="w-full h-9 gap-1.5" onClick={() => onSave(item, sourcePriceNum ?? undefined, sourcePlatform, selectedSourceUrl || undefined, selectedSourceImageUrls.length > 0 ? selectedSourceImageUrls : undefined)}
        disabled={isSaving} data-testid="button-save-with-source">
        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bookmark className="w-4 h-4" />}
        保存リストに追加
        {realProfitRate !== null && (
          <span className={`ml-1 text-xs font-bold ${realProfitRate >= 20 ? "text-green-300" : realProfitRate >= 10 ? "text-yellow-300" : "text-red-300"}`}>
            ({realProfitRate.toFixed(1)}%)
          </span>
        )}
      </Button>
    </div>
  );
}

function EbayItemCard({ item, selected, onResearch, onOpenEbay }: {
  item: EbayItem; selected: boolean;
  onResearch: () => void; onOpenEbay: (e: React.MouseEvent) => void;
}) {
  return (
    <Card className={`flex flex-col transition-all overflow-hidden ${selected ? "ring-2 ring-primary shadow-lg" : "hover:shadow-lg"}`}
      data-testid={`card-product-${item.itemId}`}>
      {/* Product image — full width */}
      <div className="relative cursor-pointer group" onClick={onOpenEbay} data-testid={`open-ebay-${item.itemId}`}>
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.title}
            className="w-full h-44 object-contain bg-muted/20 group-hover:opacity-90 transition-opacity"
            onError={(e) => { (e.target as HTMLImageElement).src = ""; (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-full h-44 bg-muted flex items-center justify-center">
            <Package className="w-10 h-10 text-muted-foreground" />
          </div>
        )}
        <div className="absolute top-2 left-2 flex flex-wrap gap-1">
          <Badge variant="secondary" className="text-[10px] shadow-sm">{item.condition}</Badge>
          {item.listingType === "Auction" && (
            <Badge variant="outline" className="text-[10px] shadow-sm bg-background">オークション</Badge>
          )}
          {item.hasVariations && (
            <Badge variant="outline" className="text-[10px] shadow-sm bg-yellow-50 dark:bg-yellow-900 border-yellow-400 text-yellow-700 dark:text-yellow-300">バリエーション有</Badge>
          )}
        </div>
      </div>

      <CardContent className="p-3 flex flex-col flex-1 gap-2">
        <p className="text-xs font-medium text-foreground leading-snug line-clamp-2 hover:text-primary cursor-pointer transition-colors"
          onClick={onOpenEbay} data-testid={`product-title-${item.itemId}`}>{item.title}</p>

        <div className="grid grid-cols-2 gap-1.5">
          <div className="p-2 bg-muted/40 rounded-md text-center">
            <p className="text-[10px] text-muted-foreground">
              {item.listingType === "Auction" ? "🔨 現在入札額" : item.hasVariations ? "💰 選択バリエーション価格" : "💰 即決価格"}
            </p>
            <p className="text-base font-bold">${item.price.toFixed(2)}</p>
          </div>
          <div className="p-2 bg-blue-50 dark:bg-blue-950 rounded-md text-center">
            <p className="text-[10px] text-muted-foreground">円換算</p>
            <p className="text-base font-bold text-blue-600 dark:text-blue-400">¥{item.priceJpy.toLocaleString()}</p>
          </div>
        </div>

        {item.category && (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1 truncate">
            <Tag className="w-3 h-3 flex-shrink-0" />{item.category}
          </p>
        )}

        <div className="flex gap-1.5 mt-auto pt-1.5 border-t border-border">
          <Button variant="outline" size="sm" className="flex-1 h-8 text-xs gap-1" onClick={onOpenEbay}
            data-testid={`button-ebay-${item.itemId}`}>
            <ExternalLink className="w-3.5 h-3.5" />eBayで見る
          </Button>
          <Button size="sm" variant={selected ? "default" : "secondary"} className="flex-1 h-8 text-xs gap-1"
            onClick={onResearch} data-testid={`button-research-${item.itemId}`}>
            <Store className="w-3.5 h-3.5" />仕入れ調査
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EbaySearch() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState("keyword");
  const [keyword, setKeyword] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState("BestMatch");
  const [condition, setCondition] = useState("all");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [daysListed, setDaysListed] = useState("0");
  const [categoryId, setCategoryId] = useState("");
  const [activeCategoryName, setActiveCategoryName] = useState("すべてのカテゴリ");
  const [showFilters, setShowFilters] = useState(false);
  const [soldOnly, setSoldOnly] = useState(false);
  const [soldWindowDays, setSoldWindowDays] = useState("90");
  const [researchingItemId, setResearchingItemId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState(POPULAR_CATEGORIES[0]);
  // Pagination offsets
  const [searchOffset, setSearchOffset] = useState(0);
  const [popularOffset, setPopularOffset] = useState(0);
  const [smartBoost, setSmartBoost] = useState(true);

  // Restore search state from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ebaySearchState");
      if (saved) {
        const s = JSON.parse(saved);
        if (s.keyword) setKeyword(s.keyword);
        if (s.searchQuery) setSearchQuery(s.searchQuery);
        if (s.sortOrder) setSortOrder(s.sortOrder);
        if (s.condition) setCondition(s.condition);
        if (s.minPrice) setMinPrice(s.minPrice);
        if (s.maxPrice) setMaxPrice(s.maxPrice);
        if (s.daysListed) setDaysListed(s.daysListed);
        if (s.categoryId !== undefined) setCategoryId(s.categoryId);
        if (s.activeCategoryName) setActiveCategoryName(s.activeCategoryName);
        if (s.tab) setTab(s.tab);
        if (s.soldWindowDays) setSoldWindowDays(s.soldWindowDays);
        if (typeof s.smartBoost === "boolean") setSmartBoost(s.smartBoost);
        if (typeof s.soldOnly === "boolean") setSoldOnly(s.soldOnly);
        if (typeof s.searchOffset === "number" && s.searchOffset >= 0) setSearchOffset(s.searchOffset);
        if (typeof s.popularOffset === "number" && s.popularOffset >= 0) setPopularOffset(s.popularOffset);
        if (s.selectedCategory?.id) {
          const found = POPULAR_CATEGORIES.find((c) => c.id === s.selectedCategory.id);
          if (found) setSelectedCategory(found);
          else setSelectedCategory({ id: s.selectedCategory.id, name: s.selectedCategory.name || s.selectedCategory.id });
        }
      }
    } catch {}
  }, []);

  // Save search state to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem("ebaySearchState", JSON.stringify({
        keyword, searchQuery, sortOrder, condition, minPrice, maxPrice, daysListed, categoryId, activeCategoryName, tab,
        soldWindowDays, smartBoost, soldOnly, searchOffset, popularOffset,
        selectedCategory: { id: selectedCategory.id, name: selectedCategory.name },
      }));
    } catch {}
  }, [
    keyword, searchQuery, sortOrder, condition, minPrice, maxPrice, daysListed, categoryId, activeCategoryName, tab,
    soldWindowDays, smartBoost, soldOnly, searchOffset, popularOffset, selectedCategory,
  ]);

  const handleClearSearch = () => {
    setKeyword(""); setSearchQuery(""); setSortOrder("BestMatch"); setCondition("all");
    setMinPrice(""); setMaxPrice(""); setDaysListed("0"); setCategoryId("");
    setActiveCategoryName("すべてのカテゴリ"); setResearchingItemId(null); setSearchOffset(0);
    setSoldWindowDays("90");
    setSoldOnly(false);
    setPopularOffset(0);
    setSelectedCategory(POPULAR_CATEGORIES[0]);
    setSmartBoost(true);
    queryClient.removeQueries({ queryKey: ["/api/ebay/search"] });
    queryClient.removeQueries({ queryKey: ["/api/ebay/sold"] });
    try { localStorage.removeItem("ebaySearchState"); } catch {}
  };

  const { data: settings } = useQuery<AppSettings>({ queryKey: ["/api/settings"] });

  // Search is enabled when there's a keyword OR a category selected
  const searchEnabled = !!searchQuery || !!categoryId;

  const { data: activeSearchItems = [], isLoading: activeSearchLoading, error: activeSearchError } = useQuery<EbayItem[]>({
    queryKey: ["/api/ebay/search", searchQuery, sortOrder, condition, minPrice, maxPrice, daysListed, categoryId, searchOffset, smartBoost],
    enabled: searchEnabled && tab === "keyword" && !soldOnly,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams({ sortOrder });
      if (searchQuery) params.append("q", searchQuery);
      if (condition !== "all") params.append("condition", condition);
      if (minPrice) params.append("minPrice", minPrice);
      if (maxPrice) params.append("maxPrice", maxPrice);
      if (daysListed !== "0") params.append("daysListed", daysListed);
      if (categoryId) params.append("categoryId", categoryId);
      if (searchOffset > 0) params.append("offset", String(searchOffset));
      if (smartBoost && searchQuery.trim()) params.append("smartBoost", "1");
      const res = await fetch(`/api/ebay/search?${params}`);
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "検索エラー"); }
      return res.json();
    },
  });

  const { data: soldSearchResult, isLoading: soldSearchLoading, error: soldSearchError } = useQuery<{
    items: EbayItem[];
    meta: EbaySoldResearchMeta;
  }>({
    queryKey: ["/api/ebay/sold", searchQuery, condition, minPrice, maxPrice, categoryId, searchOffset, soldWindowDays, smartBoost],
    enabled: searchEnabled && tab === "keyword" && soldOnly,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append("q", searchQuery);
      if (condition !== "all") params.append("condition", condition);
      if (minPrice) params.append("minPrice", minPrice);
      if (maxPrice) params.append("maxPrice", maxPrice);
      if (categoryId) params.append("categoryId", categoryId);
      if (searchOffset > 0) params.append("offset", String(searchOffset));
      params.append("soldDays", soldWindowDays);
      if (smartBoost && searchQuery.trim()) params.append("smartBoost", "1");
      const res = await fetch(`/api/ebay/sold?${params}`);
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "落札済み検索エラー"); }
      return res.json();
    },
  });

  const searchItems = soldOnly ? (soldSearchResult?.items ?? []) : activeSearchItems;
  const soldMeta = soldOnly ? soldSearchResult?.meta : undefined;
  const searchLoading = soldOnly ? soldSearchLoading : activeSearchLoading;
  const searchError = soldOnly ? soldSearchError : activeSearchError;

  const { data: popularItems = [], isLoading: popularLoading } = useQuery<EbayItem[]>({
    queryKey: ["/api/ebay/popular", selectedCategory.id, popularOffset],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (popularOffset > 0) params.append("offset", String(popularOffset));
      const res = await fetch(`/api/ebay/popular/${selectedCategory.id}?${params}`);
      if (!res.ok) throw new Error("取得エラー");
      return res.json();
    },
    enabled: tab === "popular",
  });

  const activeItems = tab === "keyword" ? searchItems : popularItems;
  const isLoading = tab === "keyword" ? searchLoading : popularLoading;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (keyword.trim()) { setSearchQuery(keyword.trim()); setResearchingItemId(null); setSearchOffset(0); }
  };

  const handleCategoryClick = (cat: { id: string; name: string }) => {
    setCategoryId(cat.id);
    setActiveCategoryName(cat.name);
    setResearchingItemId(null);
    setSearchOffset(0);
    if (!keyword.trim()) setSearchQuery("");
  };

  const openManualResearch = (item: EbayItem) => {
    setResearchingItemId(item.itemId);
    const params = new URLSearchParams();
    params.set("ebayUrl", item.itemUrl);
    params.set("title", item.title);
    if (item.imageUrl) params.set("imageUrl", item.imageUrl);
    params.set("autoFetch", "1");
    setLocation(`/research?${params.toString()}`);
  };

  // Pagination helpers
  const handleNextPage = () => setSearchOffset((prev) => prev + 20);
  const handlePrevPage = () => setSearchOffset((prev) => Math.max(0, prev - 20));
  const handlePopularRefresh = () => setPopularOffset((prev) => prev + 20);
  const handlePopularReset = () => setPopularOffset(0);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden">
        <div className="h-full flex flex-col px-4 py-3 gap-3">
          <Tabs value={tab} onValueChange={(v) => { setTab(v); setResearchingItemId(null); }}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-bold text-foreground whitespace-nowrap">eBay商品検索</h1>
                <TabsList>
                  <TabsTrigger value="keyword" className="gap-1.5" data-testid="tab-keyword">
                    <Search className="w-3.5 h-3.5" />キーワード検索
                  </TabsTrigger>
                  <TabsTrigger value="popular" className="gap-1.5" data-testid="tab-popular">
                    <TrendingUp className="w-3.5 h-3.5" />売れ筋自動検索
                  </TabsTrigger>
                </TabsList>
              </div>
              {searchEnabled && (
                <Button variant="outline" size="sm" onClick={handleClearSearch}
                  className="gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                  data-testid="button-clear-search">
                  <X className="w-3.5 h-3.5" />検索クリア
                </Button>
              )}
            </div>

            <TabsContent value="keyword" className="mt-3">
              <div className="flex flex-col gap-2">
                {/* Search bar row */}
                <form onSubmit={handleSearch} className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input type="search"
                      placeholder="キーワードで検索（省略可・カテゴリのみでも検索可）"
                      value={keyword} onChange={(e) => setKeyword(e.target.value)} className="pl-9"
                      data-testid="input-search-keyword" />
                  </div>
                  <Button type="submit" disabled={searchLoading} data-testid="button-search">
                    {searchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    検索
                  </Button>
                  <Button type="button" variant={soldOnly ? "default" : "outline"}
                    onClick={() => { setSoldOnly(!soldOnly); setResearchingItemId(null); setSearchOffset(0); }}
                    className={`gap-1 text-xs whitespace-nowrap ${soldOnly ? "bg-green-600 hover:bg-green-700 text-white border-green-600" : ""}`}
                    title="実際に落札された価格を検索（より精度が高い）"
                    data-testid="button-sold-only">
                    <CheckCircle2 className="w-3.5 h-3.5" />落札済
                  </Button>
                  {soldOnly && (
                    <Select
                      value={soldWindowDays}
                      onValueChange={(v) => { setSoldWindowDays(v); setSearchOffset(0); }}
                    >
                      <SelectTrigger className="h-9 w-[148px] text-xs" data-testid="select-sold-window">
                        <SelectValue placeholder="落札期間" />
                      </SelectTrigger>
                      <SelectContent>
                        {SOLD_WINDOW_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button type="button" variant="outline" onClick={() => setShowFilters(!showFilters)}
                    className={showFilters ? "bg-primary/10 border-primary" : ""}
                    data-testid="button-toggle-filters">
                    <Filter className="w-4 h-4" />
                  </Button>
                </form>
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={smartBoost}
                    onChange={(e) => { setSmartBoost(e.target.checked); setSearchOffset(0); }}
                    className="rounded border-border"
                    data-testid="checkbox-smart-boost"
                  />
                  <span>型番・記号を検索語に追加（キーワード内の WH-1000XM5 などを eBay 向けに補強）</span>
                </label>

                {/* Filters (date + condition + price) */}
                {showFilters && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-border">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">並び順</p>
                      <Select value={sortOrder} onValueChange={setSortOrder}>
                        <SelectTrigger data-testid="select-sort"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />出品期間
                      </p>
                      <Select value={daysListed} onValueChange={setDaysListed}>
                        <SelectTrigger data-testid="select-days-listed"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DAYS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">状態</p>
                      <Select value={condition} onValueChange={setCondition}>
                        <SelectTrigger data-testid="select-condition"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["all", "New", "Used"].map((v) => (
                            <SelectItem key={v} value={v}>{v === "all" ? "すべて" : v === "New" ? "新品" : "中古"}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">価格範囲 ($)</p>
                      <div className="flex gap-1">
                        <Input type="number" placeholder="下限" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} data-testid="input-min-price" className="text-xs" />
                        <span className="self-center text-muted-foreground text-xs">〜</span>
                        <Input type="number" placeholder="上限" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} data-testid="input-max-price" className="text-xs" />
                      </div>
                    </div>
                  </div>
                )}

                {/* eBay Category bar - full list, horizontally scrollable */}
                <div className="border rounded-lg bg-muted/30 p-2">
                  <p className="text-[11px] text-muted-foreground font-medium mb-1.5 flex items-center gap-1">
                    <Tag className="w-3 h-3" />eBayカテゴリ（クリックで検索）
                  </p>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin"
                    style={{ scrollbarWidth: "thin" }}>
                    {EBAY_CATEGORIES.map((cat) => {
                      const isActive = categoryId === cat.id;
                      return (
                        <button
                          key={cat.id || "all"}
                          onClick={() => handleCategoryClick(cat)}
                          className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-all whitespace-nowrap ${
                            isActive
                              ? "bg-primary text-primary-foreground border-primary font-medium shadow-sm"
                              : "bg-background text-foreground border-border hover:bg-muted hover:border-primary/50"
                          }`}
                          data-testid={`ebay-category-${cat.id || "all"}`}>
                          {cat.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Quick keywords (shown only when no search active) */}
                {!searchEnabled && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    <span className="text-xs text-muted-foreground self-center">クイック：</span>
                    {QUICK_KEYWORDS.map((kw) => (
                      <Button key={kw} variant="outline" size="sm" type="button" className="h-7 text-xs"
                        onClick={() => { setKeyword(kw); setSearchQuery(kw); setResearchingItemId(null); }}
                        data-testid={`quick-keyword-${kw}`}>{kw}</Button>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="popular" className="mt-3">
              <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/40 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-100 leading-snug">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  このタブは<strong>現在出品中</strong>の一覧です（落札相場・売れ筋の確定データではありません）。
                  実際の落札価格は「キーワード検索」で<strong>落札済</strong>をオンにし、必要なら落札期間を絞ってください。
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Zap className="w-3 h-3" />カテゴリ：
                </span>
                {POPULAR_CATEGORIES.map((cat) => (
                  <Button key={cat.id} variant={selectedCategory.id === cat.id ? "default" : "outline"}
                    size="sm" className="h-7 text-xs"
                    onClick={() => { setSelectedCategory(cat); setResearchingItemId(null); setPopularOffset(0); }}
                    data-testid={`category-${cat.id}`}>{cat.name}</Button>
                ))}
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1 ml-auto"
                  onClick={handlePopularRefresh} disabled={popularLoading}
                  data-testid="button-popular-next">
                  <RefreshCw className={`w-3 h-3 ${popularLoading ? "animate-spin" : ""}`} />
                  別の商品を見る
                </Button>
                {popularOffset > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs"
                    onClick={handlePopularReset} data-testid="button-popular-reset">
                    最初に戻る
                  </Button>
                )}
              </div>
            </TabsContent>
          </Tabs>

          {/* Results + Side Panel */}
          <div className="flex-1 flex gap-3 overflow-hidden min-h-0">
            <div className="flex-1 overflow-y-auto min-w-0">
              {searchError && (
                <div className="p-4 text-sm text-destructive bg-destructive/10 rounded-md mb-3">
                  {(searchError as Error).message}
                </div>
              )}
              {isLoading && (
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
                </div>
              )}
              {!isLoading && tab === "keyword" && !searchEnabled && (
                <div className="text-center py-16">
                  <Search className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-foreground font-medium mb-1">キーワードまたはカテゴリを選択</p>
                  <p className="text-sm text-muted-foreground">カテゴリをクリックするだけで検索できます</p>
                </div>
              )}
              {!isLoading && activeItems.length > 0 && (
                <>
                  {(() => {
                    const sortLabels: Record<string, string> = {
                      "0": "ベストマッチ", "20": "新着順", "40": "高額順", "60": "低額順",
                    };
                    const popularSortLabel = tab === "popular"
                      ? (sortLabels[String(popularOffset % 80)] || "ベストマッチ") : null;
                    return (
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">{activeItems.length}件</span>
                          {tab === "popular"
                            ? <> 「{selectedCategory.name}」の商品
                              <span className="ml-1 text-xs text-primary">({popularSortLabel})</span>
                              {popularOffset > 0 && <span className="ml-1 text-xs text-muted-foreground">(+{popularOffset}件)</span>}
                            </>
                            : categoryId
                              ? ` 「${activeCategoryName}」${searchQuery ? ` × "${searchQuery}"` : ""}の検索結果`
                              : ` "${searchQuery}" の検索結果`}
                          {daysListed !== "0" && tab === "keyword" && !soldOnly && (
                            <span className="ml-1 text-primary text-xs">(直近{daysListed}日)</span>
                          )}
                          {soldOnly && tab === "keyword" && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs font-medium text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/40 px-1.5 py-0.5 rounded-full">
                              <CheckCircle2 className="w-3 h-3" />落札済み価格
                            </span>
                          )}
                          {tab === "keyword" && searchOffset > 0 && (
                            <span className="ml-1 text-xs text-muted-foreground">({searchOffset + 1}件目〜)</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">$1 = ¥{settings?.exchangeRate || 150}</p>
                      </div>
                    );
                  })()}
                  {soldOnly && soldMeta && activeItems.length > 0 && (
                    <div className="mb-3 flex flex-col gap-1 rounded-md border border-green-200 dark:border-green-800 bg-green-50/80 dark:bg-green-950/30 px-3 py-2 text-[11px] text-green-900 dark:text-green-100">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>
                          落札データ <strong>{soldMeta.returnedAfterDedupe}件</strong>
                          {soldMeta.windowDays > 0 ? <>（終了が直近<strong>{soldMeta.windowDays}日</strong>以内）</> : <>（期間指定なし）</>}
                          {soldMeta.duplicatesRemoved > 0 && (
                            <span className="text-muted-foreground"> · 類似タイトル{soldMeta.duplicatesRemoved}件を除外</span>
                          )}
                        </span>
                        <span>
                          中央値（参考）:{" "}
                          <strong>
                            {soldMeta.medianPriceJpy != null ? `¥${soldMeta.medianPriceJpy.toLocaleString()}` : "—"}
                          </strong>
                          {soldMeta.medianPriceUsd != null && (
                            <span className="text-muted-foreground">（${soldMeta.medianPriceUsd.toFixed(2)}）</span>
                          )}
                        </span>
                        <Badge
                          variant={soldMeta.reliability === "high" ? "default" : soldMeta.reliability === "medium" ? "secondary" : "outline"}
                          className="text-[10px] h-5"
                        >
                          サンプル信頼度:{" "}
                          {soldMeta.reliability === "high" ? "高（目安）" : soldMeta.reliability === "medium" ? "中" : "低・参考程度"}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        オークション落札と即決は混在します。最終判断は商品ページと型番・コンディションで行ってください。
                      </p>
                    </div>
                  )}
                  {activeItems.some(i => i.hasVariations) && (
                    <div className="flex items-start gap-1.5 mb-3 px-3 py-2 rounded-md bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 text-xs text-yellow-800 dark:text-yellow-300">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span><span className="font-semibold">バリエーション有り</span>の商品は、その選択バリエーション（色・サイズ等）の価格を表示しています。eBayで確認すると他のバリエーション価格が表示される場合があります。</span>
                    </div>
                  )}
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {activeItems.map((item) => (
                      <EbayItemCard key={item.itemId} item={item} selected={researchingItemId === item.itemId}
                        onOpenEbay={(e) => { e.stopPropagation(); window.open(item.itemUrl, "_blank"); }}
                        onResearch={() => openManualResearch(item)} />
                    ))}
                  </div>
                  {/* Pagination */}
                  {tab === "keyword" && activeItems.length > 0 && (
                    <div className="flex items-center justify-center gap-3 mt-4 pt-3 border-t border-border">
                      <Button variant="outline" size="sm" className="h-8 text-xs gap-1"
                        onClick={handlePrevPage} disabled={searchOffset === 0 || searchLoading}
                        data-testid="button-prev-page">
                        ← 前の20件
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {searchOffset + 1}〜{searchOffset + activeItems.length}件目
                      </span>
                      <Button variant="outline" size="sm" className="h-8 text-xs gap-1"
                        onClick={handleNextPage} disabled={searchLoading || activeItems.length < 20}
                        data-testid="button-next-page">
                        次の20件 →
                      </Button>
                    </div>
                  )}
                </>
              )}
              {!isLoading && activeItems.length === 0 && (tab === "keyword" ? searchEnabled : true) && (
                <div className="text-center py-16">
                  <ShoppingCart className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">商品が見つかりませんでした</p>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
