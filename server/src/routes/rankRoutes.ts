/**
 * 排行 HTTP 路由。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供财富排行、股市市值排行、股市收益排行 3 个 GET 接口。
 * 2. 不做什么：不做业务判断，只做鉴权、参数归一化，逻辑集中在 `rankService`。
 *
 * 输入 / 输出：
 * - 输入：`Authorization` Bearer Token，查询参数 `limit`（财富）/ `metric` + `limit`（股市）。
 * - 输出：标准 `{ success, data?, message }` 响应。
 *
 * 数据流 / 状态流：
 * 前端请求 → 本路由鉴权 + 解析参数 → `rankService` 查询（带双层缓存） → `sendResult` 返回。
 *
 * 复用设计说明：
 * - 路由层只做参数归一化，所有排序逻辑、SQL、缓存都在 service 层，避免前后端各自维护规则。
 * - 股市排行通过 `metric` 参数区分市值/收益，复用同一路由，不拆成两个端点。
 *
 * 关键边界条件与坑点：
 * 1. `metric` 参数对财富排行无意义，只在股市排行中生效。
 * 2. `limit` 非法时 service 层会用默认值 50 兜底，路由层不额外拦截。
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { getSingleQueryValue, parsePositiveInt } from '../services/shared/httpParam.js';
import { sendResult } from '../middleware/response.js';
import { getWealthRanks, getStockMarketRanks } from '../services/rankService.js';

const router = Router();

router.use(requireAuth);

router.get('/wealth', asyncHandler(async (req, res) => {
  const limit = parsePositiveInt(getSingleQueryValue(req.query.limit)) ?? undefined;
  const result = await getWealthRanks(limit);
  return sendResult(res, result);
}));

router.get('/stock-market', asyncHandler(async (req, res) => {
  const metric = getSingleQueryValue(req.query.metric);
  const limit = parsePositiveInt(getSingleQueryValue(req.query.limit)) ?? undefined;
  const result = await getStockMarketRanks(metric, limit);
  return sendResult(res, result);
}));

export default router;
