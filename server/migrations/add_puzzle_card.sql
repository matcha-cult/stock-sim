-- 常驻刮刮乐（puzzle_card）业务表。
-- 独立于每日刮刮乐（scratch_ticket），配置数据由 TypeScript 内存常量承载。
CREATE TABLE IF NOT EXISTS puzzle_card (
  id              BIGSERIAL PRIMARY KEY,
  character_id    INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  ticket_number   BIGINT NOT NULL,
  type_key        VARCHAR(32) NOT NULL,
  grid_rows       SMALLINT NOT NULL,
  grid_cols       SMALLINT NOT NULL,
  price_paid      BIGINT NOT NULL,
  ticket_data     JSONB NOT NULL,
  matched_lines   JSONB NOT NULL DEFAULT '[]'::jsonb,
  prize_type      VARCHAR(20) NOT NULL DEFAULT 'spirit_stones',
  prize_amount    BIGINT NOT NULL DEFAULT 0,
  redeemed_at     TIMESTAMP(6),
  created_at      TIMESTAMP(6) NOT NULL DEFAULT NOW()
);

-- ticket_number 原子递增：INSERT 时 SELECT MAX+1 并 FOR UPDATE 锁角色行防并发
CREATE UNIQUE INDEX IF NOT EXISTS uq_puzzle_card_character_ticket
  ON puzzle_card (character_id, ticket_number);

CREATE INDEX IF NOT EXISTS idx_puzzle_card_character
  ON puzzle_card (character_id);

CREATE INDEX IF NOT EXISTS idx_puzzle_card_type_key
  ON puzzle_card (type_key);
