/**
 * 刮刮乐 HTTP 路由。
 *
 * 作用：提供获取当天彩票列表、刮格子、开奖的接口。
 * 路由只做鉴权、QPS 和参数归一化，业务逻辑集中在 service。
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCharacter } from '../middleware/auth.js';
import { createQpsLimitMiddleware } from '../middleware/qpsLimit.js';
import { sendSuccess } from '../middleware/response.js';
import { scratchTicketService } from '../services/scratchGame/scratchTicketService.js';

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

const scratchTicketQpsLimit = createScratchQpsLimit('ticket', SCRATCH_QUERY_QPS_LIMIT);
const scratchCellQpsLimit = createScratchQpsLimit('cell', SCRATCH_MUTATION_QPS_LIMIT);
const scratchSettleQpsLimit = createScratchQpsLimit('settle', SCRATCH_MUTATION_QPS_LIMIT);

router.get('/tickets', requireCharacter, scratchTicketQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const data = await scratchTicketService.getDayTickets(characterId);
  sendSuccess(res, data);
}));

type ScratchCellBody = {
  ticketNumber?: number | null;
  cellIndex?: number | null;
};

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

router.post('/settle', requireCharacter, scratchSettleQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const data = await scratchTicketService.settle(characterId);
  sendSuccess(res, data);
}));

export default router;
