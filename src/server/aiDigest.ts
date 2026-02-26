import { getOptionalEnv } from "../lib/env";
import type { NewsItemRow } from "../lib/types";

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
  majorChanges: Array<{ title: string; topic: "CATL" | "XIAOMI" | "BOTH"; reason: string; urls: string[] }>;
  bullish: Array<{ title: string; topic: "CATL" | "XIAOMI" | "BOTH"; reason: string; urls: string[] }>;
  bearish: Array<{ title: string; topic: "CATL" | "XIAOMI" | "BOTH"; reason: string; urls: string[] }>;
  watch: Array<{ title: string; topic: "CATL" | "XIAOMI" | "BOTH"; reason: string; urls: string[] }>;
};

type Provider = "zhipu" | "openai";

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("AI digest returned non-JSON output");
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

function normalizeTopic(v: unknown): "CATL" | "XIAOMI" | "BOTH" {
  if (v === "CATL" || v === "XIAOMI" || v === "BOTH") return v;
  return "BOTH";
}

function normalizeItem(v: unknown): { title: string; topic: "CATL" | "XIAOMI" | "BOTH"; reason: string; urls: string[] } | null {
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

async function callOpenAiDigest(payload: { items: ReturnType<typeof buildInput> }): Promise<AiDigest> {
  const apiKey = getOptionalEnv("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OpenAI API key missing");

  const model = getOptionalEnv("OPENAI_DIGEST_MODEL") ?? getOptionalEnv("OPENAI_TRANSLATE_MODEL") ?? "gpt-4o-mini";
  const body = {
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "你是新闻解读助手。根据输入新闻，输出简体中文摘要，帮助判断对“宁德时代/小米”的潜在影响。只根据新闻内容推断，不要编造。输出必须是严格 JSON 对象：{overall:string, majorChanges:[{title,topic,reason,urls}], bullish:[...], bearish:[...], watch:[...]}. topic 只能是 CATL/XIAOMI/BOTH。每个 reason 一句话，最多 40 字。每项 urls 最多 3 个。",
      },
      {
        role: "user",
        content: JSON.stringify(payload),
      },
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

  const model = getOptionalEnv("ZHIPU_DIGEST_MODEL") ?? getOptionalEnv("ZHIPU_MODEL") ?? getOptionalEnv("GLM_MODEL") ?? "glm-4.7-flash";
  const body = {
    model,
    temperature: 0.2,
    stream: false,
    messages: [
      {
        role: "system",
        content:
          "你是新闻解读助手。根据输入新闻，输出简体中文摘要，帮助判断对“宁德时代/小米”的潜在影响。只根据新闻内容推断，不要编造。输出必须是严格 JSON 对象：{overall:string, majorChanges:[{title,topic,reason,urls}], bullish:[...], bearish:[...], watch:[...]}. topic 只能是 CATL/XIAOMI/BOTH。每个 reason 一句话，最多 40 字。每项 urls 最多 3 个。",
      },
      {
        role: "user",
        content: JSON.stringify(payload),
      },
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
  topic: "ALL" | "CATL" | "XIAOMI";
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
  const digest = provider === "zhipu" ? await callZhipuDigest(payload) : await callOpenAiDigest(payload);
  cache.set(key, { at: now, value: digest });
  return digest;
}

