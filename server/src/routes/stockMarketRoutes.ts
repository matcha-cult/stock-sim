/**
 * 股市 HTTP 路由。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供股市概览、历史、交易记录、收益详情、买入、卖出和清仓接口。
 * 2. 不做什么：不在路由层重复手续费、持仓上限或 AI 行情规则。
 *
 * 输入 / 输出：
 * - 输入：登录角色上下文、股票 ID、交易数量、清仓范围、分页参数。
 * - 输出：标准 `{ success, data?, message }` 响应。
 *
 * 数据流 / 状态流：
 * 前端股市弹窗 -> 本路由解析轻量参数 -> `stockMarketService` -> DTO -> 必要时推送角色资源刷新。
 *
 * 复用设计说明：
 * - 路由只做鉴权、QPS 和参数归一化，所有业务判断集中到 service，避免前端和路由各自维护限制文案。
 * - 买入/卖出共用同一个 body 解析函数，减少 stockId/quantity 校验分叉。
 *
 * 关键边界条件与坑点：
 * 1. 买卖和清仓成功后需要推送角色刷新，否则灵石余额会滞后。
 * 2. 查询接口保持低 QPS 限制，避免玩家频繁刷新股市概览造成数据库压力。
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCharacter, requireGm } from '../middleware/auth.js';
import { createQpsLimitMiddleware } from '../middleware/qpsLimit.js';
import { safePushCharacterUpdate } from '../middleware/pushUpdate.js';
import { sendResult, sendSuccess } from '../middleware/response.js';
import { parseFiniteNumber, parseNonEmptyText, getSingleQueryValue } from '../services/shared/httpParam.js';
import { stockMarketService } from '../services/stockMarket/stockMarketService.js';
import { pendingOrderService } from '../services/stockMarket/pendingOrderService.js';
import {
  adjustSpiritStones,
  lookupCharacterInfo,
  type GmAdjustBizType,
} from '../services/inventory/gmSpiritStonesService.js';

const router: RouterType = Router();

const STOCK_MARKET_QPS_WINDOW_MS = 1000;
const STOCK_MARKET_QUERY_QPS_LIMIT = 5;
const STOCK_MARKET_MUTATION_QPS_LIMIT = 2;
// 玩家买入限流放宽到 5 次/秒，与查询类接口对齐（快速下单场景）
const STOCK_MARKET_BUY_QPS_LIMIT = 5;
const STOCK_MARKET_QPS_LIMIT_MESSAGE = '股市请求过于频繁，请稍后再试';

type StockMarketTradeBody = {
  stockId?: string | null;
  quantity?: string | number | null;
};

type StockMarketClearPositionBody = {
  stockId?: string | null;
};

const createStockMarketQpsLimit = (routeKey: string, limit: number) => createQpsLimitMiddleware({
  keyPrefix: `qps:stock-market:${routeKey}`,
  limit,
  windowMs: STOCK_MARKET_QPS_WINDOW_MS,
  message: STOCK_MARKET_QPS_LIMIT_MESSAGE,
  resolveScope: (req) => req.userId!,
});

const stockMarketOverviewQpsLimit = createStockMarketQpsLimit('overview', STOCK_MARKET_QUERY_QPS_LIMIT);
const stockMarketHistoryQpsLimit = createStockMarketQpsLimit('history', STOCK_MARKET_QUERY_QPS_LIMIT);
const stockMarketTradesQpsLimit = createStockMarketQpsLimit('trades', STOCK_MARKET_QUERY_QPS_LIMIT);
const stockMarketProfitDetailQpsLimit = createStockMarketQpsLimit('profit-detail', STOCK_MARKET_QUERY_QPS_LIMIT);
const stockMarketBuyQpsLimit = createStockMarketQpsLimit('buy', STOCK_MARKET_BUY_QPS_LIMIT);
const stockMarketSellQpsLimit = createStockMarketQpsLimit('sell', STOCK_MARKET_MUTATION_QPS_LIMIT);
const stockMarketClearQpsLimit = createStockMarketQpsLimit('clear', STOCK_MARKET_MUTATION_QPS_LIMIT);
const stockMarketNewsEventListQpsLimit = createStockMarketQpsLimit('news-event-list', STOCK_MARKET_QUERY_QPS_LIMIT);
const stockMarketNewsEventChainQpsLimit = createStockMarketQpsLimit('news-event-chain', STOCK_MARKET_QUERY_QPS_LIMIT);
const stockMarketCreatePendingOrderQpsLimit = createStockMarketQpsLimit('create-pending-order', STOCK_MARKET_MUTATION_QPS_LIMIT);
const stockMarketCancelPendingOrderQpsLimit = createStockMarketQpsLimit('cancel-pending-order', STOCK_MARKET_MUTATION_QPS_LIMIT);
const stockMarketListPendingOrdersQpsLimit = createStockMarketQpsLimit('list-pending-orders', STOCK_MARKET_QUERY_QPS_LIMIT);
const stockMarketGmPendingOrdersQpsLimit = createStockMarketQpsLimit('gm-pending-orders', STOCK_MARKET_QUERY_QPS_LIMIT);
const stockMarketGmCancelPendingOrderQpsLimit = createStockMarketQpsLimit('gm-cancel-pending-order', STOCK_MARKET_MUTATION_QPS_LIMIT);
const stockMarketGmSpiritStonesAdjustQpsLimit = createStockMarketQpsLimit('gm-spirit-stones-adjust', STOCK_MARKET_MUTATION_QPS_LIMIT);
const stockMarketGmCharacterLookupQpsLimit = createStockMarketQpsLimit('gm-character-lookup', STOCK_MARKET_QUERY_QPS_LIMIT);

const parseTradeBody = (body: StockMarketTradeBody): { stockId: string; quantity: number } | null => {
  const stockId = typeof body.stockId === 'string' ? body.stockId.trim() : '';
  const quantity = parseFiniteNumber(body.quantity ?? undefined);
  if (!stockId || quantity === undefined) return null;
  return {
    stockId,
    quantity,
  };
};

const parseClearPositionBody = (body: StockMarketClearPositionBody): { stockId: string | null } | null => {
  if (body.stockId === undefined || body.stockId === null) {
    return { stockId: null };
  }
  if (typeof body.stockId !== 'string') return null;
  const stockId = body.stockId.trim();
  return { stockId: stockId || null };
};

router.get('/overview', requireCharacter, stockMarketOverviewQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const data = await stockMarketService.getOverview(characterId);
  sendSuccess(res, data);
}));

router.get('/history', requireCharacter, stockMarketHistoryQpsLimit, asyncHandler(async (req, res) => {
  const stockId = parseNonEmptyText(getSingleQueryValue(req.query.stockId));
  if (!stockId) {
    sendResult(res, { success: false, message: 'stockId 参数无效' });
    return;
  }

  const result = await stockMarketService.getHistory(stockId);
  sendResult(res, result);
}));

router.get('/trades', requireCharacter, stockMarketTradesQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const page = parseFiniteNumber(getSingleQueryValue(req.query.page));
  const data = await stockMarketService.getTradeRecords(characterId, page ?? 1);
  sendSuccess(res, data);
}));

router.get('/profit-detail', requireCharacter, stockMarketProfitDetailQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const data = await stockMarketService.getProfitDetail(characterId);
  sendSuccess(res, data);
}));

router.post('/buy', requireCharacter, stockMarketBuyQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const body = parseTradeBody(req.body as StockMarketTradeBody);
  if (!body) {
    sendResult(res, { success: false, message: '买入参数无效' });
    return;
  }

  const result = await stockMarketService.buyStock({
    characterId,
    stockId: body.stockId,
    quantity: body.quantity,
  });
  if (result.success) {
    await safePushCharacterUpdate(req.userId!);
  }
  sendResult(res, result);
}));

router.post('/sell', requireCharacter, stockMarketSellQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const body = parseTradeBody(req.body as StockMarketTradeBody);
  if (!body) {
    sendResult(res, { success: false, message: '卖出参数无效' });
    return;
  }

  const result = await stockMarketService.sellStock({
    characterId,
    stockId: body.stockId,
    quantity: body.quantity,
  });
  if (result.success) {
    await safePushCharacterUpdate(req.userId!);
  }
  sendResult(res, result);
}));

router.post('/clear', requireCharacter, stockMarketClearQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const body = parseClearPositionBody(req.body as StockMarketClearPositionBody);
  if (!body) {
    sendResult(res, { success: false, message: '清仓参数无效' });
    return;
  }

  const result = await stockMarketService.clearPosition({
    characterId,
    stockId: body.stockId,
  });
  if (result.success) {
    await safePushCharacterUpdate(req.userId!);
  }
  sendResult(res, result);
}));

router.get('/news-events', requireGm, stockMarketNewsEventListQpsLimit, asyncHandler(async (req, res) => {
  const data = await stockMarketService.getNewsEventList();
  sendSuccess(res, data);
}));

router.get('/news-events/:eventId/chain', requireGm, stockMarketNewsEventChainQpsLimit, asyncHandler(async (req, res) => {
  const eventId = typeof req.params.eventId === 'string' ? req.params.eventId.trim() : '';
  if (!eventId) {
    sendResult(res, { success: false, message: 'eventId 参数无效' });
    return;
  }

  const data = await stockMarketService.getNewsEventChain(eventId);
  sendSuccess(res, data);
}));

// ---- 挂单 ----

type CreatePendingOrderBody = {
  stockId?: string | null;
  side?: string | null;
  quantity?: string | number | null;
  limitPrice?: string | number | null;
  triggerMode?: string | null;
};

const parseCreatePendingOrderBody = (body: CreatePendingOrderBody): {
  stockId: string;
  side: 'buy' | 'sell';
  quantity: number;
  limitPrice: number;
  triggerMode: 'normal' | 'premium' | undefined;
} | null => {
  const stockId = typeof body.stockId === 'string' ? body.stockId.trim() : '';
  const side = body.side === 'buy' || body.side === 'sell' ? body.side : null;
  const quantity = parseFiniteNumber(body.quantity ?? undefined);
  const limitPrice = parseFiniteNumber(body.limitPrice ?? undefined);
  const triggerMode = (body.triggerMode === 'normal' || body.triggerMode === 'premium')
    ? body.triggerMode
    : undefined;
  if (!stockId || !side || quantity === undefined || limitPrice === undefined) return null;
  return { stockId, side, quantity, limitPrice, triggerMode };
};

router.post('/pending-orders', requireCharacter, stockMarketCreatePendingOrderQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const parsed = parseCreatePendingOrderBody(req.body as CreatePendingOrderBody);
  if (!parsed) {
    sendResult(res, { success: false, message: '挂单参数无效' });
    return;
  }

  const result = await pendingOrderService.createOrder({
    characterId,
    stockId: parsed.stockId,
    side: parsed.side,
    quantity: parsed.quantity,
    limitPriceSpiritStones: parsed.limitPrice,
    triggerMode: parsed.triggerMode,
  });
  if (result.success) {
    await safePushCharacterUpdate(req.userId!);
  }
  sendResult(res, result);
}));

router.delete('/pending-orders/:orderId', requireCharacter, stockMarketCancelPendingOrderQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const orderId = parseFiniteNumber(typeof req.params.orderId === 'string' ? req.params.orderId : undefined);
  if (orderId === undefined) {
    sendResult(res, { success: false, message: '订单ID参数无效' });
    return;
  }

  const result = await pendingOrderService.cancelOrder(orderId, characterId);
  if (result.success) {
    await safePushCharacterUpdate(req.userId!);
  }
  sendResult(res, result);
}));

router.get('/pending-orders', requireCharacter, stockMarketListPendingOrdersQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const orders = await pendingOrderService.getActiveOrders(characterId);
  sendSuccess(res, { orders });
}));

// ---- GM 持仓查看与强制操作 ----

const gmHoldingsQpsLimit = createStockMarketQpsLimit('gm-holdings', STOCK_MARKET_QUERY_QPS_LIMIT);
const gmSellQpsLimit = createStockMarketQpsLimit('gm-sell', STOCK_MARKET_MUTATION_QPS_LIMIT);

router.get('/gm/holdings', requireGm, gmHoldingsQpsLimit, asyncHandler(async (req, res) => {
  const page = parseFiniteNumber(getSingleQueryValue(req.query.page));
  const pageSize = parseFiniteNumber(getSingleQueryValue(req.query.pageSize));
  const nickname = parseNonEmptyText(getSingleQueryValue(req.query.nickname));
  const cid = parseFiniteNumber(getSingleQueryValue(req.query.characterId));

  const data = await stockMarketService.gmGetAllHoldings({
    page: page ?? 1,
    pageSize: pageSize ?? 20,
    nickname: nickname ?? undefined,
    characterId: cid != null && Number.isFinite(cid) ? cid : undefined,
  });
  sendSuccess(res, data);
}));

router.get('/gm/holdings/:characterId', requireGm, gmHoldingsQpsLimit, asyncHandler(async (req, res) => {
  const characterId = parseFiniteNumber(typeof req.params.characterId === 'string' ? req.params.characterId : undefined);
  if (characterId === undefined) {
    sendResult(res, { success: false, message: 'characterId 参数无效' });
    return;
  }

  const data = await stockMarketService.gmGetCharacterHoldings(characterId);
  if (!data) {
    sendResult(res, { success: false, message: '角色不存在' });
    return;
  }
  sendSuccess(res, data);
}));

type GmForceSellBody = {
  stockId?: string | null;
  quantity?: string | number | null;
};

router.post('/gm/sell/:characterId', requireGm, gmSellQpsLimit, asyncHandler(async (req, res) => {
  const characterId = parseFiniteNumber(typeof req.params.characterId === 'string' ? req.params.characterId : undefined);
  if (characterId === undefined) {
    sendResult(res, { success: false, message: 'characterId 参数无效' });
    return;
  }

  const body = req.body as GmForceSellBody;
  const stockId = typeof body.stockId === 'string' ? body.stockId.trim() : '';
  if (!stockId) {
    sendResult(res, { success: false, message: 'stockId 参数无效' });
    return;
  }

  const quantity = parseFiniteNumber(body.quantity ?? undefined);
  const result = await stockMarketService.gmForceSellStock({
    characterId,
    stockId,
    quantity: quantity != null ? Math.max(1, Math.trunc(quantity)) : undefined,
  });
  if (result.success) {
    await safePushCharacterUpdate(req.userId!);
  }
  sendResult(res, result);
}));

// ---- GM 挂单管理 ----

router.get('/gm/pending-orders', requireGm, stockMarketGmPendingOrdersQpsLimit, asyncHandler(async (req, res) => {
  const page = parseFiniteNumber(getSingleQueryValue(req.query.page));
  const pageSize = parseFiniteNumber(getSingleQueryValue(req.query.pageSize));
  const nickname = parseNonEmptyText(getSingleQueryValue(req.query.nickname));
  const cid = parseFiniteNumber(getSingleQueryValue(req.query.characterId));
  const stockId = parseNonEmptyText(getSingleQueryValue(req.query.stockId));
  const sideRaw = getSingleQueryValue(req.query.side);
  const side = sideRaw === '' ? undefined : (sideRaw as 'buy' | 'sell');

  if (side !== undefined && side !== 'buy' && side !== 'sell') {
    sendResult(res, { success: false, message: 'side 参数无效' });
    return;
  }

  const data = await pendingOrderService.gmGetAllPendingOrders({
    page: page ?? 1,
    pageSize: pageSize ?? 20,
    nickname: nickname ?? undefined,
    characterId: cid != null && Number.isFinite(cid) ? cid : undefined,
    stockId: stockId ?? undefined,
    side,
  });
  sendSuccess(res, data);
}));

router.delete('/gm/pending-orders/:orderId', requireGm, stockMarketGmCancelPendingOrderQpsLimit, asyncHandler(async (req, res) => {
  const orderId = parseFiniteNumber(typeof req.params.orderId === 'string' ? req.params.orderId : undefined);
  if (orderId === undefined) {
    sendResult(res, { success: false, message: '订单ID参数无效' });
    return;
  }

  const result = await pendingOrderService.gmCancelOrder(orderId);
  sendResult(res, result);
}));

// ---- GM 灵石管理 ----

/**
 * GM 查询角色基本信息（昵称 + 当前余额）。
 */
