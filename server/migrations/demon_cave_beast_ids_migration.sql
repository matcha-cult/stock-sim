-- 锁妖窟系统迁移脚本（系统未投产）
-- 将 beast_id 替换为 beast_ids 数组字段
-- 将挂机历史的 beast_id/beast_name 替换为 beast_ids/beast_names 数组字段

-- 1. 清理所有锁妖窟数据（系统未投产，可安全执行）
DELETE FROM demon_cave_idle_battle_log;
DELETE FROM demon_cave_idle_history;
DELETE FROM character_demon_cave_progress;

-- 2. character_demon_cave_progress: 添加 beast_ids，删除 beast_id
ALTER TABLE character_demon_cave_progress
ADD COLUMN IF NOT EXISTS beast_ids INT[] DEFAULT '{}';

ALTER TABLE character_demon_cave_progress
DROP COLUMN IF EXISTS beast_id;

-- 3. demon_cave_idle_history: 添加 beast_ids/beast_names，删除 beast_id/beast_name
ALTER TABLE demon_cave_idle_history
ADD COLUMN IF NOT EXISTS beast_ids INT[] DEFAULT '{}';

ALTER TABLE demon_cave_idle_history
ADD COLUMN IF NOT EXISTS beast_names VARCHAR(64)[] DEFAULT '{}';

ALTER TABLE demon_cave_idle_history
DROP COLUMN IF EXISTS beast_id;

ALTER TABLE demon_cave_idle_history
DROP COLUMN IF EXISTS beast_name;

-- 迁移完成
