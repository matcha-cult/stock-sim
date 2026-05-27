/**
 * 排行查询服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供财富排行、股市市值排行、股市收益排行三类查询。
 * 2. 不做什么：不做快照写入、不做夜间刷新、不做境界/宗门/竞技场排行。
 *
 * 输入 / 输出：
 * - 输入：limit 参数（1~200，有默认值）。
 * - 输出：`{ success: boolean; message: string; data?: Row[] }` 标准结果。
 *
 * 数据流 / 状态流：
 * 路由层传入 limit → clampLimit 归一化 → 双层缓存 get → loader 执行 SQL → 映射字段 → 返回。
 *
 * 复用设计说明：
 * - 财富排行直接查 `characters` 表，SQL 单条完成，不依赖快照。
 * - 股市排行用 CTE 聚合持仓成本和已实现盈亏，避免在业务层做重复遍历。
 * - 所有排行共用同一套 `createCacheLayer` 双层缓存（内存 5s + Redis 30s），热点请求自动去重。
 *
 * 关键边界条件与坑点：
 * 1. 目标项目 `characters` 无 `realm`、`avatar` 字段，排行响应中不包含这两项。
 * 2. 股市排行 `metric=profit` 模式下会包含"无持仓但有已实现盈亏"的角色，`value` 模式只展示持仓者。
 * 3. 股价使用定点分单位存储（`STOCK_MARKET_PRICE_SCALE = 100`），SQL 中需用整数除法避免精度丢失。
 */

import { query } from '../config/database.js';
import { createCacheLayer } from './shared/cacheLayer.js';
import { getMonthCardActiveMapByCharacterIds } from './shared/monthCardBenefits.js';
import { STOCK_MARKET_PRICE_SCALE } from './stockMarket/stockMarketRules.js';

// ============================================
// 工具函数
// ============================================

const clampLimit = (limit?: number, fallback: number = 50): number => {
  const n = Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : fallback;
  return Math.max(1, Math.min(200, n));
};

const normalizeStockMarketRankMetric = (
  metric: string | null | undefined,
): StockMarketRankMetric | null => {
  const normalized = typeof metric === 'string' ? metric.trim().toLowerCase() : '';
  if (normalized === 'value') return 'value';
  if (normalized === 'profit') return 'profit';
  return null;
};

// ============================================
// 常量
// ============================================

const RANK_CACHE_REDIS_TTL_SEC = 30;
const RANK_CACHE_MEMORY_TTL_MS = 5_000;
const STOCK_MARKET_PRICE_SCALE_SQL = STOCK_MARKET_PRICE_SCALE.toString();
const STOCK_MARKET_PRICE_SCALE_OFFSET_SQL = (STOCK_MARKET_PRICE_SCALE - 1n).toString();

// ============================================
// 类型定义
// ============================================

export type WealthRankRow = {
  rank: number;
  characterId: number;
  name: string;
  title: string;
  monthCardActive: boolean;
  spiritStones: number;
  silver: number;
};

export type StockMarketRankMetric = 'value' | 'profit';

export type StockMarketRankRow = {
  rank: number;
  characterId: number;
  name: string;
  title: string;
  monthCardActive: boolean;
  totalHoldingQty: number;
  totalMarketValueSpiritStones: number;
  totalCostSpiritStones: number;
  unrealizedPnlSpiritStones: number;
  realizedPnlSpiritStones: number;
  totalPnlSpiritStones: number;
};

type WealthRankQueryRow = {
  rank: number | string;
  character_id: number | string;
  name: string;
  title: string | null;
  spiritStones: number | string;
  silver: number | string;
};

type StockMarketRankQueryRow = {
  rank: number | string;
  character_id: number | string;
  name: string;
  title: string | null;
  totalHoldingQty: number | string;
  totalMarketValueSpiritStones: number | string;
  totalCostSpiritStones: number | string;
  unrealizedPnlSpiritStones: number | string;
  realizedPnlSpiritStones: number | string;
  totalPnlSpiritStones: number | string;
};

