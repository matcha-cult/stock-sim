-- 清理所有玩家的 currentRunId（因为现在是同步战斗，不需要保持状态）
UPDATE character_demon_cave_progress
SET current_run_id = NULL,
    updated_at = NOW();

-- 验证清理结果
SELECT character_id, current_run_id, current_floor, best_floor
FROM character_demon_cave_progress
WHERE current_run_id IS NOT NULL;
