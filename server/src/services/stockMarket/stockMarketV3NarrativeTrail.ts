/**
 * V3 叙事轨迹查询。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：从 stock_market_tick + price_history 查询最近 N 条 generated tick 的紧凑摘要。
 * 2. 不做什么：不读写 V3 内部表、不改写数据、不做 AI 调用。
 *
 * 输入 / 输出：
 * - 输入：limit（默认 8）。
 * - 输出：narrativeTrail 数组，每条包含 tickId、headline、summary、impacts。
 *
 * 数据流 / 状态流：
 * tick 流程中调用 → 返回最近 N 条 tick 摘要 → 传入 AI prompt 作为叙事上下文。
 *
 * 复用设计说明：
 * - SQL 查询逻辑集中在此，V3Service 直接调用，避免 SQL 散落在多处。
 * - 返回结构也是 AI prompt 的一部分，类型定义在此模块。
 *
 * 关键边界条件与坑点：
 * 1. 只查 status='generated' 的 tick，忽略 running/failed/skipped。
 * 2. 如果数据库中没有历史 tick（首次运行），返回空数组，AI 需要处理无轨迹场景。
 * 3. impacts 来自 price_history，reason 字段可能为 null，需处理。
 */

import { query } from '../../config/database.js';

type NarrativeTrailImpactRow = {
  stock_id: string;
  change_bps: number;
  direction: string;
  reason: string | null;
};

type NarrativeTrailTickRow = {
  id: string | number | bigint;
  tick_hour: Date | string;
  headline: string | null;
  summary: string | null;
  impacts: NarrativeTrailImpactRow[] | null;
};

export type V3NarrativeTrailEntry = {
  tickId: string;
  hour: string;
  headline: string | null;
  summary: string | null;
  impacts: Array<{
    stockId: string;
    changeBps: number;
    direction: string;
    reason: string | null;
  }>;
};

/** 默认叙事轨迹长度。 */
export const V3_NARRATIVE_TRAIL_LIMIT = 8;

/** 查询最近 N 条 generated tick 的叙事轨迹。 */
export const loadNarrativeTrail = async (
  limit: number = V3_NARRATIVE_TRAIL_LIMIT,
): Promise<V3NarrativeTrailEntry[]> => {
  // 注意：PostgreSQL 原生查询不支持 JSONB 子查询自动展开为对象数组，
  // 所以我们用两次查询：先拿 ticks，再拿 impacts。
  const tickResult = await query<{
    id: string | number | bigint;
    tick_hour: Date | string;
    headline: string | null;
    summary: string | null;
  }>(
    `
      SELECT id, tick_hour, headline, summary
      FROM stock_market_tick
      WHERE status = 'generated'
      ORDER BY tick_hour DESC
      LIMIT $1
    `,
    [limit],
  );

  if (tickResult.rows.length === 0) {
    console.log('[V3NarrativeTrail] 无历史 tick，返回空轨迹');
    return [];
  }

  const tickIds = tickResult.rows.map((r) => r.id.toString());
  console.log(`[V3NarrativeTrail] 找到 ${tickResult.rows.length} 条历史 tick`);

  const impactResult = await query<{
    tick_id: string | number | bigint;
    stock_id: string;
    change_bps: number;
    direction: string;
    reason: string | null;
  }>(
    `
      SELECT tick_id, stock_id, change_bps, direction, reason
      FROM stock_market_price_history
      WHERE tick_id = ANY($1::bigint[])
      ORDER BY tick_id ASC, id ASC
    `,
    [tickIds],
  );

  // 按 tick_id 分组
  const impactsByTickId = new Map<string, Array<{
    stockId: string;
    changeBps: number;
    direction: string;
    reason: string | null;
  }>>();
  for (const row of impactResult.rows) {
    const tickId = row.tick_id.toString();
    const group = impactsByTickId.get(tickId) ?? [];
    group.push({
      stockId: row.stock_id,
      changeBps: Number(row.change_bps),
      direction: row.direction,
      reason: row.reason,
    });
    impactsByTickId.set(tickId, group);
  }

  const trail: V3NarrativeTrailEntry[] = [];
  for (const row of tickResult.rows) {
    const tickId = row.id.toString();
    trail.push({
      tickId,
      hour: new Date(row.tick_hour).toISOString(),
      headline: row.headline,
      summary: row.summary,
      impacts: impactsByTickId.get(tickId) ?? [],
    });
  }

  return trail;
};
