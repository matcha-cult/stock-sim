/**
 * 行情数据 service（对外 API 专用）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：向持有 sk- API key 的外部系统提供当前股市行情快照 + 交易规则 + 下次刷新时间；批量查询指定角色的持仓 + 灵石余额；批量卖出指定角色的指定股票。
 * 2. 不做什么：不涉及新闻/挂单/下单逻辑；不修改行情数据。
 *
 * 输入 / 输出：
 * - getCurrentMarket()：无输入，返回行情快照 DTO。
 * - getCharacterPortfolios(characterIds)：角色 ID 数组，返回批量持仓 DTO。
 * - batchSell(orders)：卖出订单数组（characterId + stockId + quantity），返回逐订单结果。
 *
 * 数据流 / 状态流：
 * 调用方 -> getCurrentMarket()
 *   -> stockMarketService.ensureInitialQuotes() 保证 quote 行存在（首次启动兜底）
 *   -> 一次 SELECT 拿到全部启用股票的最新报价
 *   -> 与静态定义合并成 DTO -> 返回
 *
 * 调用方 -> getCharacterPortfolios(characterIds)
 *   -> stockMarketService.ensureInitialQuotes() 保证 quote 行存在
 *   -> 并行查询 characters + character_stock_holding + stock_market_quote
 *   -> 组装每个角色的持仓 DTO + 灵石余额 -> 返回
 *
 * 调用方 -> batchSell(orders)
 *   -> 逐订单调用 stockMarketService.sellStock（自带 @Transactional 事务）
 *   -> 单订单失败不影响其他订单（独立事务边界）
 *   -> 收集每笔订单的 success/message/filledQuantity 返回
 *
 * 复用设计说明：
 * - 不重复实现"确保初始报价"，复用 stockMarketService.ensureInitialQuotes()，避免双写 quote 初始化逻辑。
 * - 交易规则 / 下次刷新时间直接复用 stockMarketRules/stockMarketTime 的导出函数，保证与玩家端一致。
 * - 批量卖出直接复用 stockMarketService.sellStock（含完整校验 + 事务），不在本 service 重写卖出逻辑。
 *
 * 关键边界条件与坑点：
 * 1. 若 stock_market_quote 中缺少某只股票的报价行，使用静态定义的 initial_price 作为兜底，
 *    避免因 ensureInitialQuotes 未跑完而返回 null 价格。
 * 2. updated_at 在 quote 缺失时使用 0，外部系统可据此识别"尚未产生过 tick"的股票。
 * 3. 批量持仓查询中，不存在的 characterId 会被静默忽略（不返回），避免外部系统误判"角色存在但无持仓"。
 * 4. batchSell 每个订单独立事务，不会因某一笔失败回滚其他成功的订单；
 *    filledQuantity 在失败订单中为 0，成功订单中为 stockMarketService.sellStock 返回的实际成交量。
 */
import { query } from '../../config/database.js';
import { stockMarketService } from '../stockMarket/stockMarketService.js';
import {
  getEnabledStockDefinitions,
  type StockMarketDefinition,
} from '../stockMarket/stockMarketDefinitions.js';
import {
  stockMarketPriceUnitsToSpiritStones,
  stockMarketPriceToStorageUnits,
  buildStockMarketTradeRulesDto,
  calculateStockMarketMarketValue,
  calculateStockMarketLimitPrices,
  detectStockMarketLimitStatus,
} from '../stockMarket/stockMarketRules.js';
import { getNextStockMarketRefreshAt } from '../stockMarket/stockMarketTime.js';

type MarketDataQuoteRow = {
  stock_id: string;
  current_price_spirit_stones: string | number | bigint;
  last_change_bps: string | number;
  updated_at: Date | string;
};

export type MarketDataStockDto = {
  stockId: string;
  code: string;
  name: string;
  shortName: string;
  sector: string;
  description: string;
  priceSpiritStones: number;
  lastChangeBps: number;
  limitStatus: 'up' | 'down' | 'none';
  updatedAt: number;
};

export type MarketDataTradeRulesDto = ReturnType<typeof buildStockMarketTradeRulesDto>;

export type MarketDataQuotesDto = {
  stocks: MarketDataStockDto[];
  tradeRules: MarketDataTradeRulesDto;
  nextRefreshAt: number;
};

type CharacterRow = {
  id: string | number;
  nickname: string;
  spirit_stones: string | number | bigint;
};

type CharacterHoldingRow = {
  character_id: string | number;
  stock_id: string;
  quantity: string | number;
  frozen_quantity: string | number;
  total_cost_spirit_stones: string | number | bigint;
};

