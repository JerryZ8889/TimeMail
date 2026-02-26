ALTER TABLE news_item
ADD COLUMN language TEXT NOT NULL DEFAULT 'und';

ALTER TABLE news_item
ADD COLUMN summary TEXT NULL;

ALTER TABLE news_item
ADD COLUMN title_zh TEXT NULL;

ALTER TABLE news_item
ADD COLUMN summary_zh TEXT NULL;

UPDATE news_item
SET language = 'zh'
WHERE language = 'und';

CREATE INDEX IF NOT EXISTS idx_news_item_language ON news_item (language);
