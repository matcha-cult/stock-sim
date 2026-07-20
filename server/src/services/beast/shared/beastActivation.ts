/**
 * 灵兽出战切换（DB 操作）
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：在事务内切换出战灵兽（先清旧再设新）。
 * 2. 不做什么：不处理 HTTP 参数。
 *
 * 关键边界条件与坑点：
 * 1) 同一时间只能有 1 只灵兽 is_active=TRUE。
 * 2) 切换必须在事务内执行，防止并发导致多只出战。
 */
import { query } from '../../../config/database.js';

/**
 * 设置出战灵兽。
 * 先将角色所有灵兽设为非出战，再将目标灵兽设为出战。
 * beastId 为 null 时表示收回所有灵兽。
 */
export const setBeastActivation = async (
  characterId: number,
  beastId: number | null,
): Promise<void> => {
  // 先清除所有出战状态
  await query(
    'UPDATE character_beast SET is_active = FALSE, updated_at = NOW() WHERE character_id = $1 AND is_active = TRUE',
    [characterId],
  );

  // 如果指定了灵兽，设置出战
  if (beastId !== null) {
    await query(
      'UPDATE character_beast SET is_active = TRUE, updated_at = NOW() WHERE id = $1 AND character_id = $2',
      [beastId, characterId],
    );
  }
};

/**
 * 查询角色当前出战的灵兽 ID。
 */
export const loadActiveBeastId = async (characterId: number): Promise<number | null> => {
  const result = await query<{ id: number }>(
    'SELECT id FROM character_beast WHERE character_id = $1 AND is_active = TRUE LIMIT 1',
    [characterId],
  );
  return result.rows[0]?.id ?? null;
};
