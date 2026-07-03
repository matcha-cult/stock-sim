/**
 * 常驻刮刮乐 HTTP 路由。
 *
 * 作用：提供购票、批量购票、兑奖、兑奖历史接口。
 * 路由只做鉴权、QPS 和参数归一化，业务逻辑集中在 puzzleCardService。
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCharacter } from '../middleware/auth.js';
import { createQpsLimitMiddleware } from '../middleware/qpsLimit.js';
import { sendSuccess } from '../middleware/response.js';
import { puzzleCardService } from '../services/puzzleCard/puzzleCardService.js';

const router: RouterType = Router();

const QPS_WINDOW_MS = 5000;
const QUERY_QPS_LIMIT = 5;
const MUTATION_QPS_LIMIT = 2;
const QPS_MESSAGE = '操作过于频繁，请稍后再试';

const createQps = (routeKey: string, limit: number) => createQpsLimitMiddleware({
  keyPrefix: `qps:puzzle:${routeKey}`,
  limit,
  windowMs: QPS_WINDOW_MS,
  message: QPS_MESSAGE,
  resolveScope: (req) => req.userId!,
});

const purchaseQps = createQps('purchase', MUTATION_QPS_LIMIT);
const batchPurchaseQps = createQps('batch-purchase', MUTATION_QPS_LIMIT);
const redeemQps = createQps('redeem', MUTATION_QPS_LIMIT);
const historyQps = createQps('history', QUERY_QPS_LIMIT);

// POST /api/puzzle-card/purchase — 购票
router.post('/purchase', requireCharacter, purchaseQps, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const body = req.body as { typeKey?: unknown };
  const typeKey = typeof body.typeKey === 'string' ? body.typeKey : null;

  if (!typeKey) {
    res.status(400).json({ success: false, message: 'typeKey 不能为空' });
    return;
  }

  const data = await puzzleCardService.purchase(characterId, typeKey);
  sendSuccess(res, data);
}));

// POST /api/puzzle-card/batch-purchase — 批量购票
router.post('/batch-purchase', requireCharacter, batchPurchaseQps, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const body = req.body as { typeKey?: unknown };
  const typeKey = typeof body.typeKey === 'string' ? body.typeKey : null;

  if (!typeKey) {
    res.status(400).json({ success: false, message: 'typeKey 不能为空' });
    return;
  }

  const data = await puzzleCardService.batchPurchase(characterId, typeKey);
  sendSuccess(res, data);
}));

// POST /api/puzzle-card/redeem — 兑奖
router.post('/redeem', requireCharacter, redeemQps, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const body = req.body as { ticketId?: unknown; redeemCode?: unknown };
  const ticketId = typeof body.ticketId === 'number' ? body.ticketId : null;
  const redeemCode = typeof body.redeemCode === 'string' ? body.redeemCode : null;

  if (ticketId === null || !Number.isInteger(ticketId) || ticketId < 1) {
    res.status(400).json({ success: false, message: 'ticketId 必须为正整数' });
    return;
  }
  if (!redeemCode) {
    res.status(400).json({ success: false, message: 'redeemCode 不能为空' });
    return;
  }

  const data = await puzzleCardService.redeem(characterId, ticketId, redeemCode);
  sendSuccess(res, data);
}));

// GET /api/puzzle-card/history — 兑奖历史
router.get('/history', requireCharacter, historyQps, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const page = typeof req.query.page === 'string' ? Number(req.query.page) : 1;
  const data = await puzzleCardService.getHistory(characterId, page);
  sendSuccess(res, data);
}));

export default router;
