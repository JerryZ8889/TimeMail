import { getOptionalEnv } from "../lib/env";

export type TranslatableItem = {
  title: string;
  summary: string | null;
};

export type TranslationResult = {
  titleZh: string | null;
  summaryZh: string | null;
};

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

function extractJsonArray(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Translator returned non-JSON output");
  }
  const slice = text.slice(start, end + 1);
  return JSON.parse(slice);
}

async function callOpenAITranslate(payload: {
  items: Array<{ i: number; title: string; summary: string | null }>;
}): Promise<TranslationResult[]> {
  const apiKey = getOptionalEnv("OPENAI_API_KEY");
  if (!apiKey) return payload.items.map(() => ({ titleZh: null, summaryZh: null }));

  const model = getOptionalEnv("OPENAI_TRANSLATE_MODEL") ?? "gpt-4o-mini";
  const body = {
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "你是翻译引擎。把输入的标题与摘要翻译成简体中文。保持专有名词、公司名、产品名、股票代码、计量单位与数字不变；不要添加解释。输出必须是严格的 JSON 数组，每个元素为 {i:number, title_zh:string|null, summary_zh:string|null}，顺序与输入一致。",
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

  if (!res.ok) {
    throw new Error(`OpenAI translate HTTP ${res.status}`);
  }

  const json = (await res.json()) as OpenAIChatResponse;
  const content = json.choices?.[0]?.message?.content ?? "";
  const parsed = extractJsonArray(content) as Array<{ i: number; title_zh?: string | null; summary_zh?: string | null }>;

  const map = new Map<number, TranslationResult>();
  for (const row of parsed) {
    if (typeof row?.i !== "number") continue;
    map.set(row.i, {
      titleZh: typeof row.title_zh === "string" ? row.title_zh.trim() : null,
      summaryZh: typeof row.summary_zh === "string" ? row.summary_zh.trim() : null,
    });
  }

  return payload.items.map((it) => map.get(it.i) ?? { titleZh: null, summaryZh: null });
}

async function callZhipuTranslate(payload: {
  items: Array<{ i: number; title: string; summary: string | null }>;
}): Promise<TranslationResult[]> {
  const apiKey = getOptionalEnv("ZHIPU_API_KEY") ?? getOptionalEnv("GLM");
  if (!apiKey) return payload.items.map(() => ({ titleZh: null, summaryZh: null }));

  const model = getOptionalEnv("ZHIPU_MODEL") ?? getOptionalEnv("GLM_MODEL") ?? "glm-4.6v";
  const body = {
    model,
    temperature: 0.2,
    stream: false,
    messages: [
      {
        role: "system",
        content:
          "你是翻译引擎。把输入的标题与摘要翻译成简体中文。保持专有名词、公司名、产品名、股票代码、计量单位与数字不变；不要添加解释。输出必须是严格的 JSON 数组，每个元素为 {i:number, title_zh:string|null, summary_zh:string|null}，顺序与输入一致。",
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

  if (!res.ok) {
    throw new Error(`Zhipu translate HTTP ${res.status}`);
  }

  const json = (await res.json()) as ZhipuChatResponse;
  const content = json.choices?.[0]?.message?.content ?? "";
  const parsed = extractJsonArray(content) as Array<{ i: number; title_zh?: string | null; summary_zh?: string | null }>;

  const map = new Map<number, TranslationResult>();
  for (const row of parsed) {
    if (typeof row?.i !== "number") continue;
    map.set(row.i, {
      titleZh: typeof row.title_zh === "string" ? row.title_zh.trim() : null,
      summaryZh: typeof row.summary_zh === "string" ? row.summary_zh.trim() : null,
    });
  }

  return payload.items.map((it) => map.get(it.i) ?? { titleZh: null, summaryZh: null });
}

type TranslationProvider = "zhipu" | "openai";

function pickProvider(): TranslationProvider | null {
  const forced = (getOptionalEnv("TRANSLATION_PROVIDER") ?? "").toLowerCase();
  if (forced === "zhipu") return (getOptionalEnv("ZHIPU_API_KEY") ?? getOptionalEnv("GLM")) ? "zhipu" : null;
  if (forced === "openai") return getOptionalEnv("OPENAI_API_KEY") ? "openai" : null;

  if (getOptionalEnv("ZHIPU_API_KEY") ?? getOptionalEnv("GLM")) return "zhipu";
  if (getOptionalEnv("OPENAI_API_KEY")) return "openai";
  return null;
}

export async function translateItemsToZh(items: TranslatableItem[]): Promise<TranslationResult[]> {
  const enabled = (getOptionalEnv("TRANSLATE_TO_ZH") ?? "1") !== "0";
  const provider = pickProvider();
  if (!enabled || !provider) return items.map(() => ({ titleZh: null, summaryZh: null }));

  const results: TranslationResult[] = [];
  const batchSize = 10;
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batch = items.slice(offset, offset + batchSize);
    const payload = { items: batch.map((it, idx) => ({ i: idx, title: it.title, summary: it.summary })) };
    const translated =
      provider === "zhipu" ? await callZhipuTranslate(payload) : await callOpenAITranslate(payload);
    results.push(...translated);
  }

  return results;
}
