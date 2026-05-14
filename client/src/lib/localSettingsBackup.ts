/** Render 等でサーバー側の設定が空に戻ったとき、ブラウザに残した内容を PUT で書き戻すためのバックアップ */
const KEY = "sedori-settings-backup-v1";

export type LocalSettingsBackup = {
  spreadsheetId?: string | null;
  sheetName?: string | null;
  inventorySheetName?: string | null;
  exchangeRate?: number;
  ebayFeeRate?: number;
  otherFees?: number;
  forwardingDomesticShipping?: number;
  forwardingAgentFee?: number;
  forwardingIntlBase?: number;
  forwardingIntlPerGram?: number;
  ebayUserToken?: string | null;
  ebayDevId?: string | null;
  ebayStoreName?: string | null;
  ebayPaymentPolicy?: string | null;
  ebayReturnPolicy?: string | null;
  ebayShippingPolicy?: string | null;
  ebayDispatchDays?: number;
  ebayLocation?: string | null;
  ebayAppId?: string | null;
  ebayCertId?: string | null;
};

export function readLocalSettingsBackup(): LocalSettingsBackup | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as LocalSettingsBackup;
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

export function writeLocalSettingsBackup(data: LocalSettingsBackup): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, _savedAt: Date.now() }));
  } catch {
    /* quota / private mode */
  }
}

/** サーバー応答からバックアップ（フラグ系は除外） */
export function writeLocalSettingsBackupFromApiResponse(data: {
  spreadsheetId?: string | null;
  sheetName?: string | null;
  inventorySheetName?: string | null;
  exchangeRate?: number | null;
  ebayFeeRate?: number | null;
  otherFees?: number | null;
  forwardingDomesticShipping?: number | null;
  forwardingAgentFee?: number | null;
  forwardingIntlBase?: number | null;
  forwardingIntlPerGram?: number | null;
  ebayUserToken?: string | null;
  ebayDevId?: string | null;
  ebayStoreName?: string | null;
  ebayPaymentPolicy?: string | null;
  ebayReturnPolicy?: string | null;
  ebayShippingPolicy?: string | null;
  ebayDispatchDays?: number | null;
  ebayLocation?: string | null;
  ebayAppId?: string | null;
  ebayCertId?: string | null;
}): void {
  writeLocalSettingsBackup({
    spreadsheetId: data.spreadsheetId ?? null,
    sheetName: data.sheetName ?? null,
    inventorySheetName: data.inventorySheetName ?? null,
    exchangeRate: data.exchangeRate ?? undefined,
    ebayFeeRate: data.ebayFeeRate ?? undefined,
    otherFees: data.otherFees ?? undefined,
    forwardingDomesticShipping: data.forwardingDomesticShipping ?? undefined,
    forwardingAgentFee: data.forwardingAgentFee ?? undefined,
    forwardingIntlBase: data.forwardingIntlBase ?? undefined,
    forwardingIntlPerGram: data.forwardingIntlPerGram ?? undefined,
    ebayUserToken: data.ebayUserToken ?? null,
    ebayDevId: data.ebayDevId ?? null,
    ebayStoreName: data.ebayStoreName ?? null,
    ebayPaymentPolicy: data.ebayPaymentPolicy ?? null,
    ebayReturnPolicy: data.ebayReturnPolicy ?? null,
    ebayShippingPolicy: data.ebayShippingPolicy ?? null,
    ebayDispatchDays: data.ebayDispatchDays ?? undefined,
    ebayLocation: data.ebayLocation ?? null,
    ebayAppId: data.ebayAppId ?? null,
    ebayCertId: data.ebayCertId ?? null,
  });
}

export function buildSettingsRestorePutBody(b: LocalSettingsBackup): Record<string, unknown> {
  return {
    spreadsheetId: b.spreadsheetId ?? "",
    sheetName: b.sheetName || "セドリリスト",
    inventorySheetName: b.inventorySheetName || "Mercari-eBay 在庫管理",
    exchangeRate: typeof b.exchangeRate === "number" ? b.exchangeRate : 150,
    ebayFeeRate: typeof b.ebayFeeRate === "number" ? b.ebayFeeRate : 13.25,
    otherFees: typeof b.otherFees === "number" ? b.otherFees : 500,
    forwardingDomesticShipping: typeof b.forwardingDomesticShipping === "number" ? b.forwardingDomesticShipping : 800,
    forwardingAgentFee: typeof b.forwardingAgentFee === "number" ? b.forwardingAgentFee : 500,
    forwardingIntlBase: typeof b.forwardingIntlBase === "number" ? b.forwardingIntlBase : 2000,
    forwardingIntlPerGram: typeof b.forwardingIntlPerGram === "number" ? b.forwardingIntlPerGram : 3,
    ebayUserToken: b.ebayUserToken ?? null,
    ebayDevId: b.ebayDevId ?? null,
    ebayStoreName: b.ebayStoreName ?? null,
    ebayPaymentPolicy: b.ebayPaymentPolicy ?? null,
    ebayReturnPolicy: b.ebayReturnPolicy ?? null,
    ebayShippingPolicy: b.ebayShippingPolicy ?? null,
    ebayDispatchDays: typeof b.ebayDispatchDays === "number" ? b.ebayDispatchDays : 3,
    ebayLocation: b.ebayLocation || "Japan",
    ebayAppId: b.ebayAppId?.trim() || null,
    ebayCertId: b.ebayCertId?.trim() || null,
  };
}
