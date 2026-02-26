import { DateTime } from "luxon";
import type { Topic } from "../lib/types";
import { canonicalizeUrl, normalizeTitle, sha256 } from "../lib/hash";

export type GdeltFetchedItem = {
  topic: Topic;
  title: string;
  summary: string | null;
  url: string;
  source: string;
  publishedAt: Date;
  contentHash: string;
  language: string;
};

function detectLanguage(text: string): string {
  if (/[\u3400-\u9FFF]/.test(text)) return "zh";
  if (/[A-Za-z]/.test(text)) return "en";
  return "und";
}

function normalizeSummary(v: string | undefined): string | null {
  const s = (v ?? "").replaceAll(/\s+/g, " ").trim();
  return s.length ? s : null;
}

function toGdeltDatetime(dt: DateTime): string {
  return dt.toUTC().toFormat("yyyyLLddHHmmss");
}

type GdeltArticle = {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  sourceCountry?: string;
  language?: string;
  snippet?: string;
};

type GdeltResponse = {
  articles?: GdeltArticle[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonOnce(url: string, timeoutMs: number): Promise<{ ok: true; data: unknown } | { ok: false; status: number }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "user-agent": "daily-news-bot" } });
    if (res.status === 429) return { ok: false, status: 429 };
    if (!res.ok) throw new Error(`GDELT HTTP ${res.status}`);
    return { ok: true, data: await res.json() };
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await fetchJsonOnce(url, timeoutMs);
    if (result.ok) return result.data;
    if (result.status === 429 && attempt < maxRetries - 1) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    throw new Error(`GDELT HTTP ${result.status}`);
  }
  throw new Error("GDELT fetch failed");
}

export async function fetchGdeltDocs(params: {
  topic: Topic;
  query: string;
  windowStartIso: string;
  windowEndIso: string;
  maxRecords?: number;
}): Promise<GdeltFetchedItem[]> {
  const start = DateTime.fromISO(params.windowStartIso, { zone: "utc" });
  const end = DateTime.fromISO(params.windowEndIso, { zone: "utc" });
  if (!start.isValid || !end.isValid) return [];

  const max = Math.min(Math.max(params.maxRecords ?? 50, 1), 250);
  const q = encodeURIComponent(params.query);
  const startDt = encodeURIComponent(toGdeltDatetime(start));
  const endDt = encodeURIComponent(toGdeltDatetime(end));

  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&format=json&sort=HybridRel&maxrecords=${max}&startdatetime=${startDt}&enddatetime=${endDt}`;

  const raw = await fetchJson(url, 15000);
  const parsed = raw as GdeltResponse;
  const out: GdeltFetchedItem[] = [];

  for (const a of parsed.articles ?? []) {
    const title = normalizeTitle(a.title ?? "");
    const url = canonicalizeUrl(a.url ?? "");
    if (!title || !url) continue;

    const publishedAt = a.seendate ? new Date(a.seendate) : null;
    if (!publishedAt || Number.isNaN(publishedAt.getTime())) continue;

    const summary = normalizeSummary(a.snippet);
    const language = a.language ? a.language : detectLanguage(`${title} ${summary ?? ""}`);
    const source = a.domain ? a.domain : a.sourceCountry ? `GDELT/${a.sourceCountry}` : "GDELT";
    const contentHash = sha256(`${params.topic}|${url}`);

    out.push({
      topic: params.topic,
      title,
      summary,
      url,
      source,
      publishedAt,
      contentHash,
      language,
    });
  }

  return out;
}
