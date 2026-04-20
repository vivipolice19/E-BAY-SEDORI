import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Search, Copy, ImageIcon } from "lucide-react";

/** Googleの「画像で検索」入口（公式APIなし・URLによってはブロックされる場合あり） */
export function buildGoogleImageSearchUrl(imageUrl: string): string {
  return `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(imageUrl)}&sbisrc=cr_1_5_2&hl=ja`;
}

export function openImageUrlInNewTab(imageUrl: string) {
  window.open(imageUrl, "_blank", "noopener,noreferrer");
}

/** eBay出品画像から仕入先・同一出品の手掛かりを探す（Googleレンズはブラウザの右クリック推奨） */
export function EbayReverseImageTools({
  imageUrl,
  variant = "card",
}: {
  imageUrl: string | undefined;
  variant?: "card" | "panel";
}) {
  const { toast } = useToast();
  if (!imageUrl?.trim()) return null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const onCopy = async (e: React.MouseEvent) => {
    stop(e);
    try {
      await navigator.clipboard.writeText(imageUrl);
      toast({ title: "画像URLをコピーしました", description: "Googleレンズ等に貼り付けて検索できます。" });
    } catch {
      toast({ title: "コピーに失敗しました", variant: "destructive" });
    }
  };

  const onOpenImage = (e: React.MouseEvent) => {
    stop(e);
    openImageUrlInNewTab(imageUrl);
  };

  const onGoogleByImage = (e: React.MouseEvent) => {
    stop(e);
    window.open(buildGoogleImageSearchUrl(imageUrl), "_blank", "noopener,noreferrer");
    toast({
      title: "Google画像検索を開きました",
      description: "表示されない場合は「画像を開く」→ 画像上で右クリックし「Googleレンズで検索」を試してください。",
    });
  };

  const btnClass =
    variant === "panel"
      ? "h-7 text-[10px] px-2 gap-1"
      : "h-7 text-[10px] px-1.5 gap-0.5 flex-1 min-w-0";

  return (
    <div className={`flex flex-wrap gap-1 ${variant === "card" ? "w-full" : ""}`} onClick={stop}>
      <Button type="button" variant="outline" size="sm" className={btnClass} onClick={onOpenImage} data-testid="button-open-ebay-image">
        <ImageIcon className="w-3 h-3 flex-shrink-0" />
        画像を開く
      </Button>
      <Button type="button" variant="outline" size="sm" className={btnClass} onClick={onCopy} data-testid="button-copy-ebay-image-url">
        <Copy className="w-3 h-3 flex-shrink-0" />
        URLコピー
      </Button>
      <Button type="button" variant="secondary" size="sm" className={btnClass} onClick={onGoogleByImage} data-testid="button-google-image-search">
        <Search className="w-3 h-3 flex-shrink-0" />
        Google画像検索
      </Button>
    </div>
  );
}
