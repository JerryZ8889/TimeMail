export const TOPIC_CONFIG = {
  CATL: {
    key: "CATL" as const,
    displayName: "宁德时代",
    googleNewsQueries: [
      "宁德时代 OR CATL OR Contemporary Amperex",
      "CATL battery OR CATL energy storage",
      "宁德时代 动力电池 OR 储能",
    ],
    gdeltQuery: '(CATL OR "Contemporary Amperex" OR 宁德时代)',
  },
  XIAOMI: {
    key: "XIAOMI" as const,
    displayName: "小米",
    googleNewsQueries: [
      "小米 OR 小米集团 OR Xiaomi",
      "小米 汽车 OR SU7 OR Xiaomi EV",
      "Xiaomi smartphone OR Xiaomi Auto",
    ],
    gdeltQuery: '(Xiaomi OR 小米 OR "Xiaomi Auto" OR SU7)',
  },
} as const;

export type TopicKey = keyof typeof TOPIC_CONFIG;
export const TOPIC_KEYS = Object.keys(TOPIC_CONFIG) as TopicKey[];
export const DEFAULT_TOPIC: TopicKey = "CATL";

export function topicDisplayName(key: string): string {
  const cfg = TOPIC_CONFIG[key as TopicKey];
  return cfg?.displayName ?? key;
}

export function isValidTopic(v: string): v is TopicKey {
  return v in TOPIC_CONFIG;
}

export function safeTopic(v: unknown): TopicKey {
  const s = typeof v === "string" ? v.toUpperCase() : "";
  return isValidTopic(s) ? s : DEFAULT_TOPIC;
}

export function getTopicQueries(topic: TopicKey): string[] {
  return [...TOPIC_CONFIG[topic].googleNewsQueries];
}

export function getGdeltQuery(topic: TopicKey): string {
  return TOPIC_CONFIG[topic].gdeltQuery;
}

export function emptyTopicRecord<T>(): Record<TopicKey, T[]> {
  const rec = {} as Record<TopicKey, T[]>;
  for (const k of TOPIC_KEYS) rec[k] = [];
  return rec;
}

export function allTopicDisplayNames(): string {
  return TOPIC_KEYS.map((k) => topicDisplayName(k)).join(" / ");
}
