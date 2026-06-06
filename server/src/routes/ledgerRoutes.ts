/**
 * 灵石流水账 HTTP 路由。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供玩家自查流水接口、GM 查询玩家流水接口（分页）。
 * 2. 不做什么：不做流水写入（由 ledgerService.recordSpiritStones 在业务事务内调用）。
 *
 * 输入 / 输出：
 * - 输入：登录角色上下文（玩家）或 GM 鉴权、分页参数、过滤条件。
 * - 输出：标准 `{ success, data, message }` 响应。
 *
 * 数据流 / 状态流：
 * 前端请求 -> 路由鉴权 -> 调用 ledgerService -> 返回流水列表 + 分页信息。
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCharacter, requireGm } from '../middleware/auth.js';
import { createQpsLimitMiddleware } from '../middleware/qpsLimit.js';
import { sendSuccess } from '../middleware/response.js';
import { parseFiniteNumber, getSingleQueryValue } from '../services/shared/httpParam.js';
import { getOwnLedger, gmQueryLedger } from '../services/ledgerService.js';

const router: RouterType = Router();

const LEDGER_QPS_WINDOW_MS = 1000;
const LEDGER_QPS_LIMIT = 5;
const LEDGER_QPS_MESSAGE = '流水请求过于频繁，请稍后再试';
const LEDGER_GM_QPS_LIMIT = 3;

const createLedgerQpsLimit = (routeKey: string, limit: number) => createQpsLimitMiddleware({
  keyPrefix: `qps:ledger:${routeKey}`,
  limit,
  windowMs: LEDGER_QPS_WINDOW_MS,
  message: LEDGER_QPS_MESSAGE,
  resolveScope: (req) => req.userId!,
});

const ownLedgerQpsLimit = createLedgerQpsLimit('own', LEDGER_QPS_LIMIT);
const gmLedgerQpsLimit = createLedgerQpsLimit('gm', LEDGER_GM_QPS_LIMIT);

/**
 * 玩家查询自己的灵石流水。
 */
router.get('/my', requireCharacter, ownLedgerQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const page = parseFiniteNumber(getSingleQueryValue(req.query.page));
  const data = await getOwnLedger(characterId, page ?? 1);
  sendSuccess(res, data);
}));

/**
 * GM 查询玩家灵石流水（支持按角色ID、昵称、业务类型过滤）。
 */
router.get('/gm/query', requireGm, gmLedgerQpsLimit, asyncHandler(async (req, res) => {
  const characterIdParam = getSingleQueryValue(req.query.characterId);
  const characterId = characterIdParam != null ? parseFiniteNumber(characterIdParam) : undefined;
  const nicknameKeyword = getSingleQueryValue(req.query.nickname);
  const bizType = getSingleQueryValue(req.query.bizType);
  const page = parseFiniteNumber(getSingleQueryValue(req.query.page));

  const data = await gmQueryLedger({
    characterId: characterId ?? undefined,
    nicknameKeyword: typeof nicknameKeyword === 'string' ? nicknameKeyword.trim() : undefined,
    bizType: typeof bizType === 'string' ? bizType.trim() : undefined,
    page: page ?? 1,
  });
  sendSuccess(res, data);
}));

export default router;
