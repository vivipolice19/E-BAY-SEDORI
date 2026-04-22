/** eBay leaf カテゴリの数値ID。パス文字列の末尾の ID を抽出 */
export function normalizeEbayCategoryId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return s;
  const tail = s.match(/(\d{5,})\s*$/);
  if (tail) return tail[1];
  const nums = s.match(/\d{5,}/g);
  if (nums?.length) return nums[nums.length - 1];
  return null;
}
