-- 添加 beast_ids 数组字段
ALTER TABLE character_demon_cave_progress
ADD COLUMN beast_ids INT[] DEFAULT '{}';

-- 迁移现有数据：将 beast_id 转为 beast_ids 数组
UPDATE character_demon_cave_progress
SET beast_ids = ARRAY[beast_id]
WHERE beast_id IS NOT NULL;

-- 删除旧的 beast_id 字段
ALTER TABLE character_demon_cave_progress
DROP COLUMN beast_id;
