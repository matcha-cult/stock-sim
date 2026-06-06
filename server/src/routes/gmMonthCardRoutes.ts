/**
 * 月卡 GM 侧 HTTP 路由。
 *
 * 作用：提供 GM 发放月卡、回收月卡接口。
 * 路由只做鉴权（requireGm）、QPS 和参数归一化，业务逻辑集中在 service。
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireGm } from '../middleware/auth.js';
import { createQpsLimitMiddleware } from '../middleware/qpsLimit.js';
import { sendSuccess } from '../middleware/response.js';
import { monthCardService } from '../services/monthCard/monthCardService.js';

const router: RouterType = Router();

const GM_MONTH_CARD_QPS_WINDOW_MS = 1000;
const GM_MONTH_CARD_MUTATION_QPS_LIMIT = 1;
const GM_MONTH_CARD_QPS_LIMIT_MESSAGE = '操作过于频繁，请稍后再试';

const createGmMonthCardQpsLimit = (routeKey: string, limit: number) => createQpsLimitMiddleware({
  keyPrefix: `qps:gm-month-card:${routeKey}`,
  limit,
  windowMs: GM_MONTH_CARD_QPS_WINDOW_MS,
  message: GM_MONTH_CARD_QPS_LIMIT_MESSAGE,
  resolveScope: (req) => req.userId!,
});

const gmGrantQpsLimit = createGmMonthCardQpsLimit('grant', GM_MONTH_CARD_MUTATION_QPS_LIMIT);
const gmRevokeQpsLimit = createGmMonthCardQpsLimit('revoke', GM_MONTH_CARD_MUTATION_QPS_LIMIT);

type GmGrantBody = {
  characterId?: number | null;
  days?: number | null;
};

router.post('/grant', requireGm, gmGrantQpsLimit, asyncHandler(async (req, res) => {
  const body = req.body as GmGrantBody;
  const characterId = typeof body.characterId === 'number' ? body.characterId : null;
  const days = typeof body.days === 'number' ? body.days : undefined;

  if (characterId === null || !Number.isInteger(characterId) || characterId <= 0) {
    res.status(400).json({ success: false, message: 'characterId 必须为正整数' });
    return;
  }

  const data = await monthCardService.gmGrantMonthCard(characterId, days);
  sendSuccess(res, data);
}));

type GmRevokeBody = {
  characterId?: number | null;
};

router.post('/revoke', requireGm, gmRevokeQpsLimit, asyncHandler(async (req, res) => {
  const body = req.body as GmRevokeBody;
  const characterId = typeof body.characterId === 'number' ? body.characterId : null;

  if (characterId === null || !Number.isInteger(characterId) || characterId <= 0) {
    res.status(400).json({ success: false, message: 'characterId 必须为正整数' });
    return;
  }

  const data = await monthCardService.gmRevokeMonthCard(characterId);
  sendSuccess(res, data);
}));

export default router;
