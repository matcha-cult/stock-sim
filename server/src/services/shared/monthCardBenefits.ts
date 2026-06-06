/**
 * 月卡激活状态批量查询（真实实现）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供 `getMonthCardActiveMapByCharacterIds` 接口，批量返回角色是否激活月卡。
 * 2. 不做什么：不返回月卡详情（到期时间等），仅返回激活状态布尔值。
 *
 * 复用设计说明：
 * - 被排行榜服务调用，用于在排行结果中标注月卡激活状态。
 * - 使用 `ANY($1::int[])` 批量查询，避免 N+1 问题。
 *
 * 关键边界条件与坑点：
 * 1. 输入空数组时直接返回空 Map，不走循环。
 * 2. 所有 key 都必须存在于 Map 中，即使值为 false，避免调用方 `get()` 返回 undefined。
 * 3. 同时校验 `status = 'active'` 和 `expires_at > NOW()`，双条件确保状态准确。
 */
import { query } from '../../config/database.js';

/**
 * 月卡激活状态批量查询。
 * 使用 `ANY($1::int[])` 批量查询，避免 N+1 问题。
 */
export const getMonthCardActiveMapByCharacterIds = async (
  characterIds: number[],
): Promise<Map<number, boolean>> => {
  if (characterIds.length === 0) return new Map();

  const result = await query(
    `SELECT character_id FROM month_card_ownership
     WHERE character_id = ANY($1::int[])
       AND status = 'active'
       AND expires_at > NOW()`,
    [characterIds],
  );

  const activeSet = new Set(result.rows.map(r => Number(r.character_id)));
  const map = new Map<number, boolean>();
  for (const id of characterIds) {
    map.set(id, activeSet.has(id));
  }
  return map;
};

/**
 * GM 权限批量查询（通过 character_id -> user_id -> permissions）。
 * 使用 `ANY($1::int[])` 批量查询，避免 N+1 问题。
 */
export const getGmStatusMapByCharacterIds = async (
  characterIds: number[],
): Promise<Map<number, boolean>> => {
  if (characterIds.length === 0) return new Map();

  const result = await query(
    `SELECT c.id AS character_id
     FROM characters c
     JOIN users u ON u.id = c.user_id
     WHERE c.id = ANY($1::int[])
       AND $2 = ANY(u.permissions)`,
    [characterIds, 'GM'],
  );

  const gmSet = new Set(result.rows.map(r => Number(r.character_id)));
  const map = new Map<number, boolean>();
  for (const id of characterIds) {
    map.set(id, gmSet.has(id));
  }
  return map;
};
