import { TOPIC_CONFIG, TOPIC_KEYS, type TopicKey, topicDisplayName } from "./topics";

export type SourceType = "rss" | "gdelt";

export type SourceDef = {
  index: number;
  type: SourceType;
  topic: TopicKey;
  label: string;
  query: string;
  locale?: "zh-CN" | "en-US";
  maxRecords?: number;
};

const LOCALES = ["zh-CN", "en-US"] as const;

function buildSourceList(): SourceDef[] {
  const sources: SourceDef[] = [];
  let index = 0;

  for (const topic of TOPIC_KEYS) {
    const cfg = TOPIC_CONFIG[topic];
    const name = cfg.displayName;

    for (const query of cfg.googleNewsQueries) {
      for (const locale of LOCALES) {
        const short = query.length > 25 ? `${query.slice(0, 25)}...` : query;
        sources.push({
          index: index++,
          type: "rss",
          topic,
          label: `${name} RSS ${locale} "${short}"`,
          query,
          locale,
        });
      }
    }

    sources.push({
      index: index++,
      type: "gdelt",
      topic,
      label: `${name} GDELT`,
      query: cfg.gdeltQuery,
      maxRecords: 100,
    });
  }

  return sources;
}

export const SOURCE_LIST = buildSourceList();
export const SOURCE_COUNT = SOURCE_LIST.length;

export function sourcesByTopic(): Array<{ topic: TopicKey; displayName: string; sources: SourceDef[] }> {
  return TOPIC_KEYS.map((topic) => ({
    topic,
    displayName: topicDisplayName(topic),
    sources: SOURCE_LIST.filter((s) => s.topic === topic),
  }));
}
