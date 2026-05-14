import type { InsertSavedProduct, SavedProduct } from "@shared/schema";

const KEY = "sedori-products-backup-v1";
const MAX_ITEMS = 100;

type Stored = { version: 1; savedAt: number; items: SavedProduct[] };

export function readLocalProductsBackup(): SavedProduct[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Stored;
    if (!o || o.version !== 1 || !Array.isArray(o.items)) return null;
    return o.items;
  } catch {
    return null;
  }
}

/** ブラウザ内の保存リストバックアップを削除（復元ボタンを消したいとき） */
export function clearLocalProductsBackup(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function writeLocalProductsBackup(products: SavedProduct[]): void {
  try {
    const items = products.length > MAX_ITEMS ? products.slice(0, MAX_ITEMS) : [...products];
    const payload: Stored = { version: 1, savedAt: Date.now(), items };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    try {
      const smaller = products.slice(0, Math.min(30, products.length));
      localStorage.setItem(KEY, JSON.stringify({ version: 1, savedAt: Date.now(), items: smaller } satisfies Stored));
    } catch {
      /* quota */
    }
  }
}

/** restore-batch 用: id / createdAt を除き、シート行はリセット */
export function savedProductsToInsertItems(products: SavedProduct[]): InsertSavedProduct[] {
  return products.map((p) => {
    const {
      id: _id,
      createdAt: _c,
      syncedToSheets: _s,
      sheetRowIndex: _sr,
      ...rest
    } = p;
    return {
      ...rest,
      syncedToSheets: false,
      sheetRowIndex: null,
    } as InsertSavedProduct;
  });
}
