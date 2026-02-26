from __future__ import annotations

import datetime as _dt
import os
import zipfile


def _xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _w_t(s: str) -> str:
    if s == "":
        return "<w:t/>"
    return f'<w:t xml:space="preserve">{_xml_escape(s)}</w:t>'


def _para(text: str, *, bold: bool = False, style: str | None = None) -> str:
    ppr = ""
    if style:
        ppr = f"<w:pPr><w:pStyle w:val=\"{_xml_escape(style)}\"/></w:pPr>"
    rpr = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return f"<w:p>{ppr}<w:r>{rpr}{_w_t(text)}</w:r></w:p>"


def _doc_xml(paras: list[str]) -> str:
    body = "\n".join(paras) + '\n<w:p><w:r><w:t/></w:r></w:p>'
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {body}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>
"""


def _styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:uiPriority w:val="9"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="240" w:after="120"/>
      <w:outlineLvl w:val="0"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="32"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:uiPriority w:val="9"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="200" w:after="100"/>
      <w:outlineLvl w:val="1"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
    </w:rPr>
  </w:style>
</w:styles>
"""


def _content_types_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>
"""


def _rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""


def _document_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
"""


def build_content() -> list[str]:
    today = _dt.date.today().isoformat()
    paras: list[str] = []
    paras.append(_para("TimeMail 项目设计", bold=True, style="Heading1"))
    paras.append(_para(f"版本日期：{today}"))
    paras.append(_para("仓库：https://github.com/JerryZ8889/TimeMail.git"))
    paras.append(_para(""))

    paras.append(_para("1. 项目目标与范围", bold=True, style="Heading1"))
    paras.append(_para("目标：每天自动抓取“宁德时代（CATL）/小米（XIAOMI）”相关资讯，增量写入 Supabase，并在网页端提供可分享的浏览与筛选；提供可选的 AI 解读（利多/利空/重要变化/关注事项）。"))
    paras.append(_para("范围：本版本以网页展示为主；邮件发送模块仍保留在代码中，但不作为当前主要交付（后续可移除）。"))
    paras.append(_para(""))

    paras.append(_para("2. 核心功能", bold=True, style="Heading1"))
    paras.append(_para("2.1 资讯抓取与入库", bold=True, style="Heading2"))
    paras.append(_para("- 数据源：Google News RSS（中文+英文）与 GDELT 2.1 DOC。"))
    paras.append(_para("- 增量：以 job_state.last_success_at 为起点构建抓取窗口，避免重复拉取。"))
    paras.append(_para("- 去重：按 content_hash（由 topic+URL 归一化后计算）做内存去重与数据库唯一约束。"))
    paras.append(_para("- 翻译：可选将外文标题/摘要翻译为简体中文，优先智谱，其次 OpenAI。"))
    paras.append(_para(""))
    paras.append(_para("2.2 网页展示", bold=True, style="Heading2"))
    paras.append(_para("- 状态页 /：展示最近一次任务状态、窗口、统计、失败原因与本次窗口新增列表。"))
    paras.append(_para("- 资讯列表页 /news：公开展示，无需登录；支持公司（宁德时代/小米）、时间范围、关键词搜索、分页。默认公司为宁德时代。"))
    paras.append(_para(""))
    paras.append(_para("2.3 AI 解读", bold=True, style="Heading2"))
    paras.append(_para("- 位置：/news 的筛选区下方。"))
    paras.append(_para("- 触发方式：手动点击“生成解读”，避免 SSR 阻塞与频繁触发限流。"))
    paras.append(_para("- 输出：总体概览 + 利多/利空/重要变化/关注事项，每项含简短理由与参考链接。"))
    paras.append(_para(""))

    paras.append(_para("3. 系统架构", bold=True, style="Heading1"))
    paras.append(_para("技术栈：Next.js App Router（Node.js runtime）+ Supabase（Postgres）+ Vercel 部署与 Cron。"))
    paras.append(_para("架构分层："))
    paras.append(_para("- src/server：抓取、去重、翻译、AI 解读等服务端逻辑。"))
    paras.append(_para("- src/app：页面（Server Components）与 API 路由（Route Handlers）。"))
    paras.append(_para("- src/lib：环境变量、哈希与 Supabase Admin 客户端等基础库。"))
    paras.append(_para(""))

    paras.append(_para("4. 数据流", bold=True, style="Heading1"))
    paras.append(_para("4.1 定时任务（抓取→入库）", bold=True, style="Heading2"))
    paras.append(_para("触发：Vercel Cron 每天调用 /api/cron/daily（可通过 CRON_SECRET 校验）。"))
    paras.append(_para("流程：读取 job_state.last_success_at → 构建窗口 → 拉取 RSS/GDELT → URL 归一化与 content_hash → 内存去重 → upsert 写入 news_item → 写 run_log → 更新 job_state。"))
    paras.append(_para(""))
    paras.append(_para("4.2 网页查询（只查库）", bold=True, style="Heading2"))
    paras.append(_para(" /news 页面筛选/搜索/分页均直接查询 Supabase 的 news_item，不会临时触发“上网抓取”。"))
    paras.append(_para(""))
    paras.append(_para("4.3 AI 解读（按需生成）", bold=True, style="Heading2"))
    paras.append(_para("用户点击生成 → 前端请求 /api/ai/digest → 后端按当前筛选查询 news_item → 取前 N 条（AI_DIGEST_MAX_ITEMS）组成输入 → 调用模型生成 JSON 结构 → 返回页面展示。"))
    paras.append(_para(""))

    paras.append(_para("5. 数据库设计（Supabase）", bold=True, style="Heading1"))
    paras.append(_para("主要表："))
    paras.append(_para("- news_item：资讯条目（topic/title/title_zh/summary/summary_zh/url/source/published_at/content_hash/language...）。"))
    paras.append(_para("- run_log：每次任务运行记录（status/window_start/window_end/fetched_count/deduped_count/output_count/error_message...）。"))
    paras.append(_para("- job_state：任务状态（key=daily_news，last_success_at）。"))
    paras.append(_para("唯一约束：news_item.content_hash、news_item.url 均有唯一索引，用于防重复入库。"))
    paras.append(_para(""))

    paras.append(_para("6. 关键模块与接口", bold=True, style="Heading1"))
    paras.append(_para("页面：", bold=True, style="Heading2"))
    paras.append(_para("- /：src/app/page.tsx"))
    paras.append(_para("- /news：src/app/news/page.tsx + src/app/news/AiDigestPanel.tsx"))
    paras.append(_para("API：", bold=True, style="Heading2"))
    paras.append(_para("- /api/cron/daily：触发抓取入库（支持 GET/POST）。"))
    paras.append(_para("- /api/ai/digest：按筛选生成 AI 解读，429 时返回友好提示。"))
    paras.append(_para("- /api/health：健康与环境变量存在性检查（不返回明文密钥）。"))
    paras.append(_para(""))

    paras.append(_para("7. 环境变量配置", bold=True, style="Heading1"))
    paras.append(_para("必需："))
    paras.append(_para("- SUPABASE_URL"))
    paras.append(_para("- SUPABASE_SERVICE_ROLE_KEY（仅服务端使用，不可暴露到浏览器）"))
    paras.append(_para("建议："))
    paras.append(_para("- CRON_SECRET（保护 /api/cron/daily）"))
    paras.append(_para("AI（可选）："))
    paras.append(_para("- GLM（或 ZHIPU_API_KEY）"))
    paras.append(_para("- GLM_MODEL / ZHIPU_DIGEST_MODEL（可选，控制模型版本）"))
    paras.append(_para("- AI_DIGEST_MAX_ITEMS（默认 30，建议调小可降低耗时与 429）"))
    paras.append(_para(""))

    paras.append(_para("8. 部署与运维（Vercel）", bold=True, style="Heading1"))
    paras.append(_para("- 部署：将 GitHub 仓库导入 Vercel。"))
    paras.append(_para("- 数据库：在 Supabase 中依次应用 migrations/001_init.sql 与 002_news_item_translation.sql。"))
    paras.append(_para("- 定时任务：项目包含 vercel.json 的 Cron 配置（UTC 0:00，对应北京时间 08:00）。"))
    paras.append(_para("- 观测：通过 / 查看 run_log；/api/health 可用于确认环境变量是否已正确注入。"))
    paras.append(_para(""))

    paras.append(_para("9. 安全与隐私", bold=True, style="Heading1"))
    paras.append(_para("- .env* 已在 .gitignore 中忽略，避免密钥进入仓库。"))
    paras.append(_para("- Supabase Service Role Key 仅在服务端运行时读取；页面查询在服务端执行，密钥不下发到客户端。"))
    paras.append(_para("- /api/health 仅返回“是否存在”布尔值，不返回密钥明文。"))
    paras.append(_para(""))

    paras.append(_para("10. 已知限制与后续优化建议", bold=True, style="Heading1"))
    paras.append(_para("- 去重目前主要基于（topic + 归一化 URL），同内容不同 URL 形态仍可能产生“看起来重复”的条目；可引入更强的 URL 归一化或内容相似度去重。"))
    paras.append(_para("- AI 解读为实时生成，受模型限流与输入长度影响；建议降低 AI_DIGEST_MAX_ITEMS，并可考虑将 digest 落库缓存。"))
    paras.append(_para("- 邮件发送模块已不再作为主流程，后续可移除 Resend 相关代码与数据库字段，简化系统。"))
    paras.append(_para(""))
    return paras


def write_docx(output_path: str) -> None:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    paras = build_content()
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _content_types_xml())
        z.writestr("_rels/.rels", _rels_xml())
        z.writestr("word/document.xml", _doc_xml(paras))
        z.writestr("word/styles.xml", _styles_xml())
        z.writestr("word/_rels/document.xml.rels", _document_rels_xml())


if __name__ == "__main__":
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    out = os.path.join(root, "说明文件夹", "项目设计.docx")
    write_docx(out)
    print(out)

