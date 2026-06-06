/**
 * 月卡玩家侧 HTTP 路由。
 *
 * 作用：提供月卡状态查询、每日奖励领取接口。
 * 路由只做鉴权、QPS 和参数归一化，业务逻辑集中在 service。
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCharacter } from '../middleware/auth.js';
import { createQpsLimitMiddleware } from '../middleware/qpsLimit.js';
import { sendSuccess } from '../middleware/response.js';
import { monthCardService } from '../services/monthCard/monthCardService.js';

const router: RouterType = Router();

const MONTH_CARD_QPS_WINDOW_MS = 1000;
const MONTH_CARD_QUERY_QPS_LIMIT = 5;
const MONTH_CARD_MUTATION_QPS_LIMIT = 1;
const MONTH_CARD_QPS_LIMIT_MESSAGE = '月卡请求过于频繁，请稍后再试';

const createMonthCardQpsLimit = (routeKey: string, limit: number) => createQpsLimitMiddleware({
  keyPrefix: `qps:month-card:${routeKey}`,
  limit,
  windowMs: MONTH_CARD_QPS_WINDOW_MS,
  message: MONTH_CARD_QPS_LIMIT_MESSAGE,
  resolveScope: (req) => req.userId!,
});

const monthCardStatusQpsLimit = createMonthCardQpsLimit('status', MONTH_CARD_QUERY_QPS_LIMIT);
const monthCardClaimQpsLimit = createMonthCardQpsLimit('claim', MONTH_CARD_MUTATION_QPS_LIMIT);

router.get('/status', requireCharacter, monthCardStatusQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const data = await monthCardService.getMonthCardStatus(characterId);
  sendSuccess(res, data);
}));

router.post('/claim-daily', requireCharacter, monthCardClaimQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const data = await monthCardService.claimDailyReward(characterId);
  sendSuccess(res, data);
}));

export default router;
