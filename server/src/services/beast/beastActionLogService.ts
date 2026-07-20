/**
 * 灵兽操作日志服务
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：记录灵兽相关操作日志（召唤、放生、培育、升阶、化形等），提供查询接口。
 * 2. 不做什么：不处理业务逻辑（由各业务服务调用）。
 *
 * 数据流 / 状态流：
 * 业务服务 -> recordBeastAction -> 写入 beast_action_log 表。
 * 前端请求 -> getActionLogs -> 查询日志列表。
 *
 * 关键边界条件与坑点：
 * 1. 日志记录应在业务操作成功后调用，确保数据一致性。
 * 2. 分页查询默认按时间倒序。
 */
import { query } from '../../config/database.js';

// ==================== 类型定义 ====================

export type BeastActionType =
  | 'summon'      // 召唤
  | 'release'     // 放生
  | 'cultivate'   // 培育
  | 'tier_up'     // 品阶提升
  | 'transform';  // 化形

export const BEAST_ACTION_LABELS: Record<BeastActionType, string> = {
  summon: '召唤',
  release: '放生',
  cultivate: '培育',
  tier_up: '品阶提升',
  transform: '化形',
};

export interface BeastActionLogDto {
  id: number;
  characterId: number;
  actionType: BeastActionType;
  actionTypeLabel: string;
  spiritStonesCost: number;
  otherCost: string | null;
  actionDetail: string | null;
  createdAt: number;
}

// ==================== 记录日志 ====================

export interface RecordBeastActionParams {
  characterId: number;
  actionType: BeastActionType;
  spiritStonesCost?: number;
  otherCost?: string;
  actionDetail?: string;
}

/**
 * 记录灵兽操作日志。
 */
export const recordBeastAction = async (params: RecordBeastActionParams): Promise<void> => {
  await query(
    `INSERT INTO beast_action_log
       (character_id, action_type, spirit_stones_cost, other_cost, action_detail, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      params.characterId,
      params.actionType,
      params.spiritStonesCost ?? 0,
      params.otherCost ?? null,
      params.actionDetail ?? null,
    ],
  );
};

// ==================== 查询日志 ====================

const LOG_PAGE_SIZE = 20;

export interface ActionLogPageResult {
  logs: BeastActionLogDto[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 查询玩家的灵兽操作日志（分页）。
 */
export const getActionLogs = async (
  characterId: number,
  page: number = 1,
): Promise<ActionLogPageResult> => {
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * LOG_PAGE_SIZE;

  const [countResult, rowsResult] = await Promise.all([
    query<{ total: string }>(
      `SELECT COUNT(*)::bigint AS total FROM beast_action_log WHERE character_id = $1`,
      [characterId],
    ),
    query<{
      id: number;
      character_id: number;
      action_type: string;
      spirit_stones_cost: number;
      other_cost: string | null;
      action_detail: string | null;
      epoch: number;
    }>(
      `SELECT id, character_id, action_type, spirit_stones_cost, other_cost, action_detail,
              EXTRACT(EPOCH FROM created_at) AS epoch
       FROM beast_action_log
       WHERE character_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [characterId, LOG_PAGE_SIZE, offset],
    ),
  ]);

  const total = Number(countResult.rows[0]?.total ?? 0);
  const logs: BeastActionLogDto[] = rowsResult.rows.map((row) => ({
    id: row.id,
    characterId: row.character_id,
    actionType: row.action_type as BeastActionType,
    actionTypeLabel: BEAST_ACTION_LABELS[row.action_type as BeastActionType] ?? row.action_type,
    spiritStonesCost: row.spirit_stones_cost,
    otherCost: row.other_cost,
    actionDetail: row.action_detail,
    createdAt: Math.floor(Number(row.epoch)),
  }));

  return { logs, total, page: safePage, pageSize: LOG_PAGE_SIZE };
};
