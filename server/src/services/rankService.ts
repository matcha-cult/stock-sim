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
import { getMonthCardActiveMapByCharacterIds, getGmStatusMapByCharacterIds } from './shared/monthCardBenefits.js';
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
  if (normalized === 'unrealizedprofit') return 'unrealizedProfit';
  if (normalized === 'totalprofit') return 'totalProfit';
  if (normalized === 'totalloss') return 'totalLoss';
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

export type StockMarketRankMetric = 'value' | 'unrealizedProfit' | 'totalProfit' | 'totalLoss';

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

export type ShopRentRankRow = {
  rank: number;
  characterId: number;
  name: string;
  title: string;
  monthCardActive: boolean;
  totalRentCollected: number;
  shopCount: number;
};

export type ScratchRankMetric = 'total' | 'grandCount' | 'firstCount';

export type ScratchRankRow = {
  rank: number;
  characterId: number;
  name: string;
  title: string;
  monthCardActive: boolean;
  totalPrizeAmount: number;
  settledCount: number;
  grandPrizeCount: number;
  firstPrizeCount: number;
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

type ShopRentRankQueryRow = {
  rank: number | string;
  character_id: number | string;
  name: string;
  title: string | null;
  totalRentCollected: number | string;
  shopCount: number | string;
};

type ScratchRankQueryRow = {
  rank: number | string;
  character_id: number | string;
  name: string;
  title: string | null;
  totalPrizeAmount: number | string;
  settledCount: number | string;
  grandPrizeCount: number | string;
  firstPrizeCount: number | string;
};

const STOCK_MARKET_RANK_ORDER_SQL: Record<StockMarketRankMetric, string> = {
  value: '"totalMarketValueSpiritStones" DESC, "totalPnlSpiritStones" DESC, character_id ASC',
  unrealizedProfit: '"unrealizedPnlSpiritStones" DESC, "totalMarketValueSpiritStones" DESC, character_id ASC',
  totalProfit: '"totalPnlSpiritStones" DESC, "totalMarketValueSpiritStones" DESC, character_id ASC',
  totalLoss: '"totalPnlSpiritStones" ASC, "totalMarketValueSpiritStones" DESC, character_id ASC',
};

const STOCK_MARKET_RANK_FILTER_SQL: Record<StockMarketRankMetric, string> = {
  value: 'COALESCE(h.total_market_value_spirit_stones, 0)::bigint > 0',
  unrealizedProfit: 'COALESCE(h.total_market_value_spirit_stones, 0)::bigint > 0',
  totalProfit: '(COALESCE(h.total_market_value_spirit_stones, 0)::bigint - COALESCE(h.total_cost_spirit_stones, 0)::bigint + COALESCE(r.realized_pnl_spirit_stones, 0)::bigint) > 0',
  totalLoss: '(COALESCE(h.total_market_value_spirit_stones, 0)::bigint - COALESCE(h.total_cost_spirit_stones, 0)::bigint + COALESCE(r.realized_pnl_spirit_stones, 0)::bigint) < 0',
};

const SCRATCH_RANK_ORDER_SQL: Record<ScratchRankMetric, string> = {
  total: '"totalPrizeAmount" DESC, "grandPrizeCount" DESC, character_id ASC',
  grandCount: '"grandPrizeCount" DESC, "totalPrizeAmount" DESC, character_id ASC',
  firstCount: '"firstPrizeCount" DESC, "totalPrizeAmount" DESC, character_id ASC',
};

const normalizeScratchRankMetric = (
  metric: string | null | undefined,
): ScratchRankMetric | null => {
  const normalized = typeof metric === 'string' ? metric.trim().toLowerCase() : '';
  if (normalized === 'total') return 'total';
  if (normalized === 'grandcount') return 'grandCount';
  if (normalized === 'firstcount') return 'firstCount';
  return null;
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
  const characterIds = rows.map((row) => Number(row.character_id));
  const monthCardActiveMap = await getMonthCardActiveMapByCharacterIds(characterIds);
  const gmStatusMap = await getGmStatusMapByCharacterIds(characterIds);

  return rows.map((row) => ({
    rank: Number(row.rank),
    characterId: Number(row.character_id),
    name: String(row.name),
    title: typeof row.title === 'string' ? row.title : '',
    monthCardActive: monthCardActiveMap.get(Number(row.character_id)) ?? false,
    isGm: gmStatusMap.get(Number(row.character_id)) ?? false,
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
  const characterIds = rows.map((row) => Number(row.character_id));
  const monthCardActiveMap = await getMonthCardActiveMapByCharacterIds(characterIds);
  const gmStatusMap = await getGmStatusMapByCharacterIds(characterIds);

  return rows.map((row) => ({
    rank: Number(row.rank),
    characterId: Number(row.character_id),
    name: String(row.name),
    title: typeof row.title === 'string' ? row.title : '',
    monthCardActive: monthCardActiveMap.get(Number(row.character_id)) ?? false,
    isGm: gmStatusMap.get(Number(row.character_id)) ?? false,
    totalHoldingQty: Number(row.totalHoldingQty),
    totalMarketValueSpiritStones: Number(row.totalMarketValueSpiritStones),
    totalCostSpiritStones: Number(row.totalCostSpiritStones),
    unrealizedPnlSpiritStones: Number(row.unrealizedPnlSpiritStones),
    realizedPnlSpiritStones: Number(row.realizedPnlSpiritStones),
    totalPnlSpiritStones: Number(row.totalPnlSpiritStones),
  }));
};

// ============================================
// 收租排行 loader
// ============================================

const loadShopRentRanks = async (limit: number): Promise<ShopRentRankRow[]> => {
  const res = await query(
    `
      SELECT
        ROW_NUMBER() OVER (ORDER BY total_collected DESC, character_id ASC)::int AS rank,
        character_id,
        name,
        title,
        total_collected AS "totalRentCollected",
        shop_count AS "shopCount"
      FROM (
        SELECT
          c.id AS character_id,
          c.nickname AS name,
          c.title,
          SUM(s.total_rent_collected)::bigint / 100 AS total_collected,
          COUNT(*)::int AS shop_count
        FROM shop_detail s
        JOIN characters c ON c.id = s.character_id
        WHERE c.nickname IS NOT NULL AND c.nickname <> ''
        GROUP BY c.id, c.nickname, c.title
      ) sub
      ORDER BY rank
      LIMIT $1
    `,
    [limit],
  );

  const rows = res.rows as ShopRentRankQueryRow[];
  const characterIds = rows.map((row) => Number(row.character_id));
  const monthCardActiveMap = await getMonthCardActiveMapByCharacterIds(characterIds);
  const gmStatusMap = await getGmStatusMapByCharacterIds(characterIds);

  return rows.map((row) => ({
    rank: Number(row.rank),
    characterId: Number(row.character_id),
    name: String(row.name),
    title: typeof row.title === 'string' ? row.title : '',
    monthCardActive: monthCardActiveMap.get(Number(row.character_id)) ?? false,
    isGm: gmStatusMap.get(Number(row.character_id)) ?? false,
    totalRentCollected: Number(row.totalRentCollected),
    shopCount: Number(row.shopCount),
  }));
};

// ============================================
// 刮刮乐排行 loader
// ============================================

const loadScratchRanks = async (
  metric: ScratchRankMetric,
  limit: number,
): Promise<ScratchRankRow[]> => {
  const orderSql = SCRATCH_RANK_ORDER_SQL[metric];
  const res = await query(
    `
      WITH scratch_totals AS (
        SELECT
          character_id,
          COALESCE(SUM(prize_amount), 0)::bigint AS "totalPrizeAmount",
          COUNT(*)::int AS "settledCount",
          COUNT(*) FILTER (WHERE prize_tier = 'grand')::int AS "grandPrizeCount",
          COUNT(*) FILTER (WHERE prize_tier = 'regular_1')::int AS "firstPrizeCount"
        FROM scratch_ticket
        WHERE settled = true AND prize_amount IS NOT NULL
        GROUP BY character_id
      )
      SELECT
        ROW_NUMBER() OVER (ORDER BY ${orderSql})::int AS rank,
        c.id AS character_id,
        c.nickname AS name,
        c.title,
        COALESCE(t."totalPrizeAmount", 0)::bigint AS "totalPrizeAmount",
        COALESCE(t."settledCount", 0)::int AS "settledCount",
        COALESCE(t."grandPrizeCount", 0)::int AS "grandPrizeCount",
        COALESCE(t."firstPrizeCount", 0)::int AS "firstPrizeCount"
      FROM characters c
      JOIN scratch_totals t ON t.character_id = c.id
      WHERE c.nickname IS NOT NULL AND c.nickname <> ''
      ORDER BY rank
      LIMIT $1
    `,
    [limit],
  );

  const rows = res.rows as ScratchRankQueryRow[];
  const characterIds = rows.map((row) => Number(row.character_id));
  const monthCardActiveMap = await getMonthCardActiveMapByCharacterIds(characterIds);
  const gmStatusMap = await getGmStatusMapByCharacterIds(characterIds);

  return rows.map((row) => ({
    rank: Number(row.rank),
    characterId: Number(row.character_id),
    name: String(row.name),
    title: typeof row.title === 'string' ? row.title : '',
    monthCardActive: monthCardActiveMap.get(Number(row.character_id)) ?? false,
    isGm: gmStatusMap.get(Number(row.character_id)) ?? false,
    totalPrizeAmount: Number(row.totalPrizeAmount),
    settledCount: Number(row.settledCount),
    grandPrizeCount: Number(row.grandPrizeCount),
    firstPrizeCount: Number(row.firstPrizeCount),
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
  unrealizedProfit: createStockMarketRankCache('unrealizedProfit'),
  totalProfit: createStockMarketRankCache('totalProfit'),
  totalLoss: createStockMarketRankCache('totalLoss'),
};

const shopRentRankCache = createCacheLayer<number, ShopRentRankRow[]>({
  keyPrefix: 'rank:shop-rent:',
  redisTtlSec: RANK_CACHE_REDIS_TTL_SEC,
  memoryTtlMs: RANK_CACHE_MEMORY_TTL_MS,
  loader: loadShopRentRanks,
});

const createScratchRankCache = (
  metric: ScratchRankMetric,
) => createCacheLayer<number, ScratchRankRow[]>({
  keyPrefix: `rank:scratch:${metric}:`,
  redisTtlSec: RANK_CACHE_REDIS_TTL_SEC,
  memoryTtlMs: RANK_CACHE_MEMORY_TTL_MS,
  loader: (limit) => loadScratchRanks(metric, limit),
});

const scratchRankCaches: Record<ScratchRankMetric, ReturnType<typeof createScratchRankCache>> = {
  total: createScratchRankCache('total'),
  grandCount: createScratchRankCache('grandCount'),
  firstCount: createScratchRankCache('firstCount'),
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

export const getShopRentRanks = async (
  limit?: number,
): Promise<{ success: boolean; message: string; data?: ShopRentRankRow[] }> => {
  const l = clampLimit(limit, 50);
  const data = (await shopRentRankCache.get(l)) ?? [];
  return { success: true, message: 'ok', data };
};

export const getScratchRanks = async (
  metricRaw: string | null | undefined,
  limit?: number,
): Promise<{ success: boolean; message: string; data?: ScratchRankRow[] }> => {
  const metric = normalizeScratchRankMetric(metricRaw);
  if (!metric) {
    return { success: false, message: '刮刮乐排行维度不合法' };
  }

  const l = clampLimit(limit, 50);
  const data = (await scratchRankCaches[metric].get(l)) ?? [];
  return { success: true, message: 'ok', data };
};

// ============================================
// 无限刮刮乐（PuzzleCard）排行
// ============================================

export type PuzzleCardRankRow = {
  rank: number;
  characterId: number;
  name: string;
  title: string;
  monthCardActive: boolean;
  ticketCount: number;
  totalPurchase: number;
  totalPrize: number;
  netProfit: number;
};

type PuzzleCardRankQueryRow = {
  rank: number | string;
  character_id: number | string;
  name: string;
  title: string | null;
  ticketCount: number | string;
  totalPurchase: number | string;
  totalPrize: number | string;
  netProfit: number | string;
};

// ============================================
// 无限刮刮乐排行 loader
// ============================================

const loadPuzzleCardRanks = async (typeKey: string | null, limit: number): Promise<PuzzleCardRankRow[]> => {
  const typeFilter = typeKey ? 'WHERE type_key = $1' : '';
  const params = typeKey ? [typeKey, limit] : [limit];

  const res = await query(
    `
      WITH puzzle_totals AS (
        SELECT
          character_id,
          COUNT(*)::int AS "ticketCount",
          COALESCE(SUM(price_paid), 0)::bigint AS "totalPurchase",
          COALESCE(SUM(prize_amount), 0)::bigint AS "totalPrize",
          (COALESCE(SUM(prize_amount), 0) - COALESCE(SUM(price_paid), 0))::bigint AS "netProfit"
        FROM puzzle_card
        ${typeFilter}
        GROUP BY character_id
      ),
      ranked AS (
        SELECT
          ROW_NUMBER() OVER (ORDER BY t."netProfit" DESC, t."totalPrize" DESC, c.id ASC)::int AS rank,
          c.id AS character_id,
          c.nickname AS name,
          c.title,
          COALESCE(t."ticketCount", 0)::int AS "ticketCount",
          COALESCE(t."totalPurchase", 0)::bigint AS "totalPurchase",
          COALESCE(t."totalPrize", 0)::bigint AS "totalPrize",
          t."netProfit"
        FROM characters c
        JOIN puzzle_totals t ON t.character_id = c.id
        WHERE c.nickname IS NOT NULL AND c.nickname <> ''
      )
      SELECT * FROM ranked
      ORDER BY rank
      LIMIT $${typeKey ? 2 : 1}
    `,
    params,
  );

  const rows = res.rows as PuzzleCardRankQueryRow[];
  const characterIds = rows.map((row) => Number(row.character_id));
  const monthCardActiveMap = await getMonthCardActiveMapByCharacterIds(characterIds);

  return rows.map((row) => ({
    rank: Number(row.rank),
    characterId: Number(row.character_id),
    name: String(row.name),
    title: typeof row.title === 'string' ? row.title : '',
    monthCardActive: monthCardActiveMap.get(Number(row.character_id)) ?? false,
    ticketCount: Number(row.ticketCount),
    totalPurchase: Number(row.totalPurchase),
    totalPrize: Number(row.totalPrize),
    netProfit: Number(row.netProfit),
  }));
};

// ============================================
// 无限刮刮乐排行缓存
// ============================================

const createPuzzleCardRankCache = (
  typeKey: string | null,
) => createCacheLayer<number, PuzzleCardRankRow[]>({
  keyPrefix: `rank:puzzle-card:${typeKey ?? 'all'}:`,
  redisTtlSec: RANK_CACHE_REDIS_TTL_SEC,
  memoryTtlMs: RANK_CACHE_MEMORY_TTL_MS,
  loader: (limit) => loadPuzzleCardRanks(typeKey, limit),
});

const puzzleCardRankCaches: Record<string, ReturnType<typeof createPuzzleCardRankCache>> = {
  all: createPuzzleCardRankCache(null),
};

const getPuzzleCardRankCache = (typeKey: string | null) => {
  const key = typeKey ?? 'all';
  if (!puzzleCardRankCaches[key]) {
    puzzleCardRankCaches[key] = createPuzzleCardRankCache(typeKey);
  }
  return puzzleCardRankCaches[key];
};

export const getPuzzleCardRanks = async (
  typeKey: string | null,
  limit?: number,
): Promise<{ success: boolean; message: string; data?: PuzzleCardRankRow[] }> => {
  const l = clampLimit(limit, 50);
  const cache = getPuzzleCardRankCache(typeKey);
  const data = (await cache.get(l)) ?? [];
  return { success: true, message: 'ok', data };
};