export type CharacterHoldingDto = {
  stockId: string;
  stockCode: string;
  stockName: string;
  quantity: number;
  frozenQuantity: number;
  averageCostSpiritStones: number;
  currentPriceSpiritStones: number;
  marketValueSpiritStones: number;
  unrealizedPnlSpiritStones: number;
};

export type CharacterPortfolioDto = {
  characterId: number;
  nickname: string;
  spiritStonesBalance: number;
  holdings: CharacterHoldingDto[];
  totalMarketValueSpiritStones: number;
  totalUnrealizedPnlSpiritStones: number;
};

export type CharacterPortfoliosDto = {
  portfolios: CharacterPortfolioDto[];
};

export type BatchSellOrder = {
  characterId: number;
  stockId: string;
  quantity: number;
};

export type BatchSellResultDetail = {
  characterId: number;
  stockId: string;
  quantity: number;
  success: boolean;
  message: string;
  filledQuantity: number;
};

export type BatchSellResultDto = {
  results: BatchSellResultDetail[];
};

const toBigIntValue = (value: string | number | bigint): bigint => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  const trimmed = value.trim();
  return trimmed.length > 0 ? BigInt(trimmed) : 0n;
};

const toIntValue = (value: string | number | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

const toDtoNumber = (value: bigint): number => {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized)) {
    throw new Error('数值超过前端安全整数范围');
  }
  return normalized;
};

const toTimestampMillis = (value: Date | string): number => {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
};

const buildStockDto = (
  definition: StockMarketDefinition,
  row: MarketDataQuoteRow | undefined,
): MarketDataStockDto => {
  const priceUnits = row
    ? toBigIntValue(row.current_price_spirit_stones)
    : BigInt(Math.round(definition.initial_price_spirit_stones * 100));
  const initialPriceUnits = stockMarketPriceToStorageUnits(definition.initial_price_spirit_stones);
  const { limitUpPrice, limitDownPrice } = calculateStockMarketLimitPrices(initialPriceUnits);
  const limitStatus = detectStockMarketLimitStatus(priceUnits, limitUpPrice, limitDownPrice);
  return {
    stockId: definition.id,
    code: definition.code,
    name: definition.name,
    shortName: definition.short_name ?? definition.name,
    sector: definition.sector,
    description: definition.description ?? '',
    priceSpiritStones: stockMarketPriceUnitsToSpiritStones(priceUnits),
    lastChangeBps: row ? Number(row.last_change_bps) : 0,
    limitStatus,
    updatedAt: row ? toTimestampMillis(row.updated_at) : 0,
  };
};

class MarketDataService {
  async getCurrentMarket(): Promise<MarketDataQuotesDto> {
    await stockMarketService.ensureInitialQuotes();

    const definitions = getEnabledStockDefinitions();
    if (definitions.length <= 0) {
      return {
        stocks: [],
        tradeRules: buildStockMarketTradeRulesDto(),
        nextRefreshAt: getNextStockMarketRefreshAt().getTime(),
      };
    }

    const quoteResult = await query<MarketDataQuoteRow>(
      `
        SELECT stock_id, current_price_spirit_stones, last_change_bps, updated_at
        FROM stock_market_quote
        WHERE stock_id = ANY($1::text[])
      `,
      [definitions.map((definition) => definition.id)],
    );

    const quoteByStockId = new Map(
      quoteResult.rows.map((row) => [row.stock_id, row] as const),
    );

    return {
      stocks: definitions.map((definition) =>
        buildStockDto(definition, quoteByStockId.get(definition.id)),
      ),
      tradeRules: buildStockMarketTradeRulesDto(),
      nextRefreshAt: getNextStockMarketRefreshAt().getTime(),
    };
  }

