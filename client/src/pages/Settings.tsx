import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { AppSettings } from "@shared/schema";

type SettingsResponse = AppSettings & {
  ebayUserTokenConfigured?: boolean;
  ebayDevIdConfigured?: boolean;
};
import {
  Settings, FileSpreadsheet, DollarSign, Save, Loader2,
  ExternalLink, Info, Truck, Package, RefreshCw, ShoppingBag,
  KeyRound, AlertTriangle, CheckCircle2, Eye, EyeOff,
} from "lucide-react";

export default function SettingsPage() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useQuery<SettingsResponse>({
    queryKey: ["/api/settings"],
  });

  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [inventorySheetName, setInventorySheetName] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [ebayFeeRate, setEbayFeeRate] = useState("");
  const [otherFees, setOtherFees] = useState("");
  // Forwarding agent settings
  const [forwardingDomesticShipping, setForwardingDomesticShipping] = useState("");
  const [forwardingAgentFee, setForwardingAgentFee] = useState("");
  const [forwardingIntlBase, setForwardingIntlBase] = useState("");
  const [forwardingIntlPerGram, setForwardingIntlPerGram] = useState("");
  // eBay seller account
  const [ebayUserToken, setEbayUserToken] = useState("");
  const [ebayDevId, setEbayDevId] = useState("");
  const [ebayStoreName, setEbayStoreName] = useState("");
  const [ebayPaymentPolicy, setEbayPaymentPolicy] = useState("");
  const [ebayReturnPolicy, setEbayReturnPolicy] = useState("");
  const [ebayShippingPolicy, setEbayShippingPolicy] = useState("");
  const [ebayDispatchDays, setEbayDispatchDays] = useState("3");
  const [ebayLocation, setEbayLocation] = useState("Japan");
  const [ebayAppId, setEbayAppId] = useState("");
  const [ebayCertId, setEbayCertId] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showEbayCert, setShowEbayCert] = useState(false);

  // Forwarding cost preview
  const [previewWeight, setPreviewWeight] = useState("300");

  useEffect(() => {
    if (settings) {
      setSpreadsheetId(settings.spreadsheetId || "");
      setSheetName(settings.sheetName || "セドリリスト");
      setInventorySheetName(settings.inventorySheetName || "Mercari-eBay 在庫管理");
      setExchangeRate(String(settings.exchangeRate || 150));
      setEbayFeeRate(String(settings.ebayFeeRate || 13.25));
      setOtherFees(String(settings.otherFees || 500));
      setForwardingDomesticShipping(String(settings.forwardingDomesticShipping ?? 800));
      setForwardingAgentFee(String(settings.forwardingAgentFee ?? 500));
      setForwardingIntlBase(String(settings.forwardingIntlBase ?? 2000));
      setForwardingIntlPerGram(String(settings.forwardingIntlPerGram ?? 3));
      setEbayUserToken(settings.ebayUserToken || "");
      setEbayDevId(settings.ebayDevId || "");
      setEbayStoreName(settings.ebayStoreName || "");
      setEbayPaymentPolicy(settings.ebayPaymentPolicy || "");
      setEbayReturnPolicy(settings.ebayReturnPolicy || "");
      setEbayShippingPolicy(settings.ebayShippingPolicy || "");
      setEbayDispatchDays(String(settings.ebayDispatchDays ?? 3));
      setEbayLocation(settings.ebayLocation || "Japan");
      setEbayAppId(settings.ebayAppId || "");
      setEbayCertId(settings.ebayCertId || "");
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", "/api/settings", {
        spreadsheetId,
        sheetName,
        inventorySheetName,
        exchangeRate: parseFloat(exchangeRate),
        ebayFeeRate: parseFloat(ebayFeeRate),
        otherFees: parseInt(otherFees),
        forwardingDomesticShipping: parseInt(forwardingDomesticShipping),
        forwardingAgentFee: parseInt(forwardingAgentFee),
        forwardingIntlBase: parseInt(forwardingIntlBase),
        forwardingIntlPerGram: parseInt(forwardingIntlPerGram),
        ebayUserToken: ebayUserToken || null,
        ebayDevId: ebayDevId || null,
        ebayStoreName: ebayStoreName || null,
        ebayPaymentPolicy: ebayPaymentPolicy || null,
        ebayReturnPolicy: ebayReturnPolicy || null,
        ebayShippingPolicy: ebayShippingPolicy || null,
        ebayDispatchDays: parseInt(ebayDispatchDays) || 3,
        ebayLocation: ebayLocation || "Japan",
        ebayAppId: ebayAppId.trim() || null,
        ebayCertId: ebayCertId.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "保存しました", description: "設定を保存しました" });
    },
    onError: (e: any) => {
      toast({ title: "エラー", description: e.message, variant: "destructive" });
    },
  });

  const spreadsheetUrl = spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
    : null;

  // Forwarding cost preview
  const weight = parseFloat(previewWeight) || 0;
  const domestic = parseInt(forwardingDomesticShipping) || 0;
  const agent = parseInt(forwardingAgentFee) || 0;
  const intlBase = parseInt(forwardingIntlBase) || 0;
  const intlPerGram = parseInt(forwardingIntlPerGram) || 0;
  const international = intlBase + Math.round(weight * intlPerGram);
  const totalForwarding = domestic + agent + international;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Settings className="w-6 h-6" />設定
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          eBayセラーアカウント・スプレッドシート・発送代行費・費用・為替レートの設定
        </p>
      </div>

      {/* eBay API keys (search OAuth + Trading headers) */}
      <Card className="border-blue-200 dark:border-blue-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-blue-600" />
            eBay API（検索・出品）
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-xs space-y-1.5 text-blue-800 dark:text-blue-200">
            <p>
              <a href="https://developer.ebay.com/my/keys" target="_blank" rel="noreferrer" className="underline font-medium">
                My Keys（Production）
              </a>
              の <strong>App ID（Client ID）</strong> と <strong>Cert ID（Client Secret）</strong> を入力します。商品検索（Finding / Browse OAuth）と Trading API 出品の HTTP ヘッダの両方に使われます。
            </p>
            <p className="text-[10px] opacity-90">
              環境変数 <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">EBAY_APP_ID</code> / <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">EBAY_CERT_ID</code> をホストに設定している場合は、そちらが<strong>優先</strong>されます（空白だけの場合は設定画面の値を使います）。
              出品用: <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">EBAY_USER_TOKEN</code> / <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">EBAY_DEV_ID</code> も同様です。
              Render 等では <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">DATABASE_URL</code>（PostgreSQL）を付けると「保存」した設定が再起動後も残ります。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">App ID（Client ID）</Label>
            <Input
              value={ebayAppId}
              onChange={(e) => setEbayAppId(e.target.value)}
              placeholder="例: YourApp-PRD-xxxxxxxx-xxffffff"
              className="text-xs font-mono"
              autoComplete="off"
              data-testid="input-ebay-app-id"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm flex items-center justify-between">
              <span>Cert ID（Client Secret）</span>
              <button
                type="button"
                onClick={() => setShowEbayCert(!showEbayCert)}
                className="text-muted-foreground hover:text-foreground p-0.5"
                aria-label={showEbayCert ? "隠す" : "表示"}
              >
                {showEbayCert ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </Label>
            <Input
              type={showEbayCert ? "text" : "password"}
              value={ebayCertId}
              onChange={(e) => setEbayCertId(e.target.value)}
              placeholder="PRD-xxxxxxxx-xxxx-…"
              className="text-xs font-mono"
              autoComplete="new-password"
              data-testid="input-ebay-cert-id"
            />
          </div>
        </CardContent>
      </Card>

      {/* eBay Seller Account */}
      <Card className="border-orange-200 dark:border-orange-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-orange-600" />
            eBayセラーアカウント設定
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-xs space-y-1.5">
            <p className="font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" />
              eBay Trading API ユーザートークンの取得方法
            </p>
            <ol className="list-decimal list-inside text-amber-600 dark:text-amber-400 space-y-0.5 pl-1">
              <li>
                <a href="https://developer.ebay.com/signin" target="_blank" rel="noreferrer" className="underline hover:text-amber-800">
                  eBay Developer Program
                </a>
                にセラーアカウントでサインイン
              </li>
              <li>「Get a User Token」→ Auth'n'Auth フロー でトークン取得</li>
              <li>取得したトークン（長い文字列）を下記に貼り付け</li>
              <li>
                <a href="https://developer.ebay.com/my/keys" target="_blank" rel="noreferrer" className="underline hover:text-amber-800">
                  My Keys
                </a>
                から Dev ID をコピーして貼り付け
              </li>
            </ol>
            <p className="text-amber-500 dark:text-amber-500 text-[10px]">
              ※ 上の「eBay API（検索・出品）」または環境変数で App ID / Cert ID を設定してください。
            </p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm flex items-center justify-between">
                <span>eBay User Token（Trading API）</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${(settings?.ebayUserTokenConfigured || !!ebayUserToken) ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                  {(settings?.ebayUserTokenConfigured || !!ebayUserToken) ? "✓ 利用可" : "未設定"}
                </span>
              </Label>
              <div className="relative">
                <Textarea
                  value={ebayUserToken}
                  onChange={e => setEbayUserToken(e.target.value)}
                  placeholder="AgAAAA**AQAAAA**aAAAAA**...（長い文字列）"
                  rows={3}
                  className="text-xs font-mono pr-8"
                  data-testid="input-ebay-user-token"
                  style={{ WebkitTextSecurity: showToken ? "none" : "disc" } as any}
                />
                <button onClick={() => setShowToken(!showToken)}
                  className="absolute top-2 right-2 text-muted-foreground hover:text-foreground">
                  {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            {settings?.ebayUserTokenConfigured && !ebayUserToken.trim() && (
              <p className="text-[10px] text-muted-foreground">
                環境変数 <code className="bg-muted px-0.5 rounded">EBAY_USER_TOKEN</code> が有効です（値は画面に出しません）。
              </p>
            )}

            <div className="space-y-1.5">
              <Label className="text-sm">Dev ID（開発者ID）</Label>
              <Input
                value={ebayDevId}
                onChange={e => setEbayDevId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="text-xs font-mono"
                data-testid="input-ebay-dev-id"
              />
              <p className="text-xs text-muted-foreground">eBay Developerページの My Keys に表示される Dev ID</p>
              {settings?.ebayDevIdConfigured && !ebayDevId.trim() && (
                <p className="text-[10px] text-muted-foreground">
                  環境変数 <code className="bg-muted px-0.5 rounded">EBAY_DEV_ID</code> が有効です。
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm">発送日数（Dispatch Days）</Label>
                <Input
                  type="number"
                  value={ebayDispatchDays}
                  onChange={e => setEbayDispatchDays(e.target.value)}
                  className="text-xs"
                  placeholder="3"
                  data-testid="input-ebay-dispatch-days"
                />
                <p className="text-xs text-muted-foreground">注文から発送までの日数</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">発送元（ShipToLocation）</Label>
                <Input
                  value={ebayLocation}
                  onChange={e => setEbayLocation(e.target.value)}
                  placeholder="Japan"
                  className="text-xs"
                  data-testid="input-ebay-location"
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">
              Business policies（数値のプロファイルID）— 3つとも入力すると Trading API で SellerProfiles を使います。未入力または一部だけの場合は従来の固定の配送・返品XMLにフォールバックします。
            </p>
            <div className="space-y-2">
              <div className="space-y-1.5">
                <Label className="text-sm">支払いポリシーID（Payment profile ID）</Label>
                <Input
                  value={ebayPaymentPolicy}
                  onChange={e => setEbayPaymentPolicy(e.target.value)}
                  placeholder="例: 5000000000（数字のみ）"
                  className="text-xs font-mono"
                  data-testid="input-ebay-payment-policy"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">返品ポリシーID（Return profile ID）</Label>
                <Input
                  value={ebayReturnPolicy}
                  onChange={e => setEbayReturnPolicy(e.target.value)}
                  placeholder="例: 5000000000（数字のみ）"
                  className="text-xs font-mono"
                  data-testid="input-ebay-return-policy"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">配送ポリシーID（Shipping profile ID）</Label>
                <Input
                  value={ebayShippingPolicy}
                  onChange={e => setEbayShippingPolicy(e.target.value)}
                  placeholder="例: 5000000000（数字のみ）"
                  className="text-xs font-mono"
                  data-testid="input-ebay-shipping-policy"
                />
              </div>
            </div>
          </div>

          {(settings?.ebayUserTokenConfigured || !!ebayUserToken) && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 text-xs text-green-700 dark:text-green-300">
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
              <span>
                出品用トークンが利用可能です（設定画面の保存値または環境変数 <code className="bg-green-100 dark:bg-green-900 px-0.5 rounded">EBAY_USER_TOKEN</code>）。
                出品管理ページから「eBayに出品する」で直接出品できます。
              </span>
            </div>
          )}

          {!(settings?.ebayUserTokenConfigured || !!ebayUserToken) && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 text-xs text-yellow-700 dark:text-yellow-300">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>トークン未設定のため、出品管理ページの「eBayに出品」ボタンは使用できません。eBay Seller Hubで手動出品は引き続き可能です。</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Spreadsheet Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-primary" />
            スプレッドシート設定
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">スプレッドシートID</Label>
            <div className="flex gap-2">
              <Input
                placeholder="1j-SK1yrXw2Sl_3-..."
                value={spreadsheetId}
                onChange={(e) => setSpreadsheetId(e.target.value)}
                data-testid="input-spreadsheet-id"
              />
              {spreadsheetUrl && (
                <Button variant="outline" size="icon" onClick={() => window.open(spreadsheetUrl, "_blank")}
                  data-testid="button-open-spreadsheet">
                  <ExternalLink className="w-4 h-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              スプレッドシートURLの「/d/」と「/edit」の間の文字列
            </p>
            <p className="text-[10px] text-muted-foreground border-l-2 border-amber-400 pl-2 leading-relaxed">
              <strong className="text-amber-800 dark:text-amber-200">Render 等:</strong> Google のサービスアカウント JSON を環境変数{" "}
              <code className="bg-muted px-1 rounded">GOOGLE_SERVICE_ACCOUNT_JSON</code> に<strong>1行</strong>で設定し、
              スプレッドシートをその <code className="bg-muted px-1 rounded">client_email</code> に編集者で共有してください（Sheets API 有効化が必要）。
              Replit は従来どおりコネクタでも可。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm">セドリリスト シート名</Label>
              <Input
                placeholder="セドリリスト"
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                data-testid="input-sheet-name"
              />
              <p className="text-xs text-muted-foreground">商品リスト・台帳シート（23列・行更新対応）</p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">在庫管理 シート名</Label>
              <Input
                placeholder="Mercari-eBay 在庫管理"
                value={inventorySheetName}
                onChange={(e) => setInventorySheetName(e.target.value)}
                data-testid="input-inventory-sheet-name"
              />
              <p className="text-xs text-muted-foreground">「出品中」変更時にA〜E列を自動追記</p>
            </div>
          </div>

          <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-xs space-y-1">
            <p className="font-medium text-blue-700 dark:text-blue-300">📋 スプレッドシート管理方式</p>
            <p className="text-blue-600 dark:text-blue-400">• セドリリスト：全商品データの台帳（23列 A:W。R〜T列に落札相場の最安/平均/最高を記録）</p>
            <p className="text-blue-600 dark:text-blue-400">• 在庫管理シート：「出品中」に変更した瞬間にA〜E列のみ自動追記</p>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              data-testid="button-update-sheet-headers"
              onClick={async () => {
                try {
                  const res = await fetch("/api/sheets/update-headers", { method: "POST" });
                  const data = await res.json();
                  if (data.success) {
                    toast({ title: "ヘッダー更新完了", description: "スプレッドシートのヘッダー行を最新の形式に修正しました" });
                  } else {
                    toast({ title: "エラー", description: data.error || "更新に失敗しました", variant: "destructive" });
                  }
                } catch (e: any) {
                  toast({ title: "エラー", description: e.message, variant: "destructive" });
                }
              }}
            >
              <RefreshCw className="w-3 h-3" />
              ヘッダー行を最新に修正
            </Button>
            <p className="text-xs text-muted-foreground self-center">既存シートのヘッダーが古い場合やずれている場合に使用</p>
          </div>
        </CardContent>
      </Card>

      {/* Forwarding Agent Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="w-4 h-4 text-primary" />
            発送代行費設定
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm">国内送料 (仕入先→代行倉庫) ¥</Label>
              <Input
                type="number"
                value={forwardingDomesticShipping}
                onChange={(e) => setForwardingDomesticShipping(e.target.value)}
                data-testid="input-forwarding-domestic"
              />
              <p className="text-xs text-muted-foreground">ヤマト・佐川等の発送費用</p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">代行手数料 (検品・梱包等) ¥</Label>
              <Input
                type="number"
                value={forwardingAgentFee}
                onChange={(e) => setForwardingAgentFee(e.target.value)}
                data-testid="input-forwarding-agent-fee"
              />
              <p className="text-xs text-muted-foreground">代行業者への手数料</p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">国際送料 基本料金 ¥</Label>
              <Input
                type="number"
                value={forwardingIntlBase}
                onChange={(e) => setForwardingIntlBase(e.target.value)}
                data-testid="input-forwarding-intl-base"
              />
              <p className="text-xs text-muted-foreground">EMS/DHL等の基本料金（重量加算前）</p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">国際送料 重量単価 ¥/g</Label>
              <Input
                type="number"
                value={forwardingIntlPerGram}
                onChange={(e) => setForwardingIntlPerGram(e.target.value)}
                data-testid="input-forwarding-per-gram"
              />
              <p className="text-xs text-muted-foreground">1gあたりの追加送料</p>
            </div>
          </div>

          {/* Cost Preview */}
          <div className="p-4 rounded-lg border border-border bg-muted/20">
            <p className="text-xs font-medium text-foreground mb-3 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-primary" />発送代行費プレビュー
            </p>
            <div className="flex items-center gap-2 mb-3">
              <Label className="text-xs whitespace-nowrap">商品重量 (g)</Label>
              <Input
                type="number"
                value={previewWeight}
                onChange={(e) => setPreviewWeight(e.target.value)}
                className="h-7 text-xs w-28"
                placeholder="300"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between p-2 bg-background rounded border">
                <span className="text-muted-foreground">国内送料</span>
                <span className="font-medium">¥{domestic.toLocaleString()}</span>
              </div>
              <div className="flex justify-between p-2 bg-background rounded border">
                <span className="text-muted-foreground">代行手数料</span>
                <span className="font-medium">¥{agent.toLocaleString()}</span>
              </div>
              <div className="flex justify-between p-2 bg-background rounded border">
                <span className="text-muted-foreground">国際送料 ({weight}g)</span>
                <span className="font-medium">¥{international.toLocaleString()}</span>
              </div>
              <div className="flex justify-between p-2 bg-primary/10 rounded border border-primary/30">
                <span className="font-medium text-primary">合計</span>
                <span className="font-bold text-primary">¥{totalForwarding.toLocaleString()}</span>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              国際送料 = ¥{intlBase.toLocaleString()}（基本）+ {weight}g × ¥{intlPerGram}/g = ¥{international.toLocaleString()}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Fee Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-primary" />
            eBay手数料・為替設定
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm">為替レート (¥/$)</Label>
              <Input
                type="number"
                value={exchangeRate}
                onChange={(e) => setExchangeRate(e.target.value)}
                data-testid="input-settings-exchange-rate"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">eBay手数料率 (%)</Label>
              <Input
                type="number"
                step="0.01"
                value={ebayFeeRate}
                onChange={(e) => setEbayFeeRate(e.target.value)}
                data-testid="input-settings-fee-rate"
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label className="text-sm">その他費用 (¥)</Label>
              <Input
                type="number"
                value={otherFees}
                onChange={(e) => setOtherFees(e.target.value)}
                data-testid="input-settings-other-fees"
              />
              <p className="text-xs text-muted-foreground">PayPal手数料・梱包材等の雑費</p>
            </div>
          </div>

          <div className="p-3 rounded-md bg-muted/30 border border-border">
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                利益計算式：eBay販売価格(¥) − eBay手数料 − <strong>発送代行費合計(¥)</strong> − その他費用 − 仕入れ価格<br />
                発送代行費は商品の重量から自動計算されます（eBay Item Specificsから自動抽出）
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      <Button
        className="w-full gap-2"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        data-testid="button-save-settings"
      >
        {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        設定を保存
      </Button>

      {/* System Info */}
      <Card className="border-dashed">
        <CardContent className="p-4 space-y-2">
          <p className="text-xs font-medium text-foreground">システム情報</p>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>• eBay API: Browse API + Finding API + Trading API（出品）使用</p>
            <p>• Google Sheets: API v4（Render: GOOGLE_SERVICE_ACCOUNT_JSON / Replit: コネクタ）</p>
            <p>• スプレッドシート: {spreadsheetId ? "設定済み ✓" : "未設定"}</p>
            <p>• eBayセラートークン: {(settings?.ebayUserTokenConfigured || !!ebayUserToken) ? "設定済み ✓" : "未設定"}</p>
            <p>• 在庫管理シート: {inventorySheetName || "Mercari-eBay 在庫管理"}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
