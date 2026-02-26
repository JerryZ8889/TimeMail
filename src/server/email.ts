import { Resend } from "resend";
import { getOptionalEnv, getRequiredEnv } from "../lib/env";
import type { Topic } from "../lib/types";

export type EmailItem = {
  topic: Topic;
  title: string;
  title_zh?: string | null;
  summary?: string | null;
  summary_zh?: string | null;
  url: string;
  source: string;
  publishedAt: Date;
  language?: string;
};

function topicName(topic: Topic): string {
  if (topic === "CATL") return "宁德时代";
  return "小米";
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildEmailHtml(params: {
  windowStartIso: string;
  windowEndIso: string;
  itemsByTopic: Record<Topic, EmailItem[]>;
  fetchedCount: number;
  dedupedCount: number;
  outputCount: number;
}): string {
  const sections = (Object.keys(params.itemsByTopic) as Topic[]).map((t) => {
    const items = params.itemsByTopic[t];
    const li = items
      .map((it) => {
        const dt = new Date(it.publishedAt).toLocaleString("zh-CN", { hour12: false });
        const title = (it.title_zh ?? "").trim() || it.title;
        const titleHasTranslation = Boolean(it.title_zh && it.title_zh.trim() && it.title_zh.trim() !== it.title.trim());
        const summary = (it.summary_zh ?? "").trim() || (it.summary ?? "").trim();
        const summaryHasTranslation = Boolean(it.summary_zh && it.summary_zh.trim() && it.summary_zh.trim() !== (it.summary ?? "").trim());
        return `<li style="margin:0 0 10px 0;">
  <div style="font-weight:600;line-height:1.4;">${escapeHtml(title)}</div>
  ${titleHasTranslation ? `<div style="color:#9ca3af;font-size:12px;line-height:1.4;">${escapeHtml(it.title)}</div>` : ""}
  <div style="color:#6b7280;font-size:12px;line-height:1.4;">${escapeHtml(it.source)} · ${escapeHtml(dt)}</div>
  ${summary ? `<div style="margin-top:6px;color:#374151;font-size:12px;line-height:1.5;">${escapeHtml(summary)}</div>` : ""}
  ${summaryHasTranslation ? `<div style="margin-top:4px;color:#9ca3af;font-size:12px;line-height:1.5;">${escapeHtml(it.summary ?? "")}</div>` : ""}
  <div style="margin-top:4px;"><a href="${escapeHtml(it.url)}" target="_blank" rel="noreferrer" style="color:#2563eb;text-decoration:none;">打开链接</a></div>
</li>`;
      })
      .join("");
    return `<h2 style="margin:24px 0 8px 0;font-size:16px;">${escapeHtml(topicName(t))}（${items.length}）</h2><ul style="padding-left:18px;margin:0;">${li || "<li>无新增</li>"}</ul>`;
  });

  return `<!doctype html>
<html>
  <body style="background:#f7f8fa;margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial;">
    <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;">
      <div style="font-size:18px;font-weight:700;">宁德时代/小米 资讯日报</div>
      <div style="color:#6b7280;font-size:12px;margin-top:6px;">窗口：${escapeHtml(params.windowStartIso)} → ${escapeHtml(params.windowEndIso)}</div>
      <div style="display:flex;gap:12px;margin-top:14px;flex-wrap:wrap;">
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;">
          <div style="color:#6b7280;font-size:12px;">抓取条数</div>
          <div style="font-weight:700;font-size:16px;">${params.fetchedCount}</div>
        </div>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;">
          <div style="color:#6b7280;font-size:12px;">去重命中</div>
          <div style="font-weight:700;font-size:16px;">${params.dedupedCount}</div>
        </div>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;">
          <div style="color:#6b7280;font-size:12px;">新增条目</div>
          <div style="font-weight:700;font-size:16px;">${params.outputCount}</div>
        </div>
      </div>
      ${sections.join("\n")}
      <div style="margin-top:22px;color:#9ca3af;font-size:12px;">自动生成邮件，请以原文为准。</div>
    </div>
  </body>
</html>`;
}

export async function sendReportEmail(params: {
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = getRequiredEnv("RESEND_API_KEY");
  const from = getRequiredEnv("RESEND_FROM");
  const to = getOptionalEnv("REPORT_TO_EMAIL") ?? "1619900613@qq.com";
  const resend = new Resend(apiKey);
  const res = await resend.emails.send({ from, to, subject: params.subject, html: params.html });
  const err = (res as unknown as { error?: unknown }).error;
  if (err) {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : JSON.stringify(err);
    throw new Error(`Resend send failed: ${msg}`);
  }
}
