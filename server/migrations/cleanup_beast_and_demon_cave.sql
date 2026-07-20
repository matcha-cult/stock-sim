-- 清理万兽楼和锁妖窟数据
-- 执行前请确认备份

-- 1. 清理灵兽相关表
DELETE FROM character_beast_skill_policy;
DELETE FROM character_beast_technique;
DELETE FROM character_beast;
DELETE FROM beast_action_log;

-- 2. 清理锁妖窟相关表
DELETE FROM demon_cave_idle_battle_log;
DELETE FROM demon_cave_idle_history;
DELETE FROM character_demon_cave_progress;

-- 注意：beast_rank_snapshot 保留（排行榜数据）
