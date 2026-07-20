-- 灵兽操作日志表
CREATE TABLE beast_action_log (
  id BIGSERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  action_type VARCHAR(50) NOT NULL,
  spirit_stones_cost INTEGER NOT NULL DEFAULT 0,
  other_cost TEXT,
  action_detail TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 索引：按角色ID和操作时间查询
CREATE INDEX idx_beast_action_log_character_id ON beast_action_log(character_id);
CREATE INDEX idx_beast_action_log_created_at ON beast_action_log(created_at DESC);

-- 操作类型说明：
-- summon: 召唤灵兽
-- release: 放生灵兽
-- cultivate: 培育灵兽
-- tier_up: 品阶提升
-- transform: 化形
