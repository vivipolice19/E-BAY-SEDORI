import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { SavedProduct, AppSettings } from "@shared/schema";
import {
  FileSpreadsheet,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";

export default function SheetsSync() {
  const { toast } = useToast();
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [isEnsuring, setIsEnsuring] = useState(false);

  const { data: products = [], isLoading: productsLoading } = useQuery<SavedProduct[]>({
    queryKey: ["/api/products"],
  });

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ["/api/settings"],
  });

  const { data: sheetsInfo, isLoading: sheetsLoading, error: sheetsError, refetch } = useQuery({
    queryKey: ["/api/sheets/info"],
    retry: false,
  });

  const synced = products.filter((p) => p.syncedToSheets);
  const unsynced = products.filter((p) => !p.syncedToSheets);

  const handleSyncAll = async () => {
    setIsSyncingAll(true);
    try {
      const res = await apiRequest("POST", "/api/sheets/sync-all");
      const result = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: "同期完了",
        description: `${result.synced}件をスプレッドシートに追加しました`,
      });
    } catch (e: any) {
      toast({ title: "同期エラー", description: e.message, variant: "destructive" });
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleEnsureSheet = async () => {
    setIsEnsuring(true);
    try {
      await apiRequest("POST", "/api/sheets/ensure-sheet");
      toast({ title: "シート確認完了", description: "セドリリストシートを確認・作成しました" });
      refetch();
    } catch (e: any) {
      toast({ title: "エラー", description: e.message, variant: "destructive" });
    } finally {
      setIsEnsuring(false);
    }
  };

  const spreadsheetUrl = settings?.spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}`
    : null;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">スプレッドシート同期</h1>
        <p className="text-sm text-muted-foreground mt-1">
          保存リストをGoogleスプレッドシートへ出力します
        </p>
      </div>

      {/* Sheet Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" />
            スプレッドシート接続状況
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {sheetsLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : sheetsError ? (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive font-medium">接続エラー</p>
              <p className="text-xs text-muted-foreground mt-1">
                スプレッドシートIDが正しいか、Googleアカウントの連携が有効か確認してください。
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-green-700 dark:text-green-300">
                  接続済み
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {(sheetsInfo as any)?.title || "スプレッドシート"}
                </p>
              </div>
              {spreadsheetUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-shrink-0 gap-1"
                  onClick={() => window.open(spreadsheetUrl, "_blank")}
                  data-testid="button-open-sheet"
                >
                  <ExternalLink className="w-3 h-3" />
                  開く
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleEnsureSheet}
              disabled={isEnsuring}
              className="gap-2"
              data-testid="button-ensure-sheet"
            >
              {isEnsuring ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              セドリリストシートを作成/確認
            </Button>
          </div>

          <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-3 leading-relaxed">
            <p className="font-medium text-foreground mb-1">出力シートの構成</p>
            <p>「セドリリスト」シートに以下の列で追加されます：</p>
            <p className="mt-1 font-mono text-xs">
              商品名 / eBay価格($) / eBay価格(¥) / 仕入値(¥) / 利益(¥) / 利益率 / カテゴリ / 状態 / 販売数 / eBay URL / 仕入先 / 仕入先URL / メモ / 登録日
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Sync Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5 text-center">
            <p className="text-3xl font-bold text-foreground">{products.length}</p>
            <p className="text-sm text-muted-foreground mt-1">合計保存商品</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 text-center">
            <p className="text-3xl font-bold text-green-600">{synced.length}</p>
            <p className="text-sm text-muted-foreground mt-1">同期済み</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 text-center">
            <p className="text-3xl font-bold text-orange-500">{unsynced.length}</p>
            <p className="text-sm text-muted-foreground mt-1">未同期</p>
          </CardContent>
        </Card>
      </div>

      {unsynced.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4 h-4 text-orange-500" />
                未同期商品 ({unsynced.length}件)
              </CardTitle>
              <Button
                onClick={handleSyncAll}
                disabled={isSyncingAll}
                className="gap-2"
                data-testid="button-sync-all-sheets"
              >
                {isSyncingAll ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="w-4 h-4" />
                )}
                全件同期する
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {unsynced.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 p-2 rounded-md bg-card border border-card-border"
                >
                  <Clock className="w-4 h-4 text-orange-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{p.name}</p>
                    {p.ebayPriceJpy && (
                      <p className="text-xs text-muted-foreground">
                        ¥{p.ebayPriceJpy.toLocaleString()}
                        {p.profit != null ? ` / 利益: ¥${p.profit.toLocaleString()}` : ""}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {synced.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              同期済み商品 ({synced.length}件)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {synced.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 p-2 rounded-md bg-card border border-card-border"
                >
                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <p className="text-sm text-foreground flex-1 truncate">{p.name}</p>
                  {p.profit != null && (
                    <Badge
                      variant={p.profit > 0 ? "default" : "destructive"}
                      className="text-xs flex-shrink-0"
                    >
                      ¥{p.profit.toLocaleString()}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
