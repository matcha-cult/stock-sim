-- 新增灵兽血脉字段
ALTER TABLE character_beast ADD COLUMN bloodline_id VARCHAR(64);

-- 添加索引（可选，根据查询需求）
CREATE INDEX IF NOT EXISTS idx_character_beast_bloodline ON character_beast(bloodline_id);
