export type Topic = "CATL" | "XIAOMI";

export type JobStateRow = {
  key: string;
  last_success_at: string | null;
  updated_at: string;
};

export type RunLogRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: "SUCCESS" | "FAILED" | "RUNNING";
  window_start: string | null;
  window_end: string | null;
  fetched_count: number;
  deduped_count: number;
  output_count: number;
  email_to: string;
  error_message: string | null;
};

export type NewsItemRow = {
  id: string;
  topic: Topic;
  title: string;
  title_zh: string | null;
  url: string;
  source: string;
  published_at: string;
  content_hash: string;
  language: string;
  summary: string | null;
  summary_zh: string | null;
  created_at: string;
};

export type NewNewsItem = Omit<NewsItemRow, "id" | "created_at">;
