-- 锁妖窟系统数据清理脚本（系统未投产，可安全执行）

-- 1. 删除战斗日志
DELETE FROM demon_cave_idle_battle_log;

-- 2. 删除挂机历史
DELETE FROM demon_cave_idle_history;

-- 3. 删除进度数据
DELETE FROM character_demon_cave_progress;

-- 清理完成
