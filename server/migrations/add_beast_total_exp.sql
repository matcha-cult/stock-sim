-- 添加灵兽总经验字段
ALTER TABLE character_beast
ADD COLUMN total_exp BIGINT NOT NULL DEFAULT 0;

-- 为现有的灵兽初始化 total_exp（如果有数据的话）
UPDATE character_beast
SET total_exp = progress_exp
WHERE total_exp = 0;

-- 添加注释
COMMENT ON COLUMN character_beast.total_exp IS '总获得经验（统计用，不会因升级而清零）';
