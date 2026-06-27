/**
 * 行情数据 HTTP 路由。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：对外暴露行情快照 + 批量持仓查询 + 批量卖出接口，使用 sk- API key 鉴权。
 * 2. 不做什么：不处理玩家登录态、不暴露新闻/挂单能力。
 *
 * 输入 / 输出：
 * - 输入：Authorization: Bearer <sk-...> API key。
 * - 输出：标准 `{ success, data }` 响应。
 *
 * 数据流 / 状态流：
 * 外部系统 -> requireMarketDataApiKey -> QPS 限流 -> marketDataService -> DTO -> 响应
 *
 * 复用设计说明：
 * - 路由层只做鉴权 + QPS + 参数校验，所有业务逻辑集中在 marketDataService。
 * - QPS 限流复用现有 createQpsLimitMiddleware，scope 用 API key 独立计数。
 * - 每个接口独立的 QPS keyPrefix（quotes / portfolios / sell），互不影响。
 *
 * 关键边界条件与坑点：
 * 1. QPS scope 必须读到 req.marketDataApiKey（由 requireMarketDataApiKey 写入），
 *    因此中间件顺序：鉴权 -> QPS -> handler，顺序颠倒会让 scope 解析失败。
 * 2. 批量卖出每笔订单独立事务，路由层不做整体回滚；部分失败仍返回 200 + 每笔结果。
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireMarketDataApiKey } from '../middleware/marketDataAuth.js';
import { createQpsLimitMiddleware } from '../middleware/qpsLimit.js';
import { sendResult, sendSuccess } from '../middleware/response.js';
import { marketDataService } from '../services/marketData/marketDataService.js';

const router: RouterType = Router();

const MARKET_DATA_QPS_WINDOW_MS = 1000;
const MARKET_DATA_QUERY_QPS_LIMIT = 5;
// 批量卖出属于高频调用场景，独立限流桶，上限放宽到 10 次/秒/key
const MARKET_DATA_SELL_QPS_LIMIT = 10;
const MARKET_DATA_QPS_LIMIT_MESSAGE = '行情请求过于频繁，请稍后再试';

const quotesQpsLimit = createQpsLimitMiddleware({
  keyPrefix: 'qps:market-data:quotes',
  limit: MARKET_DATA_QUERY_QPS_LIMIT,
  windowMs: MARKET_DATA_QPS_WINDOW_MS,
  message: MARKET_DATA_QPS_LIMIT_MESSAGE,
  resolveScope: (req) => req.marketDataApiKey!,
});

const portfoliosQpsLimit = createQpsLimitMiddleware({
  keyPrefix: 'qps:market-data:portfolios',
  limit: MARKET_DATA_QUERY_QPS_LIMIT,
  windowMs: MARKET_DATA_QPS_WINDOW_MS,
  message: MARKET_DATA_QPS_LIMIT_MESSAGE,
  resolveScope: (req) => req.marketDataApiKey!,
});

router.get('/quotes', requireMarketDataApiKey, quotesQpsLimit, asyncHandler(async (_req, res) => {
  const data = await marketDataService.getCurrentMarket();
  sendSuccess(res, data);
}));

type PortfoliosRequestBody = {
  characterIds?: unknown;
};

const MAX_PORTFOLIOS_BATCH_SIZE = 100;

router.post('/portfolios', requireMarketDataApiKey, portfoliosQpsLimit, asyncHandler(async (req, res) => {
  const body = req.body as PortfoliosRequestBody;
  const rawCharacterIds = body.characterIds;

  if (!Array.isArray(rawCharacterIds) || rawCharacterIds.length <= 0) {
    sendResult(res, { success: false, message: 'characterIds 必须为非空数组' });
    return;
  }

  if (rawCharacterIds.length > MAX_PORTFOLIOS_BATCH_SIZE) {
    sendResult(res, {
      success: false,
      message: `单次查询上限 ${MAX_PORTFOLIOS_BATCH_SIZE} 个角色`,
    });
    return;
  }

  const characterIds: number[] = [];
  for (const rawId of rawCharacterIds) {
    const parsed = Number(rawId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      sendResult(res, { success: false, message: 'characterIds 元素必须为正整数' });
      return;
    }
    characterIds.push(parsed);
  }

  const data = await marketDataService.getCharacterPortfolios(characterIds);
  sendSuccess(res, data);
}));

const sellQpsLimit = createQpsLimitMiddleware({
  keyPrefix: 'qps:market-data:sell',
  limit: MARKET_DATA_SELL_QPS_LIMIT,
  windowMs: MARKET_DATA_QPS_WINDOW_MS,
  message: MARKET_DATA_QPS_LIMIT_MESSAGE,
  resolveScope: (req) => req.marketDataApiKey!,
});

type SellOrderItem = {
  characterId?: unknown;
  stockId?: unknown;
  quantity?: unknown;
};

type SellRequestBody = {
  orders?: unknown;
};

const MAX_SELL_BATCH_SIZE = 100;

router.post('/sell', requireMarketDataApiKey, sellQpsLimit, asyncHandler(async (req, res) => {
  const body = req.body as SellRequestBody;
  const rawOrders = body.orders;

  if (!Array.isArray(rawOrders) || rawOrders.length <= 0) {
    sendResult(res, { success: false, message: 'orders 必须为非空数组' });
    return;
  }

  if (rawOrders.length > MAX_SELL_BATCH_SIZE) {
    sendResult(res, {
      success: false,
      message: `单次卖出上限 ${MAX_SELL_BATCH_SIZE} 笔`,
    });
    return;
  }

  const orders: Array<{ characterId: number; stockId: string; quantity: number }> = [];
  for (let i = 0; i < rawOrders.length; i++) {
    const item = rawOrders[i] as SellOrderItem;
    const characterId = Number(item.characterId);
    if (!Number.isInteger(characterId) || characterId <= 0) {
      sendResult(res, { success: false, message: `orders[${i}].characterId 必须为正整数` });
      return;
    }
    const stockId = typeof item.stockId === 'string' ? item.stockId.trim() : '';
    if (!stockId) {
      sendResult(res, { success: false, message: `orders[${i}].stockId 必须为非空字符串` });
      return;
    }
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      sendResult(res, { success: false, message: `orders[${i}].quantity 必须为正整数` });
      return;
    }
    orders.push({ characterId, stockId, quantity });
  }

  const data = await marketDataService.batchSell(orders);
  sendSuccess(res, data);
}));

export default router;