  /**
   * 批量查询指定角色的持仓 + 灵石余额。
   * 不存在的 characterId 会被静默忽略。
   */
  async getCharacterPortfolios(
    characterIds: readonly number[],
  ): Promise<CharacterPortfoliosDto> {
    if (characterIds.length <= 0) {
      return { portfolios: [] };
    }

    await stockMarketService.ensureInitialQuotes();

    const validCharacterIds = characterIds.filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    if (validCharacterIds.length <= 0) {
      return { portfolios: [] };
    }

    const [charResult, holdingResult, quoteResult] = await Promise.all([
      query<CharacterRow>(
        `SELECT id, nickname, spirit_stones FROM characters WHERE id = ANY($1::int[])`,
        [validCharacterIds],
      ),
      query<CharacterHoldingRow>(
        `
          SELECT character_id, stock_id, quantity, frozen_quantity, total_cost_spirit_stones
          FROM character_stock_holding
          WHERE character_id = ANY($1::int[]) AND quantity > 0
          ORDER BY character_id, stock_id
        `,
        [validCharacterIds],
      ),
      query<MarketDataQuoteRow>(
        `
          SELECT stock_id, current_price_spirit_stones, last_change_bps, updated_at
          FROM stock_market_quote
          WHERE stock_id IN (
            SELECT DISTINCT stock_id FROM character_stock_holding
            WHERE character_id = ANY($1::int[]) AND quantity > 0
          )
        `,
        [validCharacterIds],
      ),
    ]);

    const charById = new Map(
      charResult.rows.map((row) => [Number(row.id), row] as const),
    );

    const quoteByStockId = new Map(
      quoteResult.rows.map((row) => [row.stock_id, row] as const),
    );

    const definitionMap = new Map(
      getEnabledStockDefinitions().map((def) => [def.id, def] as const),
    );

    const holdingsByCharacterId = new Map<number, CharacterHoldingDto[]>();
    for (const row of holdingResult.rows) {
      const characterId = Number(row.character_id);
      const definition = definitionMap.get(row.stock_id);
      if (!definition) continue;

      const quantity = toIntValue(row.quantity);
      const frozenQuantity = toIntValue(row.frozen_quantity);
      const totalCost = toBigIntValue(row.total_cost_spirit_stones);

      const quoteRow = quoteByStockId.get(row.stock_id);
      const currentPriceUnits = quoteRow
        ? toBigIntValue(quoteRow.current_price_spirit_stones)
        : BigInt(Math.round(definition.initial_price_spirit_stones * 100));

      // totalCost 已经是灵石单位，直接除 quantity 得到平均成本（灵石）
      const averageCost = quantity > 0 ? toDtoNumber(totalCost / BigInt(quantity)) : 0;
      // 市值需要用 calculateStockMarketMarketValue 处理单位转换
      const marketValue = calculateStockMarketMarketValue(currentPriceUnits, quantity);
      const unrealizedPnl = toDtoNumber(marketValue - totalCost);

      const holding: CharacterHoldingDto = {
        stockId: row.stock_id,
        stockCode: definition.code,
        stockName: definition.name,
        quantity,
        frozenQuantity,
        averageCostSpiritStones: averageCost,
        currentPriceSpiritStones: stockMarketPriceUnitsToSpiritStones(currentPriceUnits),
        marketValueSpiritStones: toDtoNumber(marketValue),
        unrealizedPnlSpiritStones: unrealizedPnl,
      };

      const existing = holdingsByCharacterId.get(characterId) ?? [];
      existing.push(holding);
      holdingsByCharacterId.set(characterId, existing);
    }

    const portfolios: CharacterPortfolioDto[] = [];
    for (const [characterId, charRow] of charById) {
      const holdings = holdingsByCharacterId.get(characterId) ?? [];
      const totalMarketValue = holdings.reduce((sum, h) => sum + h.marketValueSpiritStones, 0);
      const totalUnrealizedPnl = holdings.reduce((sum, h) => sum + h.unrealizedPnlSpiritStones, 0);

      portfolios.push({
        characterId,
        nickname: charRow.nickname ?? `修士${characterId}`,
        spiritStonesBalance: toDtoNumber(toBigIntValue(charRow.spirit_stones)),
        holdings,
        totalMarketValueSpiritStones: totalMarketValue,
        totalUnrealizedPnlSpiritStones: totalUnrealizedPnl,
      });
    }

    return { portfolios };
  }

  /**
   * 批量卖出指定角色的指定股票。
   * 每个订单独立调用 stockMarketService.sellStock（自带事务），单订单失败不影响其他订单。
   */
  async batchSell(orders: readonly BatchSellOrder[]): Promise<BatchSellResultDto> {
    const results: BatchSellResultDetail[] = [];
    for (const order of orders) {
      const sellResult = await stockMarketService.sellStock({
        characterId: order.characterId,
        stockId: order.stockId,
        quantity: order.quantity,
      });
      results.push({
        characterId: order.characterId,
        stockId: order.stockId,
        quantity: order.quantity,
        success: sellResult.success,
        message: sellResult.message,
        filledQuantity: sellResult.success ? (sellResult.data?.filledQuantity ?? 0) : 0,
      });
    }
    return { results };
  }
}

export const marketDataService = new MarketDataService();
