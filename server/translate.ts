// Free translation using MyMemory API (no API key required)
// Preserves model numbers and technical tokens during translation

const MODEL_NUMBER_REGEX = /\b([A-Z]{2,6}[-\/]?[A-Z0-9]{2,15}(?:[-\/][A-Z0-9]+)*)\b/g;

function extractPlaceholders(text: string): { template: string; tokens: string[] } {
  const tokens: string[] = [];
  let idx = 0;
  const template = text.replace(MODEL_NUMBER_REGEX, (match) => {
    if (/\d/.test(match)) {
      tokens.push(match);
      return `KPMDL${idx++}KP`;
    }
    return match;
  });
  return { template, tokens };
}

function restorePlaceholders(text: string, tokens: string[]): string {
  // Allow optional spaces that some translation APIs insert around tokens
  return text.replace(/KP\s*MDL\s*(\d+)\s*KP/g, (_, i) => tokens[parseInt(i)] ?? `KPMDL${i}KP`);
}

/** ひらがな・カタカナ・漢字の占める割合（仕入れ検索向けに英語タイトル判定） */
function japaneseCharRatio(s: string): number {
  if (!s || s.length === 0) return 0;
  const m = s.match(/[\u3040-\u30ff\u4e00-\u9fff]/g);
  return (m ? m.length : 0) / s.length;
}

/** MyMemory が落ちた・英語のまま返るときのフォールバック */
async function translateWithLibreTranslate(q: string): Promise<string | null> {
  const body = { q: q.slice(0, 450), source: "auto", target: "ja", format: "text" };
  const urls = ["https://libretranslate.com/translate", "https://translate.argosopentech.com/translate"];
  for (const endpoint of urls) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(14_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { translatedText?: string };
      const t = (data.translatedText || "").trim();
      if (t.length >= 2) return t;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** 最後の手段（無料・非公式クライアント互換エンドポイント） */
async function translateWithGoogleGtx(q: string): Promise<string | null> {
  try {
    const url =
      "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ja&dt=t&q=" +
      encodeURIComponent(q.slice(0, 500));
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    const first = Array.isArray(json) ? (json[0] as unknown) : null;
    if (!Array.isArray(first) || first.length === 0) return null;
    const seg = first[0] as unknown;
    const line = Array.isArray(seg) ? seg[0] : null;
    const out = typeof line === "string" ? line.trim() : null;
    return out && out.length >= 2 ? out : null;
  } catch {
    return null;
  }
}

export async function translateToJapanese(text: string): Promise<{ text: string; translated: boolean }> {
  if (!text || text.trim().length === 0) return { text, translated: false };

  const raw = text.trim();
  const inJp = japaneseCharRatio(raw);
  if (inJp > 0.25) {
    return { text: raw, translated: false };
  }

  const { template, tokens } = extractPlaceholders(raw);

  const cleanTemplate = template.replace(/XX\d+XX/g, "").trim();
  if (!cleanTemplate || cleanTemplate.length < 3) {
    return { text: raw, translated: false };
  }

  let best = raw;
  let bestJp = inJp;

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanTemplate.slice(0, 450))}&langpair=en|ja`;
    const res = await fetch(url, { signal: AbortSignal.timeout(14_000) });
    if (!res.ok) throw new Error(`Translation API error: ${res.status}`);
    const data = await res.json();

    if (data.responseStatus !== 200) {
      throw new Error(data.responseDetails || "Translation failed");
    }

    const translatedText: string = data.responseData?.translatedText || cleanTemplate;
    const restored = restorePlaceholders(translatedText, tokens);
    const rj = japaneseCharRatio(restored);
    if (rj > bestJp) {
      best = restored;
      bestJp = rj;
    }
  } catch (err) {
    console.error("[translate] MyMemory error:", err);
  }

  // まだ日本語が少ない（MyMemory が英語のまま・429 等）→ LibreTranslate → gtx
  if (bestJp < 0.12 && inJp < 0.12) {
    const lt = await translateWithLibreTranslate(cleanTemplate);
    if (lt) {
      const restoredLt = restorePlaceholders(lt, tokens);
      const lj = japaneseCharRatio(restoredLt);
      if (lj > bestJp) {
        best = restoredLt;
        bestJp = lj;
      }
    }
  }
  if (bestJp < 0.1 && inJp < 0.12) {
    const gt = await translateWithGoogleGtx(cleanTemplate);
    if (gt) {
      const restoredG = restorePlaceholders(gt, tokens);
      const gj = japaneseCharRatio(restoredG);
      if (gj > bestJp) {
        best = restoredG;
        bestJp = gj;
      }
    }
  }

  const translated = bestJp >= 0.1 || bestJp > inJp + 0.04;
  return { text: best, translated };
}
