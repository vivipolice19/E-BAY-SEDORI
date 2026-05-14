import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AppSettings, SavedProduct } from "@shared/schema";
import {
  readLocalSettingsBackup,
  buildSettingsRestorePutBody,
  writeLocalSettingsBackupFromApiResponse,
} from "@/lib/localSettingsBackup";
import { writeLocalProductsBackup } from "@/lib/localProductsBackup";

type SettingsResponse = AppSettings & {
  ebayUserTokenConfigured?: boolean;
  ebayDevIdConfigured?: boolean;
};

/**
 * サーバーでスプレッドシート設定などが空に戻ったとき、ブラウザの localStorage から PUT で自動復元する。
 * 保存リストは同ブラウザにバックアップを書き、空のときは Watchlist の「バックアップから復元」で復元可能。
 */
export function ClientPersistenceBootstrap() {
  const { toast } = useToast();
  const didSettingsRestore = useRef(false);

  const { data: settings, isSuccess: settingsOk } = useQuery<SettingsResponse>({
    queryKey: ["/api/settings"],
  });

  const { data: products, isSuccess: productsOk, isFetching: productsFetching } = useQuery<SavedProduct[]>({
    queryKey: ["/api/products"],
  });

  useEffect(() => {
    if (!settingsOk || !settings || didSettingsRestore.current) return;
    const sid = settings.spreadsheetId?.trim() ?? "";
    if (sid) return;
    const backup = readLocalSettingsBackup();
    if (!backup?.spreadsheetId?.trim()) return;
    didSettingsRestore.current = true;
    void (async () => {
      try {
        await apiRequest("PUT", "/api/settings", buildSettingsRestorePutBody(backup));
        await queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
        toast({
          title: "設定を復元しました",
          description: "ブラウザに保存していたスプレッドシート設定をサーバーへ反映しました。",
        });
      } catch (e: unknown) {
        didSettingsRestore.current = false;
        const msg = e instanceof Error ? e.message : String(e);
        toast({ title: "設定の自動復元に失敗", description: msg, variant: "destructive" });
      }
    })();
  }, [settingsOk, settings, toast]);

  useEffect(() => {
    if (!settingsOk || !settings) return;
    const sid = settings.spreadsheetId?.trim() ?? "";
    if (!sid) return;
    writeLocalSettingsBackupFromApiResponse(settings);
  }, [settingsOk, settings]);

  useEffect(() => {
    if (!productsOk || productsFetching) return;
    const list = products ?? [];
    if (list.length > 0) {
      writeLocalProductsBackup(list);
    }
  }, [productsOk, productsFetching, products]);

  return null;
}
