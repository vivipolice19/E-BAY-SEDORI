import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";

const DISMISS_KEY = "sedori-dismiss-persistence-warn";

export type PersistenceInfo = {
  mode: "postgres" | "file" | "memory";
  recommendPostgres: boolean;
  dbTablesReady: boolean | null;
  needsSchemaPush: boolean;
  message: string;
  docsHint: string | null;
};

export function PersistenceBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  const { data } = useQuery<PersistenceInfo>({
    queryKey: ["/api/persistence"],
  });

  const show = !!(data?.recommendPostgres || data?.needsSchemaPush);

  useEffect(() => {
    if (show) {
      try {
        sessionStorage.removeItem(DISMISS_KEY);
      } catch {
        /* ignore */
      }
      setDismissed(false);
    }
  }, [show]);

  if (!show || dismissed || !data) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const title = data.needsSchemaPush
    ? "PostgreSQL にテーブルがありません（db:push が必要）"
    : "データの保存先が不安定です（PostgreSQL 未接続）";

  return (
    <div
      className="flex-shrink-0 border-b border-amber-400/60 bg-amber-50 px-3 py-2 text-amber-950 dark:border-amber-600/50 dark:bg-amber-950/80 dark:text-amber-50"
      role="status"
    >
      <div className="mx-auto flex max-w-5xl items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="min-w-0 flex-1 text-xs leading-relaxed">
          <p className="font-semibold">{title}</p>
          <p className="mt-1 opacity-95">{data.message}</p>
          {data.docsHint && <p className="mt-1 opacity-95">{data.docsHint}</p>}
          {data.needsSchemaPush ? (
            <p className="mt-1">
              <strong className="font-medium">A.</strong> Render の Web サービス →{" "}
              <strong className="font-medium">Settings → Build Command</strong> を次に変更して{" "}
              <strong className="font-medium">Save → Manual Deploy</strong>：
              <code className="mx-1 rounded bg-black/10 px-1 dark:bg-white/10">
                {`npm install && npm run build:render`}
              </code>
              <br />
              <strong className="font-medium">B.</strong> 自分の PC で、Postgres の{" "}
              <strong className="font-medium">External Database URL</strong> を環境変数{" "}
              <code className="rounded bg-black/10 px-1 dark:bg-white/10">DATABASE_URL</code> にしてから{" "}
              <code className="rounded bg-black/10 px-1 dark:bg-white/10">npm run db:push:ci</code> を実行。
            </p>
          ) : (
            <p className="mt-1">
              ホストに{" "}
              <code className="rounded bg-black/10 px-1 dark:bg-white/10">DATABASE_URL</code> を追加したうえで、
              上記 A または B でテーブルを作成し、
              <Link href="/settings" className="font-medium underline underline-offset-2">
                設定画面
              </Link>
              でスプレッドシートIDを保存してください。
            </p>
          )}
          {data.needsSchemaPush && (
            <p className="mt-1">
              テーブル作成後、
              <Link href="/settings" className="font-medium underline underline-offset-2">
                設定画面
              </Link>
              でスプレッドシートIDを保存してください。
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0 text-amber-900 hover:bg-amber-200/80 dark:text-amber-100 dark:hover:bg-amber-900/60"
          onClick={dismiss}
          aria-label="今セッションでは非表示"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
