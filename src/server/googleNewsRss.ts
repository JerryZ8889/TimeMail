import Parser from "rss-parser";
import type { Topic } from "../lib/types";
import { canonicalizeUrl, normalizeTitle, sha256 } from "../lib/hash";

export type FetchedItem = {
  topic: Topic;
  title: string;
  summary: string | null;
  url: string;
  source: string;
  publishedAt: Date;
  contentHash: string;
  language: string;
};

export type GoogleNewsLocale = {
  hl: string;
  gl: string;
  ceid: string;
};

const GOOGLE_NEWS_ZH_CN: GoogleNewsLocale = {
  hl: "zh-CN",
  gl: "CN",
  ceid: "CN:zh-Hans",
};

const GOOGLE_NEWS_EN_US: GoogleNewsLocale = {
  hl: "en-US",
  gl: "US",
  ceid: "US:en",
};

function buildGoogleNewsRssUrl(query: string, locale: GoogleNewsLocale): string {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=${encodeURIComponent(locale.hl)}&gl=${encodeURIComponent(locale.gl)}&ceid=${encodeURIComponent(locale.ceid)}`;
}

function splitGoogleTitle(raw: string | undefined): { title: string; source: string } {
  const s = (raw ?? "").trim();
  if (!s) return { title: "", source: "" };
  const idx = s.lastIndexOf(" - ");
  if (idx <= 0) return { title: s, source: "Google News" };
  const t = s.slice(0, idx).trim();
  const src = s.slice(idx + 3).trim();
  return { title: t || s, source: src || "Google News" };
}

function detectLanguage(text: string): string {
  if (/[\u3400-\u9FFF]/.test(text)) return "zh";
  if (/[A-Za-z]/.test(text)) return "en";
  return "und";
}

function normalizeSummary(v: string | undefined): string | null {
  const s = (v ?? "").replaceAll(/\s+/g, " ").trim();
  return s.length ? s : null;
}

export async function fetchGoogleNewsRss(topic: Topic, queries: string[]): Promise<FetchedItem[]> {
  return fetchGoogleNewsRssWithLocales(topic, queries, [GOOGLE_NEWS_ZH_CN, GOOGLE_NEWS_EN_US]);
}

export async function fetchGoogleNewsRssWithLocales(
  topic: Topic,
  queries: string[],
  locales: GoogleNewsLocale[],
): Promise<FetchedItem[]> {
  const parser = new Parser({ timeout: 20000 });
  const urls = locales.flatMap((loc) => queries.map((q) => buildGoogleNewsRssUrl(q, loc)));
  const feeds = await Promise.allSettled(urls.map((u) => parser.parseURL(u)));

  const items: FetchedItem[] = [];
  for (const feed of feeds) {
    if (feed.status !== "fulfilled") continue;
    for (const it of feed.value.items ?? []) {
      const { title, source } = splitGoogleTitle(it.title);
      const url = canonicalizeUrl(it.link ?? "");
      const isoDate = (it as unknown as { isoDate?: string }).isoDate;
      const rawDate = isoDate ?? it.pubDate;
      const publishedAt = rawDate ? new Date(rawDate) : null;
      if (!title || !url || !publishedAt || Number.isNaN(publishedAt.getTime())) continue;
      const contentHash = sha256(`${topic}|${url}`);
      const normalizedTitle = normalizeTitle(title);
      const summaryRaw = (it as unknown as { contentSnippet?: string; content?: string }).contentSnippet;
      const summary = normalizeSummary(summaryRaw);
      const language = detectLanguage(`${normalizedTitle} ${summary ?? ""}`);
      items.push({
        topic,
        title: normalizedTitle,
        summary,
        url,
        source,
        publishedAt,
        contentHash,
        language,
      });
    }
  }
  return items;
}