const STOCK_MARKET_RANK_ORDER_SQL: Record<StockMarketRankMetric, string> = {
  value: '"totalMarketValueSpiritStones" DESC, "totalPnlSpiritStones" DESC, character_id ASC',
  profit: '"totalPnlSpiritStones" DESC, "totalMarketValueSpiritStones" DESC, character_id ASC',
};

const STOCK_MARKET_RANK_FILTER_SQL: Record<StockMarketRankMetric, string> = {
  value: 'COALESCE(h.total_market_value_spirit_stones, 0)::bigint > 0',
  profit: '(COALESCE(h.total_market_value_spirit_stones, 0)::bigint > 0 OR r.character_id IS NOT NULL)',
};

// ============================================
// 财富排行 loader
// ============================================

const loadWealthRanks = async (limit: number): Promise<WealthRankRow[]> => {
  const res = await query(
    `
      SELECT
        ROW_NUMBER() OVER (ORDER BY spirit_stones DESC, silver DESC, id ASC)::int AS rank,
        id AS character_id,
        nickname AS name,
        title,
        COALESCE(spirit_stones, 0)::bigint AS "spiritStones",
        COALESCE(silver, 0)::bigint AS silver
      FROM characters
      WHERE nickname IS NOT NULL AND nickname <> ''
      ORDER BY rank
      LIMIT $1
    `,
    [limit],
  );

  const rows = res.rows as WealthRankQueryRow[];
  const monthCardActiveMap = await getMonthCardActiveMapByCharacterIds(
    rows.map((row) => Number(row.character_id)),
  );

  return rows.map((row) => ({
    rank: Number(row.rank),
    characterId: Number(row.character_id),
    name: String(row.name),
    title: typeof row.title === 'string' ? row.title : '',
    monthCardActive: monthCardActiveMap.get(Number(row.character_id)) ?? false,
    spiritStones: Number(row.spiritStones),
    silver: Number(row.silver),
  }));
};

// ============================================
// 股市排行 loader
// ============================================

