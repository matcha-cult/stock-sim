/**
 * 刮刮乐 HTTP 路由。
 *
 * 作用：提供概览（当天票据）、刮格子、单张开奖的接口。
 * 路由只做鉴权、QPS 和参数归一化，业务逻辑集中在 service。
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCharacter } from '../middleware/auth.js';
import { createQpsLimitMiddleware } from '../middleware/qpsLimit.js';
import { sendSuccess } from '../middleware/response.js';
import { scratchTicketService } from '../services/scratchGame/scratchTicketService.js';
import { scratchPrizeConfigCache } from '../services/scratchGame/scratchPrizeConfigCache.js';

const router: RouterType = Router();

const SCRATCH_QPS_WINDOW_MS = 1000;
const SCRATCH_QUERY_QPS_LIMIT = 5;
const SCRATCH_MUTATION_QPS_LIMIT = 1;
const SCRATCH_QPS_LIMIT_MESSAGE = '刮刮乐请求过于频繁，请稍后再试';

const createScratchQpsLimit = (routeKey: string, limit: number) => createQpsLimitMiddleware({
  keyPrefix: `qps:scratch:${routeKey}`,
  limit,
  windowMs: SCRATCH_QPS_WINDOW_MS,
  message: SCRATCH_QPS_LIMIT_MESSAGE,
  resolveScope: (req) => req.userId!,
});

const scratchOverviewQpsLimit = createScratchQpsLimit('overview', SCRATCH_QUERY_QPS_LIMIT);
const scratchCellQpsLimit = createScratchQpsLimit('cell', SCRATCH_MUTATION_QPS_LIMIT);
const scratchSettleQpsLimit = createScratchQpsLimit('settle', SCRATCH_MUTATION_QPS_LIMIT);
const scratchResetQpsLimit = createScratchQpsLimit('reset', SCRATCH_MUTATION_QPS_LIMIT);
const scratchConfigQpsLimit = createQpsLimitMiddleware({
  keyPrefix: 'qps:scratch:config',
  limit: SCRATCH_QUERY_QPS_LIMIT,
  windowMs: SCRATCH_QPS_WINDOW_MS,
  message: SCRATCH_QPS_LIMIT_MESSAGE,
  resolveScope: (req) => req.ip ?? 'global',
});

// GET /api/scratch/overview — 获取当天票据概览
router.get('/overview', requireCharacter, scratchOverviewQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const data = await scratchTicketService.overview(characterId);
  sendSuccess(res, data);
}));

type ScratchCellBody = {
  ticketNumber?: number | null;
  cellIndex?: number | null;
};

// POST /api/scratch/scratch — 刮一个格子
router.post('/scratch', requireCharacter, scratchCellQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const body = req.body as ScratchCellBody;
  const ticketNumber = typeof body.ticketNumber === 'number' ? body.ticketNumber : null;
  const cellIndex = typeof body.cellIndex === 'number' ? body.cellIndex : null;

  if (ticketNumber === null || !Number.isInteger(ticketNumber) || ticketNumber < 1 || ticketNumber > 3) {
    res.status(400).json({ success: false, message: 'ticketNumber 必须为 1-3 的整数' });
    return;
  }
  if (cellIndex === null || !Number.isInteger(cellIndex) || cellIndex < 0) {
    res.status(400).json({ success: false, message: 'cellIndex 必须为非负整数' });
    return;
  }

  const data = await scratchTicketService.scratchCell(characterId, ticketNumber, cellIndex);
  sendSuccess(res, data);
}));

// POST /api/scratch/settle — 单张开奖
router.post('/settle', requireCharacter, scratchSettleQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const body = req.body as { ticketNumber?: unknown; lineKey?: unknown };

  const ticketNumber = typeof body.ticketNumber === 'number' ? body.ticketNumber : null;
  const lineKey = typeof body.lineKey === 'string' ? body.lineKey : null;

  if (ticketNumber === null || ticketNumber < 1 || ticketNumber > 3) {
    res.status(400).json({ success: false, message: 'ticketNumber 必须为 1-3 的整数' });
    return;
  }
  if (lineKey === null || !lineKey) {
    res.status(400).json({ success: false, message: 'lineKey 必须为有效字符串' });
    return;
  }

  const data = await scratchTicketService.settle(characterId, ticketNumber, lineKey);
  sendSuccess(res, data);
}));

// GET /api/scratch/config — 获取开奖规则配置（票类型、奖级、可选线）
router.get('/config', scratchConfigQpsLimit, asyncHandler(async (_req, res) => {
  const data = scratchPrizeConfigCache.getAllRules();
  sendSuccess(res, data);
}));

// POST /api/scratch/reset — 重置当天未开奖票
router.post('/reset', requireCharacter, scratchResetQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const data = await scratchTicketService.resetTickets(characterId);
  sendSuccess(res, { tickets: data });
}));

export default router;
