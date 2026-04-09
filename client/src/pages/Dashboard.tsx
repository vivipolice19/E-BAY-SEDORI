import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import type { SavedProduct } from "@shared/schema";
import {
  TrendingUp,
  TrendingDown,
  Package,
  FileSpreadsheet,
  Search,
  ShoppingCart,
  ArrowRight,
  Coins,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  color,
  loading,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground mb-1">{title}</p>
            {loading ? (
              <Skeleton className="h-7 w-24 mb-1" />
            ) : (
              <p className="text-2xl font-bold text-foreground">{value}</p>
            )}
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={cn("w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0", color)}>
            <Icon className="w-5 h-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: products = [], isLoading } = useQuery<SavedProduct[]>({
    queryKey: ["/api/products"],
  });

  const { data: settings } = useQuery({
    queryKey: ["/api/settings"],
  });

  const totalProducts = products.length;
  const syncedProducts = products.filter((p) => p.syncedToSheets).length;
  const profitableProducts = products.filter((p) => (p.profit ?? 0) > 0);
  const avgProfit =
    profitableProducts.length > 0
      ? Math.round(
          profitableProducts.reduce((sum, p) => sum + (p.profit ?? 0), 0) /
            profitableProducts.length
        )
      : 0;

  const totalPotentialProfit = profitableProducts.reduce(
    (sum, p) => sum + (p.profit ?? 0),
    0
  );

  const bestProduct = products
    .filter((p) => (p.profitRate ?? 0) > 0)
    .sort((a, b) => (b.profitRate ?? 0) - (a.profitRate ?? 0))[0];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">ダッシュボード</h1>
        <p className="text-sm text-muted-foreground mt-1">
          せどりリサーチの状況サマリー
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="保存済み商品"
          value={String(totalProducts)}
          sub="件"
          icon={Package}
          color="bg-blue-500"
          loading={isLoading}
        />
        <StatCard
          title="平均利益"
          value={avgProfit > 0 ? `¥${avgProfit.toLocaleString()}` : "—"}
          sub="利益のある商品"
          icon={TrendingUp}
          color="bg-green-500"
          loading={isLoading}
        />
        <StatCard
          title="累計潜在利益"
          value={`¥${totalPotentialProfit.toLocaleString()}`}
          sub="全保存商品合計"
          icon={Coins}
          color="bg-purple-500"
          loading={isLoading}
        />
        <StatCard
          title="Sheets同期済み"
          value={`${syncedProducts}/${totalProducts}`}
          sub="件"
          icon={FileSpreadsheet}
          color="bg-orange-500"
          loading={isLoading}
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="hover-elevate cursor-pointer">
          <CardContent className="p-5">
            <Link href="/search">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-md bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
                  <Search className="w-6 h-6 text-blue-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-foreground">eBay検索</p>
                  <p className="text-xs text-muted-foreground">売れ筋商品を探す</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </Link>
          </CardContent>
        </Card>

        <Card className="hover-elevate cursor-pointer">
          <CardContent className="p-5">
            <Link href="/research">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-md bg-green-50 dark:bg-green-950 flex items-center justify-center">
                  <ShoppingCart className="w-6 h-6 text-green-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-foreground">仕入れ調査</p>
                  <p className="text-xs text-muted-foreground">メルカリ・ヤフオク価格</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </Link>
          </CardContent>
        </Card>

        <Card className="hover-elevate cursor-pointer">
          <CardContent className="p-5">
            <Link href="/sheets">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-md bg-orange-50 dark:bg-orange-950 flex items-center justify-center">
                  <FileSpreadsheet className="w-6 h-6 text-orange-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-foreground">Sheets同期</p>
                  <p className="text-xs text-muted-foreground">スプレッドシートへ出力</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Recent Products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">最近の保存商品</CardTitle>
              <Link href="/watchlist">
                <Button variant="ghost" size="sm" className="text-xs gap-1">
                  すべて見る <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-8">
                <Package className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  まだ保存された商品がありません
                </p>
                <Link href="/search">
                  <Button size="sm" className="mt-3">
                    eBayで検索する
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {products.slice(0, 5).map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center gap-3 p-2 rounded-md bg-card border border-card-border"
                  >
                    {product.ebayImageUrl ? (
                      <img
                        src={product.ebayImageUrl}
                        alt={product.name}
                        className="w-10 h-10 object-cover rounded"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                        <Package className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {product.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        eBay: ¥{(product.ebayPriceJpy ?? 0).toLocaleString()}
                        {product.sourcePrice
                          ? ` / 仕入: ¥${product.sourcePrice.toLocaleString()}`
                          : ""}
                      </p>
                    </div>
                    {product.profit !== null && product.profit !== undefined && (
                      <Badge
                        variant={product.profit > 0 ? "default" : "destructive"}
                        className="text-xs flex-shrink-0"
                      >
                        {product.profit > 0 ? "+" : ""}¥{product.profit.toLocaleString()}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Best Product */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-500" />
              最高利益率商品
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : bestProduct ? (
              <div className="space-y-4">
                <div className="flex gap-3">
                  {bestProduct.ebayImageUrl ? (
                    <img
                      src={bestProduct.ebayImageUrl}
                      alt={bestProduct.name}
                      className="w-20 h-20 object-cover rounded-md"
                    />
                  ) : (
                    <div className="w-20 h-20 bg-muted rounded-md flex items-center justify-center">
                      <Package className="w-8 h-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-sm leading-snug line-clamp-2">
                      {bestProduct.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {bestProduct.ebayCategory}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-muted/50 rounded-md text-center">
                    <p className="text-xs text-muted-foreground">eBay価格</p>
                    <p className="text-sm font-bold">
                      ¥{(bestProduct.ebayPriceJpy ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-2 bg-muted/50 rounded-md text-center">
                    <p className="text-xs text-muted-foreground">仕入値</p>
                    <p className="text-sm font-bold">
                      {bestProduct.sourcePrice
                        ? `¥${bestProduct.sourcePrice.toLocaleString()}`
                        : "—"}
                    </p>
                  </div>
                  <div className="p-2 bg-green-50 dark:bg-green-950 rounded-md text-center">
                    <p className="text-xs text-muted-foreground">利益率</p>
                    <p className="text-sm font-bold text-green-600">
                      {bestProduct.profitRate?.toFixed(1)}%
                    </p>
                  </div>
                </div>
                {bestProduct.ebayUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => window.open(bestProduct.ebayUrl!, "_blank")}
                  >
                    eBayで見る
                  </Button>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <TrendingDown className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  利益計算済みの商品がありません
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
