import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import type { AppSettings } from "@shared/schema";
import { Calculator, TrendingUp, TrendingDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";

function ResultRow({ label, value, type = "neutral" }: {
  label: string;
  value: string;
  type?: "positive" | "negative" | "neutral" | "total";
}) {
  return (
    <div className={cn("flex justify-between items-center py-1.5 px-2 rounded-md", {
      "bg-green-50 dark:bg-green-950": type === "positive",
      "bg-red-50 dark:bg-red-950": type === "negative",
      "bg-muted/30": type === "neutral",
      "bg-card border border-card-border": type === "total",
    })}>
      <span className={cn("text-sm", {
        "text-green-700 dark:text-green-300": type === "positive",
        "text-red-600 dark:text-red-400": type === "negative",
        "text-muted-foreground": type === "neutral",
        "font-medium text-foreground": type === "total",
      })}>
        {label}
      </span>
      <span className={cn("text-sm font-medium", {
        "text-green-700 dark:text-green-300": type === "positive",
        "text-red-600 dark:text-red-400": type === "negative",
        "font-bold text-base": type === "total",
      })}>
        {value}
      </span>
    </div>
  );
}

export default function CalcPage() {
  const { data: settings } = useQuery<AppSettings>({
    queryKey: ["/api/settings"],
  });

  const [ebayUSD, setEbayUSD] = useState("");
  const [sourcePrice, setSourcePrice] = useState("");
  const [feeRate, setFeeRate] = useState("13.25");
  const [shipping, setShipping] = useState("1500");
  const [otherFees, setOtherFees] = useState("500");
  const [customRate, setCustomRate] = useState("150");

  useEffect(() => {
    if (settings) {
      setCustomRate(String(settings.exchangeRate || 150));
      setFeeRate(String(settings.ebayFeeRate || 13.25));
      setShipping(String(settings.shippingCost || 1500));
      setOtherFees(String(settings.otherFees || 500));
    }
  }, [settings]);

  const ebayJpy = ebayUSD ? Math.round(parseFloat(ebayUSD) * parseFloat(customRate || "150")) : 0;
  const ebayFee = ebayJpy ? Math.round(ebayJpy * (parseFloat(feeRate || "13.25") / 100)) : 0;
  const shippingNum = parseInt(shipping || "0");
  const otherNum = parseInt(otherFees || "0");
  const sourcePriceNum = parseInt(sourcePrice || "0");
  const totalCost = ebayFee + shippingNum + otherNum + sourcePriceNum;
  const profit = ebayJpy - totalCost;
  const profitRate = ebayJpy > 0 ? (profit / ebayJpy) * 100 : 0;
  const isProfit = profit > 0;

  // Reverse calculation: max source price for target profit rate
  const [targetRate, setTargetRate] = useState("20");
  const targetProfit = ebayJpy * (parseFloat(targetRate || "20") / 100);
  const maxSourcePrice = ebayJpy - ebayFee - shippingNum - otherNum - targetProfit;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">利益計算機</h1>
        <p className="text-sm text-muted-foreground mt-1">
          eBay販売価格から仕入れ限界価格・利益を計算します
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Input */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="w-4 h-4" />
              入力
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">eBay販売価格 ($)</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={ebayUSD}
                  onChange={(e) => setEbayUSD(e.target.value)}
                  data-testid="input-calc-ebay-usd"
                />
                {ebayJpy > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">≈ ¥{ebayJpy.toLocaleString()}</p>
                )}
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">仕入れ価格 (¥)</Label>
                <Input
                  type="number"
                  placeholder="0"
                  value={sourcePrice}
                  onChange={(e) => setSourcePrice(e.target.value)}
                  data-testid="input-calc-source-price"
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">費用設定</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">為替レート (¥/$)</Label>
                  <Input
                    type="number"
                    value={customRate}
                    onChange={(e) => setCustomRate(e.target.value)}
                    data-testid="input-calc-rate"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">eBay手数料 (%)</Label>
                  <Input
                    type="number"
                    value={feeRate}
                    onChange={(e) => setFeeRate(e.target.value)}
                    data-testid="input-calc-fee-rate"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">送料 (¥)</Label>
                  <Input
                    type="number"
                    value={shipping}
                    onChange={(e) => setShipping(e.target.value)}
                    data-testid="input-calc-shipping"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">その他費用 (¥)</Label>
                  <Input
                    type="number"
                    value={otherFees}
                    onChange={(e) => setOtherFees(e.target.value)}
                    data-testid="input-calc-other-fees"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right: Results */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">計算結果</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {ebayJpy > 0 ? (
                <>
                  <ResultRow label="eBay販売額" value={`¥${ebayJpy.toLocaleString()}`} type="positive" />
                  <ResultRow label={`eBay手数料 (${feeRate}%)`} value={`-¥${ebayFee.toLocaleString()}`} type="negative" />
                  <ResultRow label="送料" value={`-¥${shippingNum.toLocaleString()}`} type="negative" />
                  <ResultRow label="その他費用" value={`-¥${otherNum.toLocaleString()}`} type="negative" />
                  {sourcePriceNum > 0 && (
                    <ResultRow label="仕入れ費用" value={`-¥${sourcePriceNum.toLocaleString()}`} type="negative" />
                  )}
                  <Separator className="my-2" />
                  <ResultRow
                    label={isProfit ? "利益" : "損失"}
                    value={`${isProfit ? "+" : ""}¥${profit.toLocaleString()}`}
                    type="total"
                  />
                  <div className="flex justify-center mt-3">
                    <div
                      className={cn(
                        "inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold",
                        isProfit
                          ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300"
                          : "bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400"
                      )}
                      data-testid="badge-profit-status"
                    >
                      {isProfit ? (
                        <TrendingUp className="w-4 h-4" />
                      ) : (
                        <TrendingDown className="w-4 h-4" />
                      )}
                      利益率: {profitRate.toFixed(1)}%
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  左側にeBay価格を入力すると<br />計算結果が表示されます
                </div>
              )}
            </CardContent>
          </Card>

          {/* Max Source Price */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Info className="w-4 h-4" />
                逆算：仕入れ限界価格
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">目標利益率 (%)</Label>
                <Input
                  type="number"
                  value={targetRate}
                  onChange={(e) => setTargetRate(e.target.value)}
                  data-testid="input-target-rate"
                />
              </div>
              {ebayJpy > 0 ? (
                <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-950 text-center">
                  <p className="text-xs text-muted-foreground mb-1">
                    利益率{targetRate}%を確保するための最高仕入れ価格
                  </p>
                  <p
                    className="text-2xl font-bold text-blue-600"
                    data-testid="text-max-source"
                  >
                    ¥{Math.max(0, Math.round(maxSourcePrice)).toLocaleString()}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-2">
                  eBay価格を入力してください
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
