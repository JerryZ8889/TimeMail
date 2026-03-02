import { getOptionalEnv } from "../lib/env";
import type { NewsItemRow } from "../lib/types";
import type { TopicKey } from "../config/topics";
import { isValidTopic, TOPIC_KEYS, allTopicDisplayNames } from "../config/topics";
import { translateItemsToZh } from "./translate";

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type ZhipuChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export type AiDigest = {
  overall: string;
  majorChanges: Array<{ title: string; topic: TopicKey | "BOTH"; reason: string; urls: string[] }>;
  bullish: Array<{ title: string; topic: TopicKey | "BOTH"; reason: string; urls: string[] }>;
  bearish: Array<{ title: string; topic: TopicKey | "BOTH"; reason: string; urls: string[] }>;
  watch: Array<{ title: string; topic: TopicKey | "BOTH"; reason: string; urls: string[] }>;
};

type Provider = "zhipu" | "openai";

function hasEnglish(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

function pickZh(original: string, translated: string | null): string {
  const t = (translated ?? "").trim();
  if (!t) return original;
  return t;
}

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("AI digest returned non-JSON output");
  }
  const slice = text.slice(start, end + 1);
  return JSON.parse(slice);
}

function extractJsonArray(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("AI returned non-JSON output");
  }
  const slice = text.slice(start, end + 1);
  return JSON.parse(slice);
}

function pickProvider(): Provider | null {
  const forced = (getOptionalEnv("AI_PROVIDER") ?? "").toLowerCase();
  const hasZhipu = Boolean(getOptionalEnv("ZHIPU_API_KEY") ?? getOptionalEnv("GLM"));
  const hasOpenAi = Boolean(getOptionalEnv("OPENAI_API_KEY"));
  if (forced === "zhipu") return hasZhipu ? "zhipu" : null;
  if (forced === "openai") return hasOpenAi ? "openai" : null;
  if (hasZhipu) return "zhipu";
  if (hasOpenAi) return "openai";
  return null;
}

function normalizeTopic(v: unknown): TopicKey | "BOTH" {
  if (typeof v === "string" && isValidTopic(v)) return v;
  if (v === "BOTH") return "BOTH";
  return "BOTH";
}

function normalizeItem(v: unknown): { title: string; topic: TopicKey | "BOTH"; reason: string; urls: string[] } | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
  const urlsRaw = obj.urls;
  const urls =
    Array.isArray(urlsRaw)
      ? urlsRaw.filter((u) => typeof u === "string").map((u) => u.trim()).filter(Boolean).slice(0, 3)
      : [];
  if (!title || !reason) return null;
  return { title, topic: normalizeTopic(obj.topic), reason, urls };
}

function normalizeDigest(v: unknown): AiDigest | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  const overall = typeof obj.overall === "string" ? obj.overall.trim() : "";
  const majorChangesRaw = Array.isArray(obj.majorChanges) ? obj.majorChanges : [];
  const bullishRaw = Array.isArray(obj.bullish) ? obj.bullish : [];
  const bearishRaw = Array.isArray(obj.bearish) ? obj.bearish : [];
  const watchRaw = Array.isArray(obj.watch) ? obj.watch : [];

  const majorChanges = majorChangesRaw.map(normalizeItem).filter(Boolean).slice(0, 5) as AiDigest["majorChanges"];
  const bullish = bullishRaw.map(normalizeItem).filter(Boolean).slice(0, 6) as AiDigest["bullish"];
  const bearish = bearishRaw.map(normalizeItem).filter(Boolean).slice(0, 6) as AiDigest["bearish"];
  const watch = watchRaw.map(normalizeItem).filter(Boolean).slice(0, 5) as AiDigest["watch"];

  if (!overall) return null;
  return { overall, majorChanges, bullish, bearish, watch };
}

async function translateDigestToZh(digest: AiDigest): Promise<AiDigest> {
  const needOverall = hasEnglish(digest.overall);
  const listNames = ["majorChanges", "bullish", "bearish", "watch"] as const;
  const refs: Array<{ list: (typeof listNames)[number]; idx: number; field: "title" | "reason" }> = [];
  const textItems: Array<{ title: string; summary: string | null }> = [];

  for (const list of listNames) {
    digest[list].forEach((it, idx) => {
      if (hasEnglish(it.title)) {
        refs.push({ list, idx, field: "title" });
        textItems.push({ title: it.title, summary: null });
      }
      if (hasEnglish(it.reason)) {
        refs.push({ list, idx, field: "reason" });
        textItems.push({ title: it.reason, summary: null });
      }
    });
  }

  if (!needOverall && textItems.length === 0) return digest;

  try {
    const payload: Array<{ title: string; summary: string | null }> = [];
    if (needOverall) {
      payload.push({ title: digest.overall, summary: null });
    }
    payload.push(...textItems);
    const translated = await translateItemsToZh(payload);

    let ptr = 0;
    let overall = digest.overall;
    if (needOverall) {
      overall = pickZh(digest.overall, translated[ptr]?.titleZh ?? null);
      ptr += 1;
    }

    const next: AiDigest = {
      overall,
      majorChanges: digest.majorChanges.map((it) => ({ ...it })),
      bullish: digest.bullish.map((it) => ({ ...it })),
      bearish: digest.bearish.map((it) => ({ ...it })),
      watch: digest.watch.map((it) => ({ ...it })),
    };

    refs.forEach((ref, i) => {
      const row = next[ref.list][ref.idx];
      if (!row) return;
      const tr = translated[ptr + i]?.titleZh ?? null;
      if (ref.field === "title") {
        row.title = pickZh(row.title, tr);
      } else {
        row.reason = pickZh(row.reason, tr);
      }
    });

    return next;
  } catch {
    return digest;
  }
}

