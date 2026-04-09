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

export async function translateToJapanese(text: string): Promise<{ text: string; translated: boolean }> {
  if (!text || text.trim().length === 0) return { text, translated: false };

  const jpChars = (text.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) || []).length;
  if (jpChars / text.length > 0.25) {
    return { text, translated: false };
  }

  const { template, tokens } = extractPlaceholders(text);

  const cleanTemplate = template.replace(/XX\d+XX/g, "").trim();
  if (!cleanTemplate || cleanTemplate.length < 3) {
    return { text, translated: false };
  }

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(template)}&langpair=en|ja`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) throw new Error(`Translation API error: ${res.status}`);
    const data = await res.json();

    if (data.responseStatus !== 200) {
      throw new Error(data.responseDetails || "Translation failed");
    }

    const translatedText: string = data.responseData?.translatedText || template;
    const restored = restorePlaceholders(translatedText, tokens);
    return { text: restored, translated: true };
  } catch (err) {
    console.error("[translate] Error:", err);
    return { text, translated: false };
  }
}