const loadStockMarketRanks = async (
  metric: StockMarketRankMetric,
  limit: number,
): Promise<StockMarketRankRow[]> => {
  const orderSql = STOCK_MARKET_RANK_ORDER_SQL[metric];
  const filterSql = STOCK_MARKET_RANK_FILTER_SQL[metric];
  const res = await query(
    `
      WITH holding_totals AS (
        SELECT
          csh.character_id,
          SUM(csh.quantity)::bigint AS total_holding_qty,
          SUM((csh.quantity::bigint * smq.current_price_spirit_stones + ${STOCK_MARKET_PRICE_SCALE_OFFSET_SQL}) / ${STOCK_MARKET_PRICE_SCALE_SQL})::bigint AS total_market_value_spirit_stones,
          SUM(csh.total_cost_spirit_stones)::bigint AS total_cost_spirit_stones
        FROM character_stock_holding csh
        JOIN stock_market_quote smq ON smq.stock_id = csh.stock_id
        GROUP BY csh.character_id
      ),
      realized_totals AS (
        SELECT
          character_id,
          SUM(COALESCE(realized_pnl_spirit_stones, 0))::bigint AS realized_pnl_spirit_stones
        FROM stock_market_trade_record
        GROUP BY character_id
      ),
      rank_input AS (
        SELECT
          c.id AS character_id,
          COALESCE(NULLIF(c.nickname, ''), CONCAT('修士', c.id::text)) AS name,
          c.title,
          COALESCE(h.total_holding_qty, 0)::bigint AS "totalHoldingQty",
          COALESCE(h.total_market_value_spirit_stones, 0)::bigint AS "totalMarketValueSpiritStones",
          COALESCE(h.total_cost_spirit_stones, 0)::bigint AS "totalCostSpiritStones",
          (
            COALESCE(h.total_market_value_spirit_stones, 0)::bigint
            - COALESCE(h.total_cost_spirit_stones, 0)::bigint
          )::bigint AS "unrealizedPnlSpiritStones",
          COALESCE(r.realized_pnl_spirit_stones, 0)::bigint AS "realizedPnlSpiritStones",
          (
            COALESCE(h.total_market_value_spirit_stones, 0)::bigint
            - COALESCE(h.total_cost_spirit_stones, 0)::bigint
            + COALESCE(r.realized_pnl_spirit_stones, 0)::bigint
          )::bigint AS "totalPnlSpiritStones"
        FROM characters c
        LEFT JOIN holding_totals h ON h.character_id = c.id
        LEFT JOIN realized_totals r ON r.character_id = c.id
        WHERE c.nickname IS NOT NULL
          AND c.nickname <> ''
          AND ${filterSql}
      )
      SELECT
        ROW_NUMBER() OVER (ORDER BY ${orderSql})::int AS rank,
        character_id,
        name,
        title,
        "totalHoldingQty",
        "totalMarketValueSpiritStones",
        "totalCostSpiritStones",
        "unrealizedPnlSpiritStones",
        "realizedPnlSpiritStones",
        "totalPnlSpiritStones"
      FROM rank_input
      ORDER BY rank
      LIMIT $1
    `,
    [limit],
  );

  const rows = res.rows as StockMarketRankQueryRow[];
  const monthCardActiveMap = await getMonthCardActiveMapByCharacterIds(
    rows.map((row) => Number(row.character_id)),
  );

  return rows.map((row) => ({
    rank: Number(row.rank),
    characterId: Number(row.character_id),
    name: String(row.name),
    title: typeof row.title === 'string' ? row.title : '',
    monthCardActive: monthCardActiveMap.get(Number(row.character_id)) ?? false,
    totalHoldingQty: Number(row.totalHoldingQty),
    totalMarketValueSpiritStones: Number(row.totalMarketValueSpiritStones),
    totalCostSpiritStones: Number(row.totalCostSpiritStones),
    unrealizedPnlSpiritStones: Number(row.unrealizedPnlSpiritStones),
    realizedPnlSpiritStones: Number(row.realizedPnlSpiritStones),
    totalPnlSpiritStones: Number(row.totalPnlSpiritStones),
  }));
};

// ============================================
// 缓存实例
// ============================================

const wealthRankCache = createCacheLayer<number, WealthRankRow[]>({
  keyPrefix: 'rank:wealth:',
  redisTtlSec: RANK_CACHE_REDIS_TTL_SEC,
  memoryTtlMs: RANK_CACHE_MEMORY_TTL_MS,
  loader: loadWealthRanks,
});

const createStockMarketRankCache = (
  metric: StockMarketRankMetric,
) => createCacheLayer<number, StockMarketRankRow[]>({
  keyPrefix: `rank:stock-market:${metric}:`,
  redisTtlSec: RANK_CACHE_REDIS_TTL_SEC,
  memoryTtlMs: RANK_CACHE_MEMORY_TTL_MS,
  loader: (limit) => loadStockMarketRanks(metric, limit),
});

const stockMarketRankCaches: Record<StockMarketRankMetric, ReturnType<typeof createStockMarketRankCache>> = {
  value: createStockMarketRankCache('value'),
  profit: createStockMarketRankCache('profit'),
};

// ============================================
// 导出函数
// ============================================

export const getWealthRanks = async (
  limit?: number,
): Promise<{ success: boolean; message: string; data?: WealthRankRow[] }> => {
  const l = clampLimit(limit, 50);
  const data = (await wealthRankCache.get(l)) ?? [];
  return { success: true, message: 'ok', data };
};

export const getStockMarketRanks = async (
  metricRaw: string | null | undefined,
  limit?: number,
): Promise<{ success: boolean; message: string; data?: StockMarketRankRow[] }> => {
  const metric = normalizeStockMarketRankMetric(metricRaw);
  if (!metric) {
    return { success: false, message: '股市排行维度不合法' };
  }

  const l = clampLimit(limit, 50);
  const data = (await stockMarketRankCaches[metric].get(l)) ?? [];
  return { success: true, message: 'ok', data };
};