export type AiDigestCandidate = Pick<
  NewsItemRow,
  "topic" | "title" | "title_zh" | "summary" | "summary_zh" | "source" | "published_at" | "url"
>;

function buildInput(items: Array<Pick<NewsItemRow, "topic" | "title" | "title_zh" | "summary" | "summary_zh" | "source" | "published_at" | "url">>) {
  return items.map((it, i) => ({
    i,
    topic: it.topic,
    title: (it.title_zh ?? "").trim() || it.title,
    summary: (it.summary_zh ?? "").trim() || (it.summary ?? "").trim() || null,
    source: it.source,
    published_at: it.published_at,
    url: it.url,
  }));
}

type PickInputItem = {
  i: number;
  topic: TopicKey;
  title: string;
  source: string;
  published_at: string;
  url: string;
};

function buildPickInput(items: AiDigestCandidate[]): PickInputItem[] {
  return items.map((it, i) => ({
    i,
    topic: it.topic,
    title: (it.title_zh ?? "").trim() || it.title,
    source: it.source,
    published_at: it.published_at,
    url: it.url,
  }));
}

async function callOpenAiPick(payload: { items: PickInputItem[] }): Promise<number[]> {
  const apiKey = getOptionalEnv("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OpenAI API key missing");

  const model =
    getOptionalEnv("OPENAI_PICK_MODEL") ??
    getOptionalEnv("OPENAI_DIGEST_MODEL") ??
    getOptionalEnv("OPENAI_TRANSLATE_MODEL") ??
    "gpt-4o-mini";
  const body = {
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "你是新闻编辑。输入是一组候选新闻（包含 i、标题、来源、时间、URL）。请选出最重要的最多 30 条，优先保留对公司影响大、可信来源、重大事件（财报/监管/事故/召回/订单/量产/诉讼/合作/政策/裁员/融资/产品发布等）。输出必须是严格 JSON 数组，仅包含整数 i，按重要性降序排列，不要输出任何其他文字。",
      },
      { role: "user", content: JSON.stringify(payload) },
    ],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`OpenAI pick HTTP ${res.status}`);
  const json = (await res.json()) as OpenAIChatResponse;
  const content = json.choices?.[0]?.message?.content ?? "";
  const parsed = extractJsonArray(content) as unknown[];
  return parsed.filter((n) => typeof n === "number" && Number.isFinite(n)) as number[];
}

