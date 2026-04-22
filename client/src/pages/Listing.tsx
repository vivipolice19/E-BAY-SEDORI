import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { SavedProduct, AppSettings, ListingTemplate } from "@shared/schema";
import { normalizeEbayCategoryId } from "@shared/ebayCategory";
import {
  Package, Tag, DollarSign, Image, FileText, List,
  BarChart2, Loader2, Check, ExternalLink,
  RefreshCw, Download, Plus, Trash2, Edit3,
  Star, AlertCircle, CheckCircle2, Save, Truck,
  Copy, ClipboardCheck, Layers, Settings2, FileSpreadsheet,
} from "lucide-react";

function stripHtmlToPlain(html: string): string {
  if (!html) return "";
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent || d.innerText || "").replace(/\s+/g, " ").trim();
}

// ---- Utility: Weight parsing ----
function parseWeightToGrams(value: string): number | null {
  const v = value.toLowerCase().trim();
  const num = parseFloat(v);
  if (isNaN(num)) return null;
  if (v.includes("kg")) return Math.round(num * 1000);
  if (v.includes("lb")) return Math.round(num * 453.592);
  if (v.includes("oz")) return Math.round(num * 28.3495);
  if (v.includes("g")) return Math.round(num);
  return num >= 100 ? Math.round(num) : Math.round(num * 1000);
}

function extractWeightFromSpecifics(specifics: Record<string, string>): { key: string; rawValue: string; grams: number } | null {
  const weightKeys = ["item weight", "package weight", "unit weight", "net weight", "weight", "重量"];
  for (const [k, v] of Object.entries(specifics)) {
    if (weightKeys.some(wk => k.toLowerCase().includes(wk))) {
      const grams = parseWeightToGrams(v);
      if (grams && grams > 0 && grams < 30000) return { key: k, rawValue: v, grams };
    }
  }
  return null;
}

const CATEGORY_DEFAULT_WEIGHTS: Record<string, number> = {
  "Camera": 450, "Cameras": 450, "Headphone": 280, "Audio": 350,
  "Electronics": 400, "Watch": 150, "Toy": 200, "Game": 200, "Plush": 150,
};

function getCategoryDefaultWeight(category?: string | null): number {
  if (!category) return 300;
  for (const [key, weight] of Object.entries(CATEGORY_DEFAULT_WEIGHTS)) {
    if (category.toLowerCase().includes(key.toLowerCase())) return weight;
  }
  return 300;
}

// ---- Utility: Copy to clipboard ----
function CopyButton({ text, label }: { text: string; label?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: `${label || "テキスト"}をコピーしました` });
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button size="sm" variant="ghost" className={`h-6 px-2 text-[10px] gap-1 ${copied ? "text-green-600" : "text-muted-foreground"}`}
      onClick={handleCopy} title="コピー">
      {copied ? <ClipboardCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {label && <span className="hidden sm:inline">{copied ? "コピー済" : "コピー"}</span>}
    </Button>
  );
}

// ---- Status constants ----
const STATUS_OPTIONS = ["仕入中", "出品準備中", "出品中", "売却済", "キャンセル"];
const STATUS_COLORS: Record<string, string> = {
  "仕入中": "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  "出品準備中": "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  "出品中": "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  "売却済": "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  "キャンセル": "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

// eBay condition options
const EBAY_CONDITIONS = ["New", "Like New", "Very Good", "Good", "Acceptable", "For Parts or Not Working", "Used"];

// ---- Readiness Score Calculation ----
function calcReadiness(product: SavedProduct, specifics: Record<string, string>): { score: number; total: number; items: { label: string; done: boolean }[] } {
  const effectiveTitle = (product.listingTitle || product.name || "").trim();
  const items = [
    { label: "タイトル", done: !!(product.listingTitle || product.name) },
    { label: "タイトル80文字以内", done: effectiveTitle.length > 0 && effectiveTitle.length <= 80 },
    { label: "仕入価格", done: !!(product.sourcePrice && product.sourcePrice > 0) },
    { label: "eBay価格/相場", done: !!(product.ebayPrice || product.marketAvgJpy) },
    { label: "商品状態", done: !!(product.ebayCondition || product.ebayConditionMapped || product.sourceCondition) },
    { label: "Item Specifics", done: Object.keys(specifics).length > 0 },
    { label: "説明文", done: !!(product.listingDescription) },
    { label: "出品価格(USD)", done: !!(product.listingPrice) },
    { label: "写真", done: ((product.ebayImageUrls?.length || 0) > 0 || (product.sourceImageUrls?.length || 0) > 0 || !!product.ebayImageUrl) },
  ];
  const score = items.filter(i => i.done).length;
  return { score, total: items.length, items };
}

/** 規約・紛争リスクのヒント（チェックリストとは別の注意喚起） */
function collectListingRiskNotes(product: SavedProduct): string[] {
  const title = (product.listingTitle || product.name || "").trim();
  const desc = (product.listingDescription || "").trim();
  const cond = (product.ebayCondition || product.sourceCondition || "").trim();
  const blob = `${title} ${desc} ${cond}`;
  const lower = blob.toLowerCase();
  const notes: string[] = [];
  if (/for parts|not working|ジャンク|junk|parts only|defect|不動|故障|破損|動作未確認/i.test(blob)) {
    notes.push("極端なコンディション・ジャンク系の表記があります。説明と返品・紛争防止を再確認してください。");
  }
  if (title.length > 80) {
    notes.push(`タイトルが${title.length}文字です。eBayは80文字前後が目安です。`);
  }
  if (/\b(whatsapp|wechat|telegram|line\s*id)\b/i.test(`${title} ${desc}`)) {
    notes.push("外部連絡先を想起させる語句が含まれています（ポリシー違反の可能性があります）。");
  }
  if (/(振り込みのみ|銀行振込のみ|直接取引)/i.test(`${title} ${desc}`)) {
    notes.push("オフeBay決済を想起させる表現の可能性があります。");
  }
  if (/\b(replica|copy|偽物|模造|コピー品)\b/i.test(lower)) {
    notes.push("正規品でない可能性を示す語句があります。出品ポリシーを確認してください。");
  }
  return notes;
}

function buildListingClipboardText(opts: {
  listingTitle: string;
  productName: string;
  listingPrice: string;
  suggestedUsd: string;
  listingDescription: string;
  ebayCondition: string;
  categoryPath: string;
  specifics: Record<string, string>;
  imageUrls: string[];
}): string {
  const title = opts.listingTitle || opts.productName || "";
  const price = opts.listingPrice || opts.suggestedUsd || "";
  const specificsText = Object.entries(opts.specifics).map(([k, v]) => `${k}: ${v}`).join("\n");
  return [
    `【タイトル】\n${title}`,
    `【出品価格（USD）】\n$${price}`,
    `【コンディション】\n${opts.ebayCondition || "Used"}`,
    `【カテゴリ】\n${opts.categoryPath || "（未設定）"}`,
    opts.listingDescription ? `【説明文】\n${opts.listingDescription}` : null,
    specificsText ? `【商品の詳細（Item Specifics）】\n${specificsText}` : null,
    opts.imageUrls.length > 0 ? `【画像URL（${opts.imageUrls.length}枚）】\n${opts.imageUrls.join("\n")}` : null,
  ].filter(Boolean).join("\n\n");
}

// ---- Image Gallery ----
async function resizeImage(src: string, maxW = 1600, maxH = 1200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = Math.round(img.width * ratio), h = Math.round(img.height * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = reject;
    img.src = src;
  });
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl; a.download = filename; a.click();
}

