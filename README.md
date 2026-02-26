每天 08:00（Asia/Shanghai）自动抓取“宁德时代/小米”资讯，增量去重写入 Supabase，并通过 Resend 发送邮件。

## 功能
- `/`：任务状态页，展示最近运行、增量窗口、统计与本次新增列表
- `/api/cron/daily`：定时任务入口（支持 `CRON_SECRET` 校验）
- `/api/health`：健康检查

## 资讯源
- Google News RSS（中文 + 英文）
- GDELT 2.1 DOC（全球新闻索引）

## Getting Started

### 1) 环境变量
复制 `.env.example` 为 `.env.local` 并填入：
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM`
- `REPORT_TO_EMAIL`
- `CRON_SECRET`（可选，本地手动调用可不设；Vercel Cron 建议设置）
- `SKIP_EMAIL=1`（可选：跳过邮件发送，仍会抓取与写库）

可选：外文标题/摘要翻译（简体中文）
- `TRANSLATE_TO_ZH=1`
- `TRANSLATION_PROVIDER`（可选：`zhipu`/`openai`，不填默认优先智谱）
- 智谱：`ZHIPU_API_KEY`（或使用系统环境变量 `GLM`）、`ZHIPU_MODEL`（或 `GLM_MODEL`，默认 `glm-4.7-flash`）
- OpenAI：`OPENAI_API_KEY`、`OPENAI_TRANSLATE_MODEL`（默认 `gpt-4o-mini`）

可选：资讯列表页 AI 解读（利多/利空/重要变化）
- `AI_DIGEST=1`（设为 `0` 可关闭）
- `AI_PROVIDER`（可选：`zhipu`/`openai`，不填默认优先智谱）
- 智谱：使用 `GLM`（或 `ZHIPU_API_KEY`），模型可用 `ZHIPU_DIGEST_MODEL` 覆盖
- OpenAI：使用 `OPENAI_API_KEY`，模型可用 `OPENAI_DIGEST_MODEL` 覆盖
- `AI_DIGEST_MAX_ITEMS`（默认 30；限制每次解读读取的文章条数）

### 2) 本地运行

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### 3) 手动触发一次抓取
本地可直接访问（或用 `curl.exe`）触发：
`http://localhost:3000/api/cron/daily`

如果设置了 `CRON_SECRET`，需要带上 Header：
`Authorization: Bearer <CRON_SECRET>`

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel
项目已包含 `vercel.json` 的 Cron 配置：每天 `0 0 * * *`（UTC）调用 `/api/cron/daily`，对应北京时间 08:00。

在 Vercel 项目环境变量中设置同名变量，并在 Supabase 中依次应用 `supabase/migrations/001_init.sql`、`supabase/migrations/002_news_item_translation.sql`。