async function callZhipuPick(payload: { items: PickInputItem[] }): Promise<number[]> {
  const apiKey = getOptionalEnv("ZHIPU_API_KEY") ?? getOptionalEnv("GLM");
  if (!apiKey) throw new Error("Zhipu API key missing");

  const model =
    getOptionalEnv("ZHIPU_PICK_MODEL") ??
    getOptionalEnv("ZHIPU_DIGEST_MODEL") ??
    getOptionalEnv("ZHIPU_MODEL") ??
    getOptionalEnv("GLM_MODEL") ??
    "glm-4.6v";
  const body = {
    model,
    temperature: 0.2,
    stream: false,
    messages: [
      {
        role: "system",
        content:
          "你是新闻编辑。输入是一组候选新闻（包含 i、标题、来源、时间、URL）。请选出最重要的最多 30 条，优先保留对公司影响大、可信来源、重大事件（财报/监管/事故/召回/订单/量产/诉讼/合作/政策/裁员/融资/产品发布等）。输出必须是严格 JSON 数组，仅包含整数 i，按重要性降序排列，不要输出任何其他文字。",
      },
      { role: "user", content: JSON.stringify(payload) },
    ],
  };

  const res = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Zhipu pick HTTP ${res.status}`);
  const json = (await res.json()) as ZhipuChatResponse;
  const content = json.choices?.[0]?.message?.content ?? "";
  const parsed = extractJsonArray(content) as unknown[];
  return parsed.filter((n) => typeof n === "number" && Number.isFinite(n)) as number[];
}

export async function pickTopNewsIndices(params: { candidates: AiDigestCandidate[]; maxItems: number }): Promise<number[]> {
  const enabled = (getOptionalEnv("AI_DIGEST") ?? "1") !== "0";
  const provider = pickProvider();
  if (!enabled || !provider) return [];

  const maxItems = Number.isFinite(params.maxItems) ? Math.max(1, Math.min(60, params.maxItems)) : 30;
  const payload = { items: buildPickInput(params.candidates) };
  const picked = provider === "zhipu" ? await callZhipuPick(payload) : await callOpenAiPick(payload);

  const n = params.candidates.length;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const idx of picked) {
    const i = Math.trunc(idx);
    if (i < 0 || i >= n) continue;
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(i);
    if (out.length >= maxItems) break;
  }
  return out;
}

function digestSystemPrompt(): string {
  const names = allTopicDisplayNames();
  const keys = TOPIC_KEYS.join("/");
  return `你是新闻解读助手。根据输入新闻，输出简体中文摘要，帮助判断对"${names}"的潜在影响。只根据新闻内容推断，不要编造。输出必须是严格 JSON 对象：{overall:string, majorChanges:[{title,topic,reason,urls}], bullish:[...], bearish:[...], watch:[...]}. topic 只能是 ${keys}/BOTH。每个 reason 一句话，最多 40 字。每项 urls 最多 3 个。`;
}

async function callOpenAiDigest(payload: { items: ReturnType<typeof buildInput> }): Promise<AiDigest> {
  const apiKey = getOptionalEnv("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OpenAI API key missing");

  const model = getOptionalEnv("OPENAI_DIGEST_MODEL") ?? getOptionalEnv("OPENAI_TRANSLATE_MODEL") ?? "gpt-4o-mini";
  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: digestSystemPrompt() },
      { role: "user", content: JSON.stringify(payload) },
    ],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`OpenAI digest HTTP ${res.status}`);
  const json = (await res.json()) as OpenAIChatResponse;
  const content = json.choices?.[0]?.message?.content ?? "";
  const parsed = extractJsonObject(content);
  const digest = normalizeDigest(parsed);
  if (!digest) throw new Error("OpenAI digest parse failed");
  return digest;
}

async function callZhipuDigest(payload: { items: ReturnType<typeof buildInput> }): Promise<AiDigest> {
  const apiKey = getOptionalEnv("ZHIPU_API_KEY") ?? getOptionalEnv("GLM");
  if (!apiKey) throw new Error("Zhipu API key missing");

  const model = getOptionalEnv("ZHIPU_DIGEST_MODEL") ?? getOptionalEnv("ZHIPU_MODEL") ?? getOptionalEnv("GLM_MODEL") ?? "glm-4.6v";
  const body = {
    model,
    temperature: 0.2,
    stream: false,
    messages: [
      { role: "system", content: digestSystemPrompt() },
      { role: "user", content: JSON.stringify(payload) },
    ],
  };

  const res = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Zhipu digest HTTP ${res.status}`);
  const json = (await res.json()) as ZhipuChatResponse;
  const content = json.choices?.[0]?.message?.content ?? "";
  const parsed = extractJsonObject(content);
  const digest = normalizeDigest(parsed);
  if (!digest) throw new Error("Zhipu digest parse failed");
  return digest;
}

const cache = new Map<string, { at: number; value: AiDigest }>();

export async function buildAiDigest(params: {
  items: Array<Pick<NewsItemRow, "topic" | "title" | "title_zh" | "summary" | "summary_zh" | "source" | "published_at" | "url">>;
  topic: TopicKey;
  q: string;
  days: string;
}): Promise<AiDigest | null> {
  const enabled = (getOptionalEnv("AI_DIGEST") ?? "1") !== "0";
  const provider = pickProvider();
  if (!enabled || !provider) return null;

  const maxItems = Number.parseInt(getOptionalEnv("AI_DIGEST_MAX_ITEMS") ?? "30", 10);
  const slice = params.items.slice(0, Number.isFinite(maxItems) ? Math.max(5, Math.min(60, maxItems)) : 30);

  const key = JSON.stringify({
    topic: params.topic,
    q: params.q,
    days: params.days,
    ids: slice.map((it) => `${it.topic}:${it.published_at}:${it.url}`).slice(0, 40),
    provider,
  });
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.at < 10 * 60 * 1000) return cached.value;

  const payload = { items: buildInput(slice) };
  const digestRaw = provider === "zhipu" ? await callZhipuDigest(payload) : await callOpenAiDigest(payload);
  const digest = await translateDigestToZh(digestRaw);
  cache.set(key, { at: now, value: digest });
  return digest;
}
