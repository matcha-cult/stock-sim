-- 新增：灵石流水账表（单式记账簿）
-- 执行方式：手动执行或集成到数据库迁移流程

CREATE TABLE IF NOT EXISTS spirit_stones_ledger (
  id            BIGSERIAL PRIMARY KEY,
  character_id  INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  amount        BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  biz_type      VARCHAR(32) NOT NULL,
  biz_id        VARCHAR(128),
  counterparty  INT,
  memo          VARCHAR(500),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_character ON spirit_stones_ledger(character_id);
CREATE INDEX IF NOT EXISTS idx_ledger_biz ON spirit_stones_ledger(biz_type, biz_id);
CREATE INDEX IF NOT EXISTS idx_ledger_character_time ON spirit_stones_ledger(character_id, created_at);
