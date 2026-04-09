import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { SavedProduct } from "@shared/schema";
import {
  Package,
  Trash2,
  ExternalLink,
  FileSpreadsheet,
  Search,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  Clock,
  Filter,
  Loader2,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type FilterType = "all" | "profitable" | "unresearched" | "synced";
type SortType = "newest" | "profit_high" | "profit_low" | "name";

export default function Watchlist() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortType>("newest");
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const { data: products = [], isLoading } = useQuery<SavedProduct[]>({
    queryKey: ["/api/products"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "削除しました" });
    },
    onError: (e: any) => {
      toast({ title: "エラー", description: e.message, variant: "destructive" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/sheets/sync/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "同期完了", description: "スプレッドシートに追加しました" });
      setSyncingId(null);
    },
    onError: (e: any) => {
      toast({ title: "同期エラー", description: e.message, variant: "destructive" });
      setSyncingId(null);
    },
  });

  const handleSync = (id: string) => {
    setSyncingId(id);
    syncMutation.mutate(id);
  };

  let filtered = products;

  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.ebayCategory || "").toLowerCase().includes(q) ||
      (p.sourcePlatform || "").toLowerCase().includes(q)
    );
  }

  if (filter === "profitable") filtered = filtered.filter((p) => (p.profit ?? 0) > 0);
  if (filter === "unresearched") filtered = filtered.filter((p) => !p.sourcePrice);
  if (filter === "synced") filtered = filtered.filter((p) => p.syncedToSheets);

  filtered = [...filtered].sort((a, b) => {
    if (sort === "profit_high") return (b.profit ?? -Infinity) - (a.profit ?? -Infinity);
    if (sort === "profit_low") return (a.profit ?? Infinity) - (b.profit ?? Infinity);
    if (sort === "name") return a.name.localeCompare(b.name);
    return new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime();
  });

  const profitableCount = products.filter((p) => (p.profit ?? 0) > 0).length;
  const unsyncedCount = products.filter((p) => !p.syncedToSheets).length;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">保存リスト</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {products.length}件保存済み・{profitableCount}件利益あり・{unsyncedCount}件未同期
          </p>
        </div>
        {unsyncedCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 flex-shrink-0"
            onClick={() => {
              apiRequest("POST", "/api/sheets/sync-all")
                .then((res) => res.json())
                .then(() => {
                  queryClient.invalidateQueries({ queryKey: ["/api/products"] });
                  toast({ title: "全件同期完了", description: `${unsyncedCount}件をSpreadSheetに追加しました` });
                }).catch((e) => {
                  toast({ title: "同期エラー", description: e.message, variant: "destructive" });
                });
            }}
            data-testid="button-sync-all"
          >
            <FileSpreadsheet className="w-4 h-4" />
            全件Sheetsへ同期 ({unsyncedCount})
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="商品名で検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-watchlist-search"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
          <SelectTrigger className="w-36" data-testid="select-filter">
            <Filter className="w-3 h-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべて</SelectItem>
            <SelectItem value="profitable">利益あり</SelectItem>
            <SelectItem value="unresearched">未調査</SelectItem>
            <SelectItem value="synced">同期済み</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortType)}>
          <SelectTrigger className="w-40" data-testid="select-sort-watchlist">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">新着順</SelectItem>
            <SelectItem value="profit_high">利益が高い順</SelectItem>
            <SelectItem value="profit_low">利益が低い順</SelectItem>
            <SelectItem value="name">名前順</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Package className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">
            {products.length === 0
              ? "保存された商品がまだありません"
              : "条件に合う商品がありません"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              onDelete={() => deleteMutation.mutate(product.id)}
              onSync={() => handleSync(product.id)}
              isSyncing={syncingId === product.id && syncMutation.isPending}
              isDeleting={deleteMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductRow({
  product,
  onDelete,
  onSync,
  isSyncing,
  isDeleting,
}: {
  product: SavedProduct;
  onDelete: () => void;
  onSync: () => void;
  isSyncing: boolean;
  isDeleting: boolean;
}) {
  const hasProfit = product.profit !== null && product.profit !== undefined;
  const isPositive = (product.profit ?? 0) > 0;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-4 flex-wrap">
          {product.ebayImageUrl ? (
            <img
              src={product.ebayImageUrl}
              alt={product.name}
              className="w-14 h-14 object-cover rounded-md flex-shrink-0"
            />
          ) : (
            <div className="w-14 h-14 bg-muted rounded-md flex items-center justify-center flex-shrink-0">
              <Package className="w-6 h-6 text-muted-foreground" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p
                className="font-medium text-foreground text-sm truncate max-w-xs cursor-pointer hover:text-primary"
                onClick={() => product.ebayUrl && window.open(product.ebayUrl, "_blank")}
                data-testid={`product-name-${product.id}`}
              >
                {product.name}
              </p>
              {product.syncedToSheets && (
                <Badge variant="secondary" className="text-xs gap-1 flex-shrink-0">
                  <CheckCircle2 className="w-3 h-3" />
                  同期済み
                </Badge>
              )}
              {!product.sourcePrice && (
                <Badge variant="outline" className="text-xs gap-1 flex-shrink-0">
                  <Clock className="w-3 h-3" />
                  未調査
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
              {product.ebayPriceJpy != null && (
                <span>eBay: ¥{product.ebayPriceJpy.toLocaleString()}</span>
              )}
              {product.sourcePrice != null && (
                <span>{product.sourcePlatform || "仕入"}: ¥{product.sourcePrice.toLocaleString()}</span>
              )}
              {product.ebayCategory && <span>{product.ebayCategory}</span>}
              {product.ebayCondition && <span>{product.ebayCondition}</span>}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0 flex-wrap justify-end">
            {hasProfit && (
              <div className="text-right">
                <div
                  className={`flex items-center gap-1 text-sm font-bold ${isPositive ? "text-green-600" : "text-destructive"}`}
                >
                  {isPositive ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  {isPositive ? "+" : ""}¥{(product.profit ?? 0).toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">
                  利益率 {product.profitRate?.toFixed(1)}%
                </div>
              </div>
            )}

            <div className="flex gap-1">
              {product.ebayUrl && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => window.open(product.ebayUrl!, "_blank")}
                  data-testid={`button-external-${product.id}`}
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              )}
              {!product.syncedToSheets && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onSync}
                  disabled={isSyncing}
                  data-testid={`button-sync-${product.id}`}
                >
                  {isSyncing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4" />
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={onDelete}
                disabled={isDeleting}
                className="text-destructive"
                data-testid={`button-delete-${product.id}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
