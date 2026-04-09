/**
 * eBay キーワード検索の補強: タイトル内の型番・モデルコードを抽出し、
 * Finding/Browse に渡す q を「元キーワード + 抜けているトークン」で拡張する。
 */

export function normalizeSearchQuery(q: string): string {
  return q.replace(/\s+/g, " ").trim();
}

/**
 * 英数字の型番っぽいトークン（例: WH-1000XM5, ILCE-7M4, A6500）
 */
export function extractModelTokens(text: string): string[] {
  const raw = text.trim();
  if (!raw) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  // Alphanumeric model patterns (avoid matching pure years like 1999 as sole token when short)
  const re = /[A-Za-z]{2,6}-?\d{2,6}[A-Za-z0-9-]*|\d{3,4}[A-Za-z]{1,3}\d{0,4}[A-Za-z]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const tok = m[0];
    if (tok.length < 4 || tok.length > 28) continue;
    if (/^\d{4}$/.test(tok)) continue;
    const key = tok.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tok);
  }

  return out;
}

export function buildSmartSearchKeywords(userQuery: string): {
  effective: string;
  boostTokens: string[];
} {
  const base = normalizeSearchQuery(userQuery);
  if (!base) return { effective: "", boostTokens: [] };

  const tokens = extractModelTokens(base);
  const lower = base.toLowerCase();
  const boostTokens = tokens.filter((t) => !lower.includes(t.toLowerCase()));

  if (boostTokens.length === 0) {
    return { effective: base, boostTokens: [] };
  }

  const effective = normalizeSearchQuery(`${base} ${boostTokens.join(" ")}`);
  return { effective, boostTokens };
}
