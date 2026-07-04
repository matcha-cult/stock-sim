/**
 * 灵田系统 V3 — 活动日志服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：记录灵田活动日志（播种/收获/铲除/枯萎/杂交/变异）。
 * 2. 不做什么：不做日志查询（在 farmService 中实现）。
 *
 * 数据流 / 状态流：
 * farmService.plantCrop/harvestCrop/removeCrop → logActivity() → 写入 farm_activity_log 表。
 *
 * 复用设计说明：
 * - 日志写入函数接受标准化的参数，各业务方法统一调用。
 * - metadata 使用 JSON 格式存储灵活的活动详情。
 *
 * 关键边界条件与坑点：
 * 1. 日志写入失败不应阻塞主业务流程（静默失败）。
 * 2. 日志表数据量会持续增长，后期需要考虑清理策略。
 */

import { query } from '../../config/database.js';

/** 活动类型枚举 */
export type ActivityType = 'plant' | 'harvest' | 'remove' | 'wither' | 'hybrid' | 'mutation' | 'transplant' | 'sell';

/** 日志写入参数 */
export interface LogActivityParams {
  characterId: number;
  activityType: ActivityType;
  row: number;
  col: number;
  cropId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * 写入活动日志。
 * 静默失败：写入异常不影响主业务流程。
 */
export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    await query(
      `INSERT INTO farm_activity_log (character_id, activity_type, row, col, crop_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.characterId,
        params.activityType,
        params.row,
        params.col,
        params.cropId ?? null,
        JSON.stringify(params.metadata ?? {}),
      ],
    );
  } catch {
    // 静默失败：日志写入不应阻塞主业务
  }
}