router.get('/gm/character/:characterId', requireGm, stockMarketGmCharacterLookupQpsLimit, asyncHandler(async (req, res) => {
  const characterId = parseFiniteNumber(typeof req.params.characterId === 'string' ? req.params.characterId : undefined);
  if (characterId === undefined) {
    sendResult(res, { success: false, message: '角色ID参数无效' });
    return;
  }

  const info = await lookupCharacterInfo(characterId);
  if (!info) {
    sendResult(res, { success: false, message: '角色不存在' });
    return;
  }
  sendSuccess(res, info);
}));

/**
 * GM 调整灵石余额（单人或全体）。
 */
router.post('/gm/spirit-stones/adjust', requireGm, stockMarketGmSpiritStonesAdjustQpsLimit, asyncHandler(async (req, res) => {
  const body = req.body as Record<string, unknown>;

  const target = body.target;
  if (target !== 'single' && target !== 'all') {
    sendResult(res, { success: false, message: '调整目标必须为 single 或 all' });
    return;
  }

  const operation = body.operation;
  if (operation !== 'add' && operation !== 'reduce') {
    sendResult(res, { success: false, message: '操作类型必须为 add 或 reduce' });
    return;
  }

  const amount = parseFiniteNumber(body.amount);
  if (amount === undefined || !Number.isInteger(amount) || amount <= 0) {
    sendResult(res, { success: false, message: '调整数量必须为正整数' });
    return;
  }

  const bizType = body.bizType;
  if (bizType !== 'gm_compensation' && bizType !== 'gm_rebate') {
    sendResult(res, { success: false, message: '业务类型必须为 gm_compensation 或 gm_rebate' });
    return;
  }

  const characterId = parseFiniteNumber(body.characterId);
  if (target === 'single' && (characterId === undefined || characterId <= 0)) {
    sendResult(res, { success: false, message: '单人调整必须指定有效的角色ID' });
    return;
  }

  const memo = typeof body.memo === 'string' ? body.memo.trim() : '';

  const result = await adjustSpiritStones({
    target: target as 'single' | 'all',
    characterId: characterId ?? undefined,
    operation: operation as 'add' | 'reduce',
    amount,
    bizType: bizType as GmAdjustBizType,
    memo,
  });
  sendResult(res, result);
}));

export default router;