function ImageGallery({ product, onEbayImagesLoaded }: {
  product: SavedProduct;
  onEbayImagesLoaded: (urls: string[]) => void;
}) {
  const { toast } = useToast();
  const [resizing, setResizing] = useState<number | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const ebayImages = (product.ebayImageUrls?.length ? product.ebayImageUrls : product.ebayImageUrl ? [product.ebayImageUrl] : []).map((url, i) => ({ url, label: `eBay ${i + 1}` }));
  const sourceImages = (product.sourceImageUrls || []).map((url, i) => ({ url, label: `仕入 ${i + 1}` }));
  const allImages = [...ebayImages, ...sourceImages];

  const handleFetchEbayImages = async () => {
    if (!product.ebayItemId) return;
    setIsFetching(true);
    try {
      const res = await fetch(`/api/ebay/images/${encodeURIComponent(product.ebayItemId)}`);
      const data = await res.json();
      if (data.images?.length > 0) {
        onEbayImagesLoaded(data.images);
        toast({ title: `${data.images.length}枚のeBay画像を取得しました` });
      } else {
        toast({ title: "eBay画像が見つかりませんでした", variant: "destructive" });
      }
    } catch { toast({ title: "画像取得失敗", variant: "destructive" }); }
    finally { setIsFetching(false); }
  };

  const handleResize = async (url: string, idx: number) => {
    setResizing(idx);
    try {
      const dataUrl = await resizeImage(url);
      downloadDataUrl(dataUrl, `listing-image-${idx + 1}.jpg`);
    } catch { toast({ title: "リサイズ失敗 (CORS制限の可能性)", variant: "destructive" }); }
    finally { setResizing(null); }
  };

  const handleResizeAll = async () => {
    setResizing(-1);
    let ok = 0;
    for (let i = 0; i < allImages.length; i++) {
      try { const d = await resizeImage(allImages[i].url); downloadDataUrl(d, `listing-image-${i + 1}.jpg`); ok++; await new Promise(r => setTimeout(r, 300)); } catch {}
    }
    setResizing(null);
    toast({ title: `${ok}/${allImages.length}枚をリサイズDL完了` });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          eBay: <strong className="text-foreground">{ebayImages.length}枚</strong>
          {sourceImages.length > 0 && <span className="ml-2">仕入: <strong className="text-foreground">{sourceImages.length}枚</strong></span>}
          <span className="ml-2">合計 {allImages.length}枚</span>
        </div>
        {product.ebayItemId && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleFetchEbayImages} disabled={isFetching}>
            {isFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            eBay全画像を取得
          </Button>
        )}
      </div>

      {allImages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-24 bg-muted/30 rounded-lg border border-dashed text-xs text-muted-foreground gap-2">
          <p>画像なし</p>
          {product.ebayItemId && (
            <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={handleFetchEbayImages} disabled={isFetching}>
              {isFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              eBay画像を取得
            </Button>
          )}
        </div>
      ) : (
        <>
          {previewIdx !== null && allImages[previewIdx] && (
            <div className="relative rounded-lg overflow-hidden border bg-muted/20">
              <img src={allImages[previewIdx].url} alt="プレビュー" className="w-full object-contain" style={{ maxHeight: 280 }} />
              <button onClick={() => setPreviewIdx(null)} className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs">✕</button>
              <button onClick={() => handleResize(allImages[previewIdx]!.url, previewIdx)} disabled={resizing !== null}
                className="absolute bottom-1 right-1 bg-primary text-white rounded px-2 py-0.5 text-[10px] flex items-center gap-1">
                {resizing === previewIdx ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Download className="w-2.5 h-2.5" />}
                リサイズDL
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {allImages.map((img, idx) => (
              <div key={idx} className="relative group cursor-pointer" onClick={() => setPreviewIdx(previewIdx === idx ? null : idx)}>
                <img src={img.url} alt={img.label}
                  className={`w-[68px] h-[68px] object-cover rounded-md border-2 transition-all ${previewIdx === idx ? "border-primary shadow-md" : "border-border"}`}
                  data-testid={`listing-image-${idx}`} />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-md transition-opacity">
                  <button onClick={e => { e.stopPropagation(); handleResize(img.url, idx); }} disabled={resizing !== null}
                    className="bg-white/80 rounded-full p-1">
                    {resizing === idx ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                  </button>
                </div>
                <span className={`absolute bottom-0.5 left-0.5 text-[8px] px-0.5 rounded ${img.label.startsWith("eBay") ? "bg-blue-600 text-white" : "bg-orange-500 text-white"}`}>
                  {img.label}
                </span>
              </div>
            ))}
          </div>
          {allImages.length > 1 && (
            <Button size="sm" variant="outline" className="text-xs h-7 gap-1 w-full" onClick={handleResizeAll} disabled={resizing !== null}>
              {resizing === -1 ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              全{allImages.length}枚を一括リサイズDL（eBay推奨1600×1200）
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ---- Template Manager Modal ----
function TemplateManager({ templates, onClose }: { templates: ListingTemplate[]; onClose: () => void }) {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", category: "", descriptionTemplate: "", shippingInfo: "", returnPolicy: "" });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/templates", form),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/templates"] }); toast({ title: "テンプレート作成完了" }); setForm({ name: "", category: "", descriptionTemplate: "", shippingInfo: "", returnPolicy: "" }); },
    onError: (e: any) => toast({ title: "エラー", description: e.message, variant: "destructive" }),
  });
  const updateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PUT", `/api/templates/${id}`, form),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/templates"] }); toast({ title: "更新完了" }); setEditingId(null); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/templates/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/templates"] }); toast({ title: "削除完了" }); },
  });
  const startEdit = (t: ListingTemplate) => { setEditingId(t.id); setForm({ name: t.name, category: t.category, descriptionTemplate: t.descriptionTemplate, shippingInfo: t.shippingInfo, returnPolicy: t.returnPolicy }); };
  const isDefault = (id: string) => id.startsWith("tpl-");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-base">出品テンプレート管理</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕ 閉じる</button>
        </div>
        <div className="p-5 space-y-4">
          {templates.map(t => (
            <div key={t.id} className="border rounded-lg p-3">
              {editingId === t.id ? (
                <div className="space-y-2">
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="テンプレート名" className="text-sm h-8" />
                  <Textarea value={form.descriptionTemplate} onChange={e => setForm(f => ({ ...f, descriptionTemplate: e.target.value }))} rows={6} className="text-xs font-mono" placeholder="{title}, {condition}, {specifics}" />
                  <div className="flex gap-2">
                    <Button size="sm" className="text-xs h-7" onClick={() => updateMutation.mutate(t.id)} disabled={updateMutation.isPending}>保存</Button>
                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setEditingId(null)}>キャンセル</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{t.name}</p>
                    {t.category && <p className="text-[10px] text-muted-foreground">{t.category}</p>}
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{t.descriptionTemplate.slice(0, 80)}...</p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => startEdit(t)}><Edit3 className="w-3 h-3" /></Button>
                    {!isDefault(t.id) && (
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-destructive" onClick={() => deleteMutation.mutate(t.id)} disabled={deleteMutation.isPending}><Trash2 className="w-3 h-3" /></Button>
                    )}
                    {isDefault(t.id) && <Badge variant="outline" className="text-[10px] h-5">デフォルト</Badge>}
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="border-t pt-4">
            <p className="text-xs font-medium mb-2">新規テンプレート作成</p>
            <div className="space-y-2">
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="テンプレート名" className="text-sm h-8" />
              <Textarea value={form.descriptionTemplate} onChange={e => setForm(f => ({ ...f, descriptionTemplate: e.target.value }))} rows={5} className="text-xs font-mono" placeholder="{title}&#10;{condition}&#10;{specifics}" />
              <Button size="sm" className="text-xs h-8 gap-1" onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.name || !form.descriptionTemplate}>
                <Plus className="w-3.5 h-3.5" />作成
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Tab Component ----
function Tab({ id, label, icon: Icon, active, onClick, badge }: {
  id: string; label: string; icon: any; active: boolean; onClick: () => void; badge?: string;
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
      data-testid={`tab-${id}`}>
      <Icon className="w-3.5 h-3.5" />
      {label}
      {badge && <span className={`text-[10px] px-1.5 py-0 rounded-full font-medium ml-0.5 ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{badge}</span>}
    </button>
  );
}

// ---- Field Row with Copy ----
function FieldRow({ label, value, children, copyText }: {
  label: string; value?: string; children?: React.ReactNode; copyText?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</Label>
        {(copyText || value) && <CopyButton text={copyText || value || ""} label={label} />}
      </div>
      {children || (value && <div className="text-sm text-foreground bg-muted/20 px-2 py-1.5 rounded border text-xs">{value}</div>)}
    </div>
  );
}

// ---- Main ListingDetail ----
function ListingDetail({ product, settings, templates, onClose }: {
  product: SavedProduct;
  settings: AppSettings | undefined;
  templates: ListingTemplate[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const exchangeRate = settings?.exchangeRate || 150;
  const ebayFeeRate = settings?.ebayFeeRate || 13.25;
  const otherFees = settings?.otherFees || 500;

  // Auto-select template based on product name/category
  const autoSelectTemplateId = (() => {
    if (!templates.length) return "";
    const combined = ((product.name || "") + " " + (product.ebayCategory || "") + " " + (product.ebayCategoryPath || "")).toLowerCase();
    const toyKw = ["plush", "stuffed", "figure", "doll", "toy", "hello kitty", "sanrio", "pokemon", "anime", "character", "charm", "collectible"];
    const gameKw = ["game", "nintendo", "playstation", "xbox", "switch"];
    const cameraKw = ["camera", "lens", "leica", "nikon", "canon"];
    const watchKw = ["watch", "seiko", "casio", "citizen"];
    const audioKw = ["audio", "headphone", "speaker"];

    const match = (kws: string[], hints: string[]) => kws.some(k => combined.includes(k))
      ? templates.find(t => hints.some(h => t.name.toLowerCase().includes(h)))?.id || null
      : null;

    return match(toyKw, ["ぬいぐるみ", "フィギュア", "toy", "キャラ"]) ||
      match(gameKw, ["ゲーム", "game"]) ||
      match(cameraKw, ["カメラ", "camera"]) ||
      match(watchKw, ["時計", "watch"]) ||
      match(audioKw, ["オーディオ", "audio"]) ||
      templates[0]?.id || "";
  })();

  // State
  const [activeTab, setActiveTab] = useState("data");
  const [listingTitle, setListingTitle] = useState(product.listingTitle || product.name || "");
  const [listingPrice, setListingPrice] = useState(product.listingPrice ? String(product.listingPrice) : product.ebayPrice ? String(product.ebayPrice.toFixed(2)) : "");
  const [listingDescription, setListingDescription] = useState(product.listingDescription || "");
  const [selectedTemplateId, setSelectedTemplateId] = useState(autoSelectTemplateId);
  const [status, setStatus] = useState(product.listingStatus || "仕入中");
  const [actualSalePrice, setActualSalePrice] = useState(product.actualSalePrice ? String(product.actualSalePrice) : "");
  const [specifics, setSpecifics] = useState<Record<string, string>>(
    product.listingItemSpecifics ? (() => { try { return JSON.parse(product.listingItemSpecifics); } catch { return {}; } })() : {}
  );
  const [ebayCondition, setEbayCondition] = useState(
    product.ebayCondition || product.ebayConditionMapped || (product.sourceCondition ? "Used" : "")
  );
  const [categoryPath, setCategoryPath] = useState(product.ebayCategoryPath || product.ebayCategory || "");
  const [ebayCategoryId, setEbayCategoryId] = useState(product.ebayCategoryId || "");
  const [pendingWeight, setPendingWeight] = useState<number | null>(null);
  const [pendingForwardingCost, setPendingForwardingCost] = useState<number | null>(null);
  const [pendingEbayImageUrls, setPendingEbayImageUrls] = useState<string[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [newSpecKey, setNewSpecKey] = useState("");
  const [newSpecVal, setNewSpecVal] = useState("");

  // Forwarding cost
  const effectiveForwardingCost = pendingForwardingCost ?? product.forwardingCost ?? (settings?.shippingCost || 1500);

  // Pricing
  const marketAvgJpy = product.marketAvgJpy ?? null;
  const marketMinJpy = product.marketMinJpy ?? null;
  const marketMaxJpy = product.marketMaxJpy ?? null;
  const basePriceJpy = marketAvgJpy || product.ebayPriceJpy || Math.round((product.ebayPrice || 0) * exchangeRate);
  const suggestedJpy = Math.round(basePriceJpy * 0.95);
  const suggestedUsd = suggestedJpy > 0 ? (suggestedJpy / exchangeRate).toFixed(2) : (product.ebayPrice ? (product.ebayPrice * 0.95).toFixed(2) : "");
  const ebayFee = Math.round(suggestedJpy * (ebayFeeRate / 100));
  const netFromEbay = suggestedJpy - ebayFee - effectiveForwardingCost - otherFees;
  const estimatedProfit = netFromEbay - (product.sourcePrice || 0);

  // Actual profit
  const actualSalePriceNum = parseFloat(actualSalePrice) || 0;
  const actualSalePriceJpy = Math.round(actualSalePriceNum * exchangeRate);
  const actualFee = Math.round(actualSalePriceJpy * (ebayFeeRate / 100));
  const actualNet = actualSalePriceJpy - actualFee - effectiveForwardingCost - otherFees;
  const actualProfit = actualNet - (product.sourcePrice || 0);
  const actualProfitRate = actualSalePriceJpy > 0 ? (actualProfit / actualSalePriceJpy) * 100 : 0;

  // Readiness（編集中のフォーム値を反映）
  const mergedForReadiness: SavedProduct = {
    ...product,
    listingTitle: listingTitle || product.listingTitle,
    listingDescription: listingDescription || product.listingDescription,
    listingPrice: listingPrice ? parseFloat(listingPrice) : product.listingPrice,
    ebayCondition: ebayCondition || product.ebayCondition,
  };
  const { score, total, items: readinessItems } = calcReadiness(mergedForReadiness, specifics);
  const listingRiskNotes = collectListingRiskNotes(mergedForReadiness);

  // eBay Item Specifics auto-fetch
  const { data: specificsData, isLoading: specificsLoading, error: specificsError, refetch: refetchSpecifics } = useQuery({
    queryKey: ["/api/ebay/item-specifics", product.ebayItemId],
    queryFn: async () => {
      const res = await fetch(`/api/ebay/item-specifics/${encodeURIComponent(product.ebayItemId!)}`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      return res.json() as Promise<{
        itemSpecifics: Record<string, string>;
        title?: string;
        condition?: string;
        categoryPath?: string;
        categoryId?: string;
        description?: string;
      }>;
    },
    enabled: !!product.ebayItemId,
    staleTime: 10 * 60 * 1000,
  });

  // Auto-apply Item Specifics on first load and auto-save to DB so sheet stays in sync
  const [autoApplied, setAutoApplied] = useState(false);
  useEffect(() => {
    if (specificsData && !autoApplied) {
      setAutoApplied(true);
      const autoSavePayload: Record<string, any> = {};

      if (Object.keys(specifics).length === 0 && Object.keys(specificsData.itemSpecifics).length > 0) {
        setSpecifics(specificsData.itemSpecifics);
        autoSavePayload.listingItemSpecifics = JSON.stringify(specificsData.itemSpecifics);
        if (specificsData.title && !listingTitle) {
          setListingTitle(specificsData.title);
          autoSavePayload.listingTitle = specificsData.title;
        }
      }
      if (specificsData.categoryPath && !product.ebayCategoryPath) {
        setCategoryPath(specificsData.categoryPath);
        autoSavePayload.ebayCategoryPath = specificsData.categoryPath;
      }
      if (specificsData.condition && !product.ebayCondition) {
        setEbayCondition(specificsData.condition);
        autoSavePayload.ebayCondition = specificsData.condition;
      }
      if (specificsData.categoryId && !product.ebayCategoryId) {
        const cid = normalizeEbayCategoryId(specificsData.categoryId) || specificsData.categoryId;
        setEbayCategoryId(cid);
        autoSavePayload.ebayCategoryId = cid;
      }
      if (specificsData.description && !listingDescription) {
        const plain = stripHtmlToPlain(specificsData.description).slice(0, 65000);
        if (plain) {
          setListingDescription(plain);
          autoSavePayload.listingDescription = plain;
        }
      }

      // Auto-save newly discovered fields to DB (and sheet) without requiring 保存 click
      if (Object.keys(autoSavePayload).length > 0) {
        apiRequest("PATCH", `/api/products/${product.id}`, autoSavePayload).catch(console.error);
      }
    }
  }, [specificsData]);

  // Weight from specifics
  const extractedWeight = extractWeightFromSpecifics(specifics);
  const defaultWeight = extractedWeight?.grams || product.weight || getCategoryDefaultWeight(product.ebayCategory);
  const [weightStr, setWeightStr] = useState(String(defaultWeight));
  useEffect(() => { if (extractedWeight?.grams) setWeightStr(String(extractedWeight.grams)); }, [extractedWeight?.grams]);
  const weight = parseInt(weightStr) || defaultWeight;
  const fwdDomestic = settings?.forwardingDomesticShipping ?? 800;
  const fwdAgent = settings?.forwardingAgentFee ?? 500;
  const fwdIntlBase = settings?.forwardingIntlBase ?? 2000;
  const fwdIntlPerGram = settings?.forwardingIntlPerGram ?? 3;
  const fwdInternational = fwdIntlBase + Math.round(weight * fwdIntlPerGram);
  const fwdTotal = fwdDomestic + fwdAgent + fwdInternational;

  // Description generation
  const handleGenerateDescription = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch("/api/generate-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: selectedTemplateId, title: listingTitle, condition: ebayCondition || "Used", specifics }),
      });
      const data = await res.json();
      if (data.description) setListingDescription(data.description);
    } catch { toast({ title: "説明文生成エラー", variant: "destructive" }); }
    finally { setIsGenerating(false); }
  };

  // Add/remove specifics
  const handleAddSpecific = () => {
    if (newSpecKey.trim() && newSpecVal.trim()) {
      setSpecifics(s => ({ ...s, [newSpecKey.trim()]: newSpecVal.trim() }));
      setNewSpecKey(""); setNewSpecVal("");
    }
  };
  const handleRemoveSpecific = (key: string) => {
    setSpecifics(s => { const n = { ...s }; delete n[key]; return n; });
  };

  // Save
  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/products/${product.id}`, {
      listingStatus: status,
      listingTitle,
      listingDescription,
      listingPrice: listingPrice ? parseFloat(listingPrice) : null,
      listingItemSpecifics: JSON.stringify(specifics),
      actualSalePrice: actualSalePrice ? parseFloat(actualSalePrice) : null,
      actualProfit: actualSalePrice ? Math.round(actualProfit) : null,
      ebayCondition: ebayCondition || null,
      ebayCategoryPath: categoryPath || null,
      ebayCategoryId: ebayCategoryId || null,
      ...(pendingWeight != null ? { weight: pendingWeight } : {}),
      ...(pendingForwardingCost != null ? { forwardingCost: pendingForwardingCost } : {}),
      ...(pendingEbayImageUrls != null ? { ebayImageUrls: pendingEbayImageUrls } : {}),
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/products"] }); toast({ title: "保存完了" }); },
    onError: (e: any) => toast({ title: "エラー", description: e.message, variant: "destructive" }),
  });

  const listOnEbayMutation = useMutation({
    mutationFn: async () => {
      const normalizedCat = normalizeEbayCategoryId(ebayCategoryId);
      if (!normalizedCat) throw new Error("eBayカテゴリID（数字）が必要です。「eBayから取得」で補完するか、末尾の数値IDを入力してください");
      const price = listingPrice ? parseFloat(listingPrice) : parseFloat(suggestedUsd || "0");
      if (!price || price <= 0) throw new Error("出品価格を確認してください");
      const imageUrls = (pendingEbayImageUrls ?? product.ebayImageUrls ?? product.sourceImageUrls ?? []) as string[];
      return apiRequest("POST", "/api/ebay/list", {
        title: listingTitle || product.name,
        description: listingDescription || product.name,
        categoryId: normalizedCat,
        price,
        condition: ebayCondition || "Used",
        specifics: Object.keys(specifics).length > 0 ? specifics : undefined,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        weight: product.weight || undefined,
      });
    },
    onSuccess: async (data: any) => {
      toast({
        title: "eBay出品成功",
        description: `出品ID: ${data.itemId} | URL: ${data.itemUrl || "eBayで確認"}`,
      });
      // Auto update status to 出品中
      await apiRequest("PATCH", `/api/products/${product.id}`, {
        listingStatus: "出品中",
        ebayListingId: data.itemId || null,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (e: any) => toast({ title: "eBay出品エラー", description: e.message, variant: "destructive" }),
  });

  // Readiness color（チェック項目9件想定）
  const readinessColor = score >= 8 ? "text-green-600" : score >= 6 ? "text-yellow-600" : "text-red-500";
  const readinessBg = score >= 8 ? "bg-green-50 dark:bg-green-950 border-green-200" : score >= 6 ? "bg-yellow-50 dark:bg-yellow-950 border-yellow-200" : "bg-red-50 dark:bg-red-950 border-red-200";

  const specificsText = Object.entries(specifics).map(([k, v]) => `${k}: ${v}`).join("\n");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {showTemplateManager && <TemplateManager templates={templates} onClose={() => setShowTemplateManager(false)} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-2 border-b border-border flex-shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground line-clamp-2">{product.name}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[status] || "bg-muted"}`}>{status}</Badge>
            {(product.ebayListingId || product.ebayUrl) && (() => {
              const ebayPageUrl = product.ebayListingId
                ? `https://www.ebay.com/itm/${product.ebayListingId}`
                : product.ebayUrl!;
              return (
                <a href={ebayPageUrl} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300 font-medium transition-colors"
                  data-testid="link-ebay-listing-page">
                  {product.ebayListingId ? "eBay出品ページを開く" : "eBay参考商品"} <ExternalLink className="w-2.5 h-2.5" />
                </a>
              );
            })()}
            {product.sourceUrl && (
              <a href={product.sourceUrl} target="_blank" rel="noreferrer" className="text-[10px] text-orange-600 hover:underline flex items-center gap-0.5">
                {product.sourcePlatform || "仕入先"} <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
          </div>
        </div>
        {/* Readiness + eBay Sell Form + Save */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className={`text-center px-2 py-1 rounded-lg border text-xs ${readinessBg}`}>
            <p className={`text-base font-bold leading-none ${readinessColor}`}>{score}/{total}</p>
            <p className="text-[10px] text-muted-foreground">準備度</p>
          </div>
          {/* eBay Sell Form button — always visible in header */}
          <Button size="sm" variant="outline"
            className="h-8 px-2.5 gap-1 text-xs border-green-400 text-green-700 hover:bg-green-50 dark:text-green-300 dark:hover:bg-green-950 whitespace-nowrap"
            onClick={() => {
              const title = listingTitle || product.name || "";
              const imageUrls = (pendingEbayImageUrls ?? product.ebayImageUrls ?? product.sourceImageUrls ?? []) as string[];
              const clipText = buildListingClipboardText({
                listingTitle,
                productName: product.name || "",
                listingPrice,
                suggestedUsd,
                listingDescription,
                ebayCondition,
                categoryPath,
                specifics,
                imageUrls,
              });
              navigator.clipboard.writeText(clipText).catch(() => {});
              window.open(`https://www.ebay.com/sl/sell?pTitle=${encodeURIComponent(title.slice(0, 80))}`, "_blank", "noopener,noreferrer");
              toast({ title: "eBay出品フォームを開きました", description: "商品情報をコピーしました。各欄に貼り付けてください。" });
            }}
            data-testid="button-open-ebay-sell-form-header"
          >
            <ExternalLink className="w-3.5 h-3.5" />eBay出品
          </Button>
          <Button size="sm" className="h-8 px-3 gap-1.5 text-xs" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
            data-testid="button-save-listing">
            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            保存
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 px-4 border-b border-border overflow-x-auto flex-shrink-0 bg-background">
        <Tab id="data" label="出品データ" icon={Layers} active={activeTab === "data"} onClick={() => setActiveTab("data")} />
        <Tab id="price" label="価格・利益" icon={DollarSign} active={activeTab === "price"} onClick={() => setActiveTab("price")} />
        <Tab id="images" label="画像" icon={Image} active={activeTab === "images"} onClick={() => setActiveTab("images")}
          badge={String((product.ebayImageUrls?.length || 0) + (product.sourceImageUrls?.length || 0) || "")} />
        <Tab id="status" label="ステータス" icon={BarChart2} active={activeTab === "status"} onClick={() => setActiveTab("status")} />
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ===== TAB: 出品データ ===== */}
        {activeTab === "data" && (
          <div className="space-y-4">
            {/* Readiness checklist */}
            <div className={`rounded-lg border p-3 ${readinessBg}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  出品準備チェックリスト ({score}/{total} 完了)
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] gap-1"
                  onClick={() => {
                    const imageUrls = (pendingEbayImageUrls ?? product.ebayImageUrls ?? product.sourceImageUrls ?? []) as string[];
                    const text = buildListingClipboardText({
                      listingTitle,
                      productName: product.name || "",
                      listingPrice,
                      suggestedUsd,
                      listingDescription,
                      ebayCondition,
                      categoryPath,
                      specifics,
                      imageUrls,
                    });
                    navigator.clipboard.writeText(text).catch(() => {});
                    toast({ title: "一括コピーしました", description: "タイトル・価格・説明・画像URLをまとめてコピーしました。" });
                  }}
                  data-testid="button-copy-listing-bundle"
                >
                  <Copy className="w-3 h-3" />
                  一括コピー
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {readinessItems.map(item => (
                  <div key={item.label} className="flex items-center gap-1.5 text-[11px]">
                    {item.done
                      ? <Check className="w-3 h-3 text-green-600 flex-shrink-0" />
                      : <AlertCircle className="w-3 h-3 text-amber-500 flex-shrink-0" />}
                    <span className={item.done ? "text-foreground" : "text-muted-foreground"}>{item.label}</span>
                  </div>
                ))}
              </div>
              {listingRiskNotes.length > 0 && (
                <div className="mt-2 space-y-1 pt-2 border-t border-border/60">
                  {listingRiskNotes.map((note, i) => (
                    <p key={i} className="text-[10px] text-amber-800 dark:text-amber-200 flex gap-1.5 leading-snug">
                      <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      {note}
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* Source info (from Mercari) */}
            {(product.sourceCondition || product.sourceDescription) && (
              <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950 p-3 space-y-2">
                <p className="text-xs font-semibold text-orange-700 dark:text-orange-300">仕入先情報（{product.sourcePlatform || "仕入先"}）</p>
                {product.sourceCondition && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-orange-600 dark:text-orange-400 whitespace-nowrap">商品状態:</span>
                    <span className="text-xs font-medium">{product.sourceCondition}</span>
                    {product.ebayConditionMapped && (
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                        → eBay: {product.ebayConditionMapped}
                      </span>
                    )}
                  </div>
                )}
                {product.sourceDescription && (
                  <div>
                    <p className="text-[10px] text-orange-600 dark:text-orange-400 mb-1">仕入先説明文（参考）</p>
                    <div className="text-xs bg-background/80 p-2 rounded border max-h-24 overflow-y-auto whitespace-pre-wrap">
                      {product.sourceDescription}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* eBay Category */}
            <FieldRow label="eBayカテゴリー" copyText={categoryPath}>
              <div className="flex gap-1.5">
                <Input value={categoryPath} onChange={e => setCategoryPath(e.target.value)}
                  placeholder="例: Collectibles & Art > Animation Art & Merchandise"
                  className="h-8 text-xs flex-1" data-testid="input-category" />
                {specificsData?.categoryPath && (
                  <Button size="sm" variant="outline" className="h-8 text-xs whitespace-nowrap"
                    onClick={() => setCategoryPath(specificsData.categoryPath || "")}>
                    eBayから取得
                  </Button>
                )}
              </div>
              {specificsData?.categoryPath && (
                <p className="text-[10px] text-blue-600 dark:text-blue-400 mt-1">
                  eBay実カテゴリー: {specificsData.categoryPath}
                </p>
              )}
            </FieldRow>

            {/* Condition */}
            <FieldRow label="コンディション（eBay出品用）" copyText={ebayCondition}>
              {product.sourceCondition && (
                <div className="flex items-center gap-2 mb-1.5 text-[11px]">
                  <span className="text-muted-foreground">仕入先:</span>
                  <span className="font-medium">{product.sourceCondition}</span>
                  {product.ebayConditionMapped && (
                    <button onClick={() => setEbayCondition(product.ebayConditionMapped || "")}
                      className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded hover:bg-primary/20">
                      → {product.ebayConditionMapped} を使用
                    </button>
                  )}
                </div>
              )}
              <Select value={ebayCondition} onValueChange={setEbayCondition}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-condition">
                  <SelectValue placeholder="コンディションを選択" />
                </SelectTrigger>
                <SelectContent>
                  {EBAY_CONDITIONS.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </FieldRow>

            {/* Title */}
            <FieldRow label="出品タイトル（英語・最大80文字）" copyText={listingTitle}>
              <Input value={listingTitle} onChange={e => setListingTitle(e.target.value)}
                placeholder="eBay出品タイトル" className="h-8 text-xs"
                data-testid="input-listing-title" />
              <div className="flex justify-between mt-0.5">
                <p className="text-[10px] text-muted-foreground">{listingTitle.length}/80文字</p>
                {listingTitle.length > 80 && <p className="text-[10px] text-red-500">80文字を超えています</p>}
              </div>
            </FieldRow>

            {/* Item Specifics */}
            <FieldRow label={`Item Specifics（${Object.keys(specifics).length}項目）`} copyText={specificsText}>
              {/* Status */}
              {product.ebayItemId && (
                <div className="flex items-center gap-2 mb-2">
                  {specificsLoading ? (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />eBayから取得中...
                    </span>
                  ) : specificsError ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />{(specificsError as Error).message}
                      </span>
                      <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => refetchSpecifics()}>再試行</Button>
                    </div>
                  ) : specificsData ? (
                    <div className="flex items-center gap-2 w-full">
                      <span className="text-xs text-green-700 dark:text-green-300 flex items-center gap-1">
                        <Check className="w-3 h-3" />eBayから{Object.keys(specificsData.itemSpecifics).length}項目取得済み
                      </span>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] ml-auto gap-1" onClick={() => {
                        setSpecifics(specificsData.itemSpecifics);
                        if (specificsData.categoryPath) setCategoryPath(specificsData.categoryPath);
                        if (specificsData.condition) setEbayCondition(specificsData.condition);
                        toast({ title: "eBay情報を再適用しました" });
                      }}>
                        <RefreshCw className="w-3 h-3" />再適用
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Specifics table */}
              {Object.keys(specifics).length > 0 ? (
                <div className="space-y-1 max-h-52 overflow-y-auto border rounded-md p-2">
                  {Object.entries(specifics).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-1.5 text-xs group">
                      <span className="text-muted-foreground font-medium w-32 flex-shrink-0 truncate">{k}:</span>
                      <span className="flex-1 truncate text-foreground">{v}</span>
                      <CopyButton text={v} />
                      <button onClick={() => handleRemoveSpecific(k)} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground p-2 border border-dashed rounded-md text-center">
                  {product.ebayItemId ? "取得中..." : "Item Specificsなし（eBay URLを設定するか手動で追加）"}
                </div>
              )}

              {/* Add manual specific */}
              <div className="flex gap-1 mt-1">
                <Input placeholder="項目名 (Brand等)" value={newSpecKey} onChange={e => setNewSpecKey(e.target.value)}
                  className="h-7 text-xs flex-1" data-testid="input-specifics-key" />
                <Input placeholder="値" value={newSpecVal} onChange={e => setNewSpecVal(e.target.value)}
                  className="h-7 text-xs flex-1" data-testid="input-specifics-val"
                  onKeyDown={e => e.key === "Enter" && handleAddSpecific()} />
                <Button size="sm" className="h-7 px-2" onClick={handleAddSpecific}><Plus className="w-3.5 h-3.5" /></Button>
              </div>
            </FieldRow>

            {/* Description */}
            <FieldRow label="eBay出品説明文" copyText={listingDescription}>
              <p className="text-[10px] text-muted-foreground mb-1.5">
                参考eBay商品URLがある場合、「eBayから取得」で説明文が取れるときは未入力時のみ自動で入ります（HTMLは除去）。英語にしたい場合は下の生成ボタンを使ってください。
              </p>
              <div className="flex items-center gap-2 mb-2">
                <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger className="h-8 text-xs flex-1" data-testid="select-template">
                    <SelectValue placeholder="テンプレート選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map(t => <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => setShowTemplateManager(true)}>
                  <Edit3 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <Button size="sm" className="w-full h-8 text-xs gap-1.5 mb-2" onClick={handleGenerateDescription}
                disabled={isGenerating || !listingTitle} data-testid="button-generate-description">
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Star className="w-3.5 h-3.5" />}
                説明文を自動生成（テンプレート＋Item Specifics）
              </Button>
              {listingDescription ? (
                <Textarea value={listingDescription} onChange={e => setListingDescription(e.target.value)}
                  rows={10} className="text-xs font-mono" data-testid="textarea-description" />
              ) : (
                <div className="text-xs text-muted-foreground p-3 border border-dashed rounded-md text-center">
                  eBayからの自動取得を待つか、上のボタンでテンプレートから生成してください
                </div>
              )}
            </FieldRow>

          </div>
        )}

        {/* ===== TAB: 価格・利益 ===== */}
        {activeTab === "price" && (
          <div className="space-y-4">
            {/* Market data */}
            {(marketAvgJpy || marketMinJpy || marketMaxJpy) && (
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 p-3 space-y-2">
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                  <BarChart2 className="w-3.5 h-3.5" />eBay落札相場（過去の実売データ）
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[10px] text-blue-600 dark:text-blue-400">最安値</p>
                    <p className="text-sm font-bold text-blue-700 dark:text-blue-300">¥{(marketMinJpy || 0).toLocaleString()}</p>
                    <p className="text-[9px] text-muted-foreground">${((marketMinJpy || 0) / exchangeRate).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-blue-600 dark:text-blue-400">平均落札価格</p>
                    <p className="text-xl font-bold text-blue-800 dark:text-blue-200">¥{(marketAvgJpy || 0).toLocaleString()}</p>
                    <p className="text-[9px] text-muted-foreground">${((marketAvgJpy || 0) / exchangeRate).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-blue-600 dark:text-blue-400">最高値</p>
                    <p className="text-sm font-bold text-blue-700 dark:text-blue-300">¥{(marketMaxJpy || 0).toLocaleString()}</p>
                    <p className="text-[9px] text-muted-foreground">${((marketMaxJpy || 0) / exchangeRate).toFixed(2)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Suggested price + breakeven */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/20">
                <Label className="text-[10px] text-muted-foreground">
                  推奨出品価格{marketAvgJpy ? "（相場平均の95%）" : "（eBay価格の95%）"}
                </Label>
                <p className="text-xl font-bold text-primary mt-0.5">${suggestedUsd || "-"}</p>
                <p className="text-xs text-muted-foreground">¥{suggestedJpy.toLocaleString()}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/30 border">
                <Label className="text-[10px] text-muted-foreground">損益分岐点（この仕入値まで可）</Label>
                <p className="text-xl font-bold text-green-600 mt-0.5">¥{Math.max(0, netFromEbay).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">代行費: ¥{effectiveForwardingCost.toLocaleString()}</p>
              </div>
            </div>

            {/* Profit breakdown */}
            {product.sourcePrice != null && suggestedJpy > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-medium text-muted-foreground">利益内訳（推奨価格で出品した場合）</p>
                <div className="grid grid-cols-4 gap-1 text-xs">
                  <div className="p-1.5 rounded-md bg-muted/30 border text-center">
                    <p className="text-[10px] text-muted-foreground">eBay手数料</p>
                    <p className="font-medium text-red-500">-¥{ebayFee.toLocaleString()}</p>
                  </div>
                  <div className="p-1.5 rounded-md bg-muted/30 border text-center">
                    <p className="text-[10px] text-muted-foreground">代行+送料</p>
                    <p className="font-medium text-orange-500">-¥{effectiveForwardingCost.toLocaleString()}</p>
                  </div>
                  <div className="p-1.5 rounded-md bg-muted/30 border text-center">
                    <p className="text-[10px] text-muted-foreground">その他</p>
                    <p className="font-medium text-orange-400">-¥{otherFees.toLocaleString()}</p>
                  </div>
                  <div className={`p-1.5 rounded-md border text-center ${estimatedProfit >= 0 ? "bg-green-50 dark:bg-green-950 border-green-200" : "bg-red-50 dark:bg-red-950 border-red-200"}`}>
                    <p className="text-[10px] text-muted-foreground">純利益</p>
                    <p className={`font-bold ${estimatedProfit >= 0 ? "text-green-600" : "text-red-500"}`}>
                      {estimatedProfit >= 0 ? "+" : ""}¥{estimatedProfit.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground text-right">
                  仕入値 ¥{(product.sourcePrice || 0).toLocaleString()} 　利益率: {suggestedJpy > 0 ? (estimatedProfit / suggestedJpy * 100).toFixed(1) : 0}%
                </div>
              </div>
            )}

            {/* Price input */}
            <div>
              <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">出品価格（USD）</Label>
              <div className="flex gap-2 mt-1">
                <Input value={listingPrice} onChange={e => setListingPrice(e.target.value)}
                  placeholder={suggestedUsd || "例: 49.99"} className="h-8 text-sm"
                  data-testid="input-listing-price" />
                {suggestedUsd && (
                  <Button size="sm" variant="outline" className="h-8 text-xs whitespace-nowrap"
                    onClick={() => setListingPrice(suggestedUsd)}>
                    推奨価格を使用
                  </Button>
                )}
              </div>
            </div>

            {/* Forwarding cost */}
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-xs font-semibold flex items-center gap-1.5"><Truck className="w-3.5 h-3.5 text-primary" />発送代行費試算</p>
              {extractedWeight ? (
                <div className="flex items-center gap-1.5 text-xs p-1.5 rounded bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
                  <Check className="w-3 h-3 text-green-600 flex-shrink-0" />
                  <span className="text-green-700 dark:text-green-300">Item Specificsから自動取得: <strong>{extractedWeight.key}</strong> = {extractedWeight.rawValue} → <strong>{extractedWeight.grams}g</strong></span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs p-1.5 rounded bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800">
                  <AlertCircle className="w-3 h-3 text-yellow-600 flex-shrink-0" />
                  <span className="text-yellow-700 dark:text-yellow-300">重量データなし。カテゴリ推定値 {defaultWeight}g を使用中。手動修正可。</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">商品重量 (g)</Label>
                <Input type="number" value={weightStr} onChange={e => setWeightStr(e.target.value)}
                  className="h-8 text-sm w-28" placeholder="300" data-testid="input-forwarding-weight" />
                <Button size="sm" className="h-8 text-xs gap-1" onClick={() => { setPendingWeight(weight); setPendingForwardingCost(fwdTotal); toast({ title: `¥${fwdTotal.toLocaleString()}（${weight}g）を利益計算に適用` }); }}>
                  <Truck className="w-3 h-3" />適用
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs">
                <div className="flex justify-between p-1.5 bg-muted/30 rounded border">
                  <span className="text-muted-foreground">国内送料</span><span className="font-medium">¥{fwdDomestic.toLocaleString()}</span>
                </div>
                <div className="flex justify-between p-1.5 bg-muted/30 rounded border">
                  <span className="text-muted-foreground">代行手数料</span><span className="font-medium">¥{fwdAgent.toLocaleString()}</span>
                </div>
                <div className="flex justify-between p-1.5 bg-muted/30 rounded border">
                  <span className="text-muted-foreground">国際送料({weight}g)</span><span className="font-medium">¥{fwdInternational.toLocaleString()}</span>
                </div>
                <div className="flex justify-between p-1.5 bg-primary/10 rounded border border-primary/20">
                  <span className="font-medium text-primary">合計</span><span className="font-bold text-primary">¥{fwdTotal.toLocaleString()}</span>
                </div>
              </div>
              {pendingForwardingCost != null && (
                <p className="text-[10px] text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />利益計算に ¥{pendingForwardingCost.toLocaleString()} を適用済み
                </p>
              )}
            </div>
          </div>
        )}

        {/* ===== TAB: 画像 ===== */}
        {activeTab === "images" && (
          <div className="space-y-3">
            <ImageGallery
              product={pendingEbayImageUrls != null ? { ...product, ebayImageUrls: pendingEbayImageUrls } : product}
              onEbayImagesLoaded={urls => setPendingEbayImageUrls(urls)}
            />
            <p className="text-[10px] text-muted-foreground">
              eBay全画像取得後に「保存」するとデータが確定します。各画像をクリックでプレビュー、DLボタンで1600×1200にリサイズしてダウンロード。
            </p>
          </div>
        )}

        {/* ===== TAB: ステータス ===== */}
        {activeTab === "status" && (
          <div className="space-y-4">
            <div>
              <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">出品ステータス</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Summary */}
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-xs font-semibold">商品サマリー</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 bg-muted/30 rounded">
                  <p className="text-[10px] text-muted-foreground">仕入価格</p>
                  <p className="font-bold">¥{(product.sourcePrice || 0).toLocaleString()}</p>
                </div>
                <div className="p-2 bg-muted/30 rounded">
                  <p className="text-[10px] text-muted-foreground">発送代行費</p>
                  <p className="font-bold">¥{effectiveForwardingCost.toLocaleString()}</p>
                </div>
                <div className="p-2 bg-muted/30 rounded">
                  <p className="text-[10px] text-muted-foreground">推奨出品価格</p>
                  <p className="font-bold text-primary">${suggestedUsd || "-"}</p>
                </div>
                <div className={`p-2 rounded ${estimatedProfit >= 0 ? "bg-green-50 dark:bg-green-950" : "bg-red-50 dark:bg-red-950"}`}>
                  <p className="text-[10px] text-muted-foreground">推定純利益</p>
                  <p className={`font-bold ${estimatedProfit >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {product.sourcePrice ? `${estimatedProfit >= 0 ? "+" : ""}¥${estimatedProfit.toLocaleString()}` : "-"}
                  </p>
                </div>
              </div>
            </div>

            {/* eBay Listing Section */}
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">eBay Trading API で出品</p>
                </div>
                {product.ebayListingId && (
                  <a
                    href={`https://www.ebay.com/itm/${product.ebayListingId}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
                    data-testid="link-ebay-active-listing">
                    <ExternalLink className="w-3 h-3" />eBay出品ページを開く
                  </a>
                )}
              </div>
              {product.ebayListingId && (
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-green-100 dark:bg-green-900/40 border border-green-200 dark:border-green-800">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-green-700 dark:text-green-300 font-medium">出品中 — ID: {product.ebayListingId}</p>
                    <a href={`https://www.ebay.com/itm/${product.ebayListingId}`} target="_blank" rel="noreferrer"
                      className="text-[10px] text-blue-600 hover:underline truncate block">
                      https://www.ebay.com/itm/{product.ebayListingId}
                    </a>
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">eBay カテゴリID（数字・「eBayから取得」で補完）
                  <a href="https://pages.ebay.com/sellerinformation/news/categorychanges.html" target="_blank" rel="noreferrer"
                    className="ml-1 text-blue-500 hover:underline">（調べる方法）</a>
                </Label>
                <Input
                  value={ebayCategoryId}
                  onChange={e => setEbayCategoryId(e.target.value)}
                  placeholder="例: 183454 またはカテゴリパス末尾の数値"
                  className="h-7 text-xs font-mono"
                  data-testid="input-ebay-category-id"
                />
                <p className="text-[9px] text-muted-foreground">出品時に数値IDへ自動正規化します（パス文字列を貼っても可）。</p>
              </div>
              {product.ebayCategoryPath && (
                <p className="text-[10px] text-muted-foreground">参考カテゴリ: {product.ebayCategoryPath}</p>
              )}
              <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                <div className="bg-background/70 rounded p-1.5 border">
                  <p className="text-muted-foreground">タイトル</p>
                  <p className="font-medium truncate">{listingTitle || product.name || "—"}</p>
                </div>
                <div className="bg-background/70 rounded p-1.5 border">
                  <p className="text-muted-foreground">出品価格</p>
                  <p className="font-medium">${listingPrice || suggestedUsd || "—"}</p>
                </div>
                <div className="bg-background/70 rounded p-1.5 border">
                  <p className="text-muted-foreground">コンディション</p>
                  <p className="font-medium">{ebayCondition || "—"}</p>
                </div>
                <div className="bg-background/70 rounded p-1.5 border">
                  <p className="text-muted-foreground">画像枚数</p>
                  <p className="font-medium">
                    {((pendingEbayImageUrls ?? product.ebayImageUrls ?? product.sourceImageUrls ?? []) as string[]).length}枚
                  </p>
                </div>
              </div>
              {/* eBay Sell Form Button — opens eBay's new listing form with title pre-filled + copies all data */}
              <div className="rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-2.5 space-y-2">
                <p className="text-[10px] text-green-700 dark:text-green-300 font-semibold flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" />eBay出品フォームに移動（手動出品）
                </p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  eBayの新規出品ページを開き、商品情報をクリップボードにコピーします。ページを開いたら各項目に貼り付けてください。
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-8 text-xs font-semibold border-green-400 text-green-700 hover:bg-green-100 dark:text-green-300 dark:hover:bg-green-900"
                  onClick={() => {
                    const title = listingTitle || product.name || "";
                    const price = listingPrice || suggestedUsd || "";
                    const imageUrls = (pendingEbayImageUrls ?? product.ebayImageUrls ?? product.sourceImageUrls ?? []) as string[];
                    const specificsText = Object.entries(specifics).map(([k, v]) => `${k}: ${v}`).join("\n");
                    const clipText = [
                      `【タイトル】\n${title}`,
                      `【出品価格（USD）】\n$${price}`,
                      `【コンディション】\n${ebayCondition || "Used"}`,
                      `【カテゴリ】\n${categoryPath || "（未設定）"}`,
                      listingDescription ? `【説明文】\n${listingDescription}` : null,
                      specificsText ? `【商品の詳細（Item Specifics）】\n${specificsText}` : null,
                      imageUrls.length > 0 ? `【画像URL（${imageUrls.length}枚）】\n${imageUrls.join("\n")}` : null,
                    ].filter(Boolean).join("\n\n");
                    navigator.clipboard.writeText(clipText).catch(() => {});
                    const ebayUrl = `https://www.ebay.com/sl/sell?pTitle=${encodeURIComponent(title.slice(0, 80))}`;
                    window.open(ebayUrl, "_blank", "noopener,noreferrer");
                    toast({ title: "eBay出品フォームを開きました", description: "商品情報をクリップボードにコピーしました。各欄に貼り付けてください。" });
                  }}
                  data-testid="button-open-ebay-sell-form"
                >
                  <ExternalLink className="w-3.5 h-3.5 mr-1" />eBay出品フォームを開く＆情報コピー
                </Button>
              </div>

              {/* eBay Trading API — direct listing */}
              {!ebayCategoryId && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />カテゴリIDを入力するとAPI経由で直接出品できます
                </p>
              )}
              <Button
                size="sm"
                className="w-full h-8 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white"
                disabled={listOnEbayMutation.isPending || !ebayCategoryId || !listingTitle}
                onClick={() => listOnEbayMutation.mutate()}
                data-testid="button-list-on-ebay"
              >
                {listOnEbayMutation.isPending ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />出品中...</>
                ) : (
                  <><Tag className="w-3.5 h-3.5 mr-1" />Trading API で直接出品する</>
                )}
              </Button>
              {listOnEbayMutation.isSuccess && (
                <p className="text-[10px] text-green-600 dark:text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />出品完了！ステータスを「出品中」に更新しました
                </p>
              )}
            </div>

            {/* Actual sale record */}
            {(status === "売却済" || product.actualProfit != null) && (
              <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950 p-3 space-y-2">
                <p className="text-xs font-medium text-purple-700 dark:text-purple-300">実売価格・利益記録</p>
                <div>
                  <Label className="text-[10px]">実売価格（USD）</Label>
                  <Input value={actualSalePrice} onChange={e => setActualSalePrice(e.target.value)}
                    placeholder="例: 52.00" type="number" step="0.01" className="h-8 text-sm mt-0.5"
                    data-testid="input-actual-sale-price" />
                </div>
                {actualSalePriceNum > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-md bg-background p-2 border text-center">
                      <p className="text-[10px] text-muted-foreground">実利益</p>
                      <p className={`text-base font-bold ${actualProfit >= 0 ? "text-green-600" : "text-red-500"}`}>
                        {actualProfit >= 0 ? "+" : ""}¥{actualProfit.toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-md bg-background p-2 border text-center">
                      <p className="text-[10px] text-muted-foreground">実利益率</p>
                      <p className={`text-base font-bold ${actualProfitRate >= 20 ? "text-green-600" : actualProfitRate >= 0 ? "text-yellow-600" : "text-red-500"}`}>
                        {actualProfitRate.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                )}
                {product.actualProfit != null && !actualSalePrice && (
                  <div className="flex items-center gap-2 text-xs p-2 rounded bg-background/80">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                    <span>記録済み実利益: <strong className="text-green-600">¥{product.actualProfit.toLocaleString()}</strong></span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Sheet Import Dialog ----
interface SheetRow { [key: string]: string }

function SheetImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (id: string) => void }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery<{ rows: SheetRow[] }>({
    queryKey: ["/api/sheets/list"],
    staleTime: 60 * 1000,
  });

  const importMutation = useMutation({
    mutationFn: async (row: SheetRow) => {
      const name = row["商品名"] || "（名称なし）";
      const ebayPriceStr = (row["eBay価格($)"] || "").replace(/\$/, "");
      const ebayPrice = parseFloat(ebayPriceStr) || undefined;
      const sourcePriceStr = row["仕入値(¥)"] || "";
      const sourcePrice = parseInt(sourcePriceStr) || undefined;
      const weightStr = row["重量(g)"] || "";
      const weight = parseInt(weightStr) || undefined;
      const marketAvgStr = row["落札相場平均(¥)"] || "";
      const marketAvg = parseInt(marketAvgStr) || undefined;
      const marketMinStr = row["落札相場最安(¥)"] || "";
      const marketMin = parseInt(marketMinStr) || undefined;
      const marketMaxStr = row["落札相場最高(¥)"] || "";
      const marketMax = parseInt(marketMaxStr) || undefined;
      // Listing detail fields (X-AD columns)
      const listingTitle = row["出品タイトル"] || undefined;
      const ebayCondition = row["コンディション"] || undefined;
      const ebayCategoryId = row["カテゴリID"] || undefined;
      const ebayCategoryPath = row["カテゴリ名"] || undefined;
      const listingDescription = row["説明文"] || undefined;
      const imageUrlsStr = row["写真URL"] || "";
      const ebayImageUrls = imageUrlsStr ? imageUrlsStr.split(",").map(u => u.trim()).filter(Boolean) : undefined;
      const listingPriceStr = (row["出品価格($)"] || "").replace(/\$/, "");
      const listingPrice = parseFloat(listingPriceStr) || undefined;
      // Restore Item Specifics from AD column (JSON string)
      const itemSpecificsStr = row["ItemSpecifics(JSON)"] || "";
      const listingItemSpecifics = itemSpecificsStr || undefined;
      return apiRequest("POST", "/api/products", {
        name,
        ebayPrice,
        ebayPriceJpy: ebayPrice ? Math.round(ebayPrice * 150) : undefined,
        sourcePrice,
        sourcePlatform: row["仕入先"] || undefined,
        ebayUrl: row["eBay URL"] || undefined,
        sourceUrl: row["仕入先URL"] || undefined,
        weight,
        marketAvgJpy: marketAvg,
        marketMinJpy: marketMin,
        marketMaxJpy: marketMax,
        notes: row["メモ"] || undefined,
        listingStatus: row["ステータス"] || "仕入中",
        listingTitle,
        listingDescription,
        listingPrice,
        listingItemSpecifics,
        ebayCondition,
        ebayCategoryPath,
        ebayCategoryId,
        ebayImageUrls,
      });
    },
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "インポートしました", description: "スプレッドシートから商品を取り込みました" });
      onImported(data.id);
      onClose();
    },
    onError: (e: any) => toast({ title: "インポートエラー", description: e.message, variant: "destructive" }),
  });

  const rows = data?.rows || [];
  const filtered = search ? rows.filter(r => r["商品名"]?.toLowerCase().includes(search.toLowerCase())) : rows;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-bold flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-green-600" />スプレッドシートから取り込む</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs px-2 py-1 rounded hover:bg-muted">✕ 閉じる</button>
        </div>
        <div className="px-4 py-2 border-b border-border">
          <Input placeholder="商品名で検索..." value={search} onChange={e => setSearch(e.target.value)} className="h-7 text-xs" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-24 gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />読み込み中...
            </div>
          ) : error ? (
            <div className="p-4 text-xs text-destructive">{(error as any).message || "読み込みエラー"}</div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground text-center">データがありません</div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((row, i) => {
                const ebayUrl = row["eBay URL"];
                const sourceUrl = row["仕入先URL"];
                const profit = row["推定利益(¥)"];
                const profitRate = row["利益率(%)"];
                const status = row["ステータス"];
                const marketAvg = row["落札相場平均(¥)"];
                const hasTitle = !!row["出品タイトル"];
                const hasCondition = !!row["コンディション"];
                const hasCategoryId = !!row["カテゴリID"];
                const hasDescription = !!row["説明文"];
                const hasPhotos = !!row["写真URL"];
                const hasSpecifics = !!row["ItemSpecifics(JSON)"];
                const readyCount = [hasTitle, hasCondition, hasCategoryId, hasDescription, hasPhotos].filter(Boolean).length;
                return (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="text-xs font-medium truncate flex-1">{row["商品名"]}</p>
                        {readyCount > 0 && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${readyCount >= 4 ? "bg-green-100 text-green-700" : readyCount >= 2 ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-600"}`}>
                            出品データ {readyCount}/5
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {status && <span className={`text-[9px] px-1.5 rounded-full font-medium ${STATUS_COLORS[status] || "bg-muted"}`}>{status}</span>}
                        {row["仕入先"] && <span className="text-[9px] text-muted-foreground">{row["仕入先"]}</span>}
                        {row["仕入値(¥)"] && <span className="text-[9px] text-orange-600">仕入¥{row["仕入値(¥)"]}</span>}
                        {row["eBay価格($)"] && <span className="text-[9px] text-blue-600">{row["eBay価格($)"]}</span>}
                        {marketAvg && <span className="text-[9px] text-cyan-600">相場¥{parseInt(marketAvg).toLocaleString()}</span>}
                        {profit && <span className={`text-[9px] font-medium ${parseInt(profit) >= 0 ? "text-green-600" : "text-red-500"}`}>利益¥{parseInt(profit).toLocaleString()}</span>}
                        {profitRate && <span className="text-[9px] text-muted-foreground">{profitRate}</span>}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {hasTitle && <span className="text-[9px] bg-indigo-50 text-indigo-600 px-1 rounded">タイトル✓</span>}
                        {hasCondition && <span className="text-[9px] bg-indigo-50 text-indigo-600 px-1 rounded">状態✓</span>}
                        {hasCategoryId && <span className="text-[9px] bg-indigo-50 text-indigo-600 px-1 rounded">カテゴリ✓</span>}
                        {hasDescription && <span className="text-[9px] bg-indigo-50 text-indigo-600 px-1 rounded">説明文✓</span>}
                        {hasPhotos && <span className="text-[9px] bg-indigo-50 text-indigo-600 px-1 rounded">写真✓</span>}
                        {hasSpecifics && <span className="text-[9px] bg-purple-50 text-purple-600 px-1 rounded">Specifics✓</span>}
                        {ebayUrl && <a href={ebayUrl} target="_blank" rel="noreferrer" className="text-[9px] text-blue-500 hover:underline flex items-center gap-0.5" onClick={e => e.stopPropagation()}>eBay<ExternalLink className="w-2.5 h-2.5" /></a>}
                        {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-[9px] text-orange-500 hover:underline flex items-center gap-0.5" onClick={e => e.stopPropagation()}>仕入先<ExternalLink className="w-2.5 h-2.5" /></a>}
                      </div>
                    </div>
                    <Button size="sm" className="h-7 text-[10px] px-3 flex-shrink-0" disabled={importMutation.isPending}
                      onClick={() => importMutation.mutate(row)}>
                      {importMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "取り込む"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-border text-[10px] text-muted-foreground">
          {rows.length}件 | スプレッドシートの「セドリリスト」シートから読み込んでいます
        </div>
      </div>
    </div>
  );
}

// ---- Main Listing Page ----
export default function ListingPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [showSheetImport, setShowSheetImport] = useState(false);

  const { data: products = [], isLoading: productsLoading } = useQuery<SavedProduct[]>({
    queryKey: ["/api/products"],
    staleTime: 30 * 1000,
  });
  const { data: settings } = useQuery<AppSettings>({
    queryKey: ["/api/settings"],
    staleTime: 60 * 1000,
  });
  const { data: templates = [] } = useQuery<ListingTemplate[]>({
    queryKey: ["/api/templates"],
    staleTime: 60 * 1000,
  });

  const filtered = statusFilter === "all" ? products : products.filter(p => p.listingStatus === statusFilter);
  const selectedProduct = selectedId ? products.find(p => p.id === selectedId) : null;
  const statusCounts = STATUS_OPTIONS.reduce((acc, s) => { acc[s] = products.filter(p => p.listingStatus === s).length; return acc; }, {} as Record<string, number>);

  return (
    <div className="flex h-full">
      {showTemplateManager && <TemplateManager templates={templates} onClose={() => setShowTemplateManager(false)} />}
      {showSheetImport && <SheetImportDialog onClose={() => setShowSheetImport(false)} onImported={(id) => { setSelectedId(id); setShowSheetImport(false); }} />}

      {/* Left: Product List */}
      <div className="w-72 flex-shrink-0 border-r border-border flex flex-col h-full overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-sm font-bold text-foreground flex items-center gap-1.5">
              <Package className="w-4 h-4 text-primary" />出品管理
            </h1>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 border-green-400 text-green-700 hover:bg-green-50 dark:text-green-300" onClick={() => setShowSheetImport(true)}>
                <FileSpreadsheet className="w-3 h-3" />シート
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => setShowTemplateManager(true)}>
                <Settings2 className="w-3 h-3" />テンプレート
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setStatusFilter("all")}
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${statusFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              全て ({products.length})
            </button>
            {STATUS_OPTIONS.map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                {s} ({statusCounts[s] || 0})
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {productsLoading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-xs gap-1">
              <Package className="w-6 h-6" />
              <p>商品がありません</p>
              <p className="text-[10px]">保存リストから商品を追加してください</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map(product => {
                const isSelected = product.id === selectedId;
                const imgs = product.sourceImageUrls || [];
                const firstImg = imgs[0] || product.ebayImageUrl;
                const profit = product.profit || 0;
                const status = product.listingStatus || "仕入中";
                const specifics = product.listingItemSpecifics ? (() => { try { return JSON.parse(product.listingItemSpecifics); } catch { return {}; } })() : {};
                const { score, total } = calcReadiness(product, specifics);
                const scoreColor = score >= 7 ? "text-green-600" : score >= 5 ? "text-yellow-600" : "text-red-500";

                return (
                  <button key={product.id} onClick={() => setSelectedId(isSelected ? null : product.id)}
                    className={`w-full text-left px-3 py-2.5 hover:bg-muted/40 transition-colors ${isSelected ? "bg-primary/5 border-l-2 border-primary" : ""}`}
                    data-testid={`product-item-${product.id}`}>
                    <div className="flex items-start gap-2">
                      {firstImg ? (
                        <img src={firstImg} alt="" className="w-10 h-10 object-cover rounded flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 bg-muted rounded flex-shrink-0 flex items-center justify-center">
                          <Package className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground line-clamp-2 leading-snug">{product.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className={`text-[9px] px-1.5 py-0 rounded-full font-medium ${STATUS_COLORS[status] || "bg-muted"}`}>{status}</span>
                          {profit !== 0 && (
                            <span className={`text-[10px] font-medium ${profit >= 0 ? "text-green-600" : "text-red-500"}`}>
                              {profit >= 0 ? "+" : ""}¥{profit.toLocaleString()}
                            </span>
                          )}
                          <span className={`text-[9px] font-medium ml-auto ${scoreColor}`}>{score}/{total}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right: Listing Detail */}
      <div className="flex-1 overflow-hidden">
        {selectedProduct ? (
          <ListingDetail
            key={selectedProduct.id}
            product={selectedProduct}
            settings={settings}
            templates={templates}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 p-8">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <Package className="w-8 h-8" />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">商品を選択してください</p>
              <p className="text-xs mt-1">左のリストから出品する商品を選択すると<br />出品情報の編集・管理ができます</p>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs max-w-xs">
              {[
                { icon: Layers, label: "出品データ管理", desc: "フィールド別コピーで出品作業を効率化" },
                { icon: DollarSign, label: "価格・利益計算", desc: "落札相場から最適価格を自動提案" },
                { icon: Image, label: "写真管理", desc: "eBay推奨サイズに一括変換" },
                { icon: CheckCircle2, label: "準備度スコア", desc: "何が不足しているか一目で確認" },
              ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30">
                  <Icon className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-foreground text-[11px]">{label}</p>
                    <p className="text-muted-foreground text-[10px]">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
