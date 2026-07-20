/**
 * 锁妖窟路由
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供锁妖窟相关 HTTP 接口
 * 2. 不做什么：不处理业务逻辑（由 service 层处理）
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { parsePositiveInt, getSingleQueryValue } from '../services/shared/httpParam.js';
import { sendResult } from '../middleware/response.js';
import {
  getDemonCaveOverview,
  previewDemonCaveFloor,
  setDemonCaveBeastTeam,
  startDemonCaveChallenge,
  settleDemonCaveChallenge,
  abandonDemonCaveChallenge,
  startDemonCaveIdle,
  stopDemonCaveIdle,
  getDemonCaveIdleHistory,
  getIdleBattleLogs,
  getIdleBattleLogDetail,
  testBattle,
} from '../services/demonCave/service.js';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/demon-cave/overview
 * 获取锁妖窟概览（进度 + 当前层预览）
 */
router.get('/overview', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  return sendResult(res, await getDemonCaveOverview(userId));
}));

/**
 * GET /api/demon-cave/floor-preview?floor=N
 * 预览指定楼层的怪物组合
 */
router.get('/floor-preview', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const floor = parsePositiveInt(getSingleQueryValue(req.query.floor)) ?? 1;
  return sendResult(res, await previewDemonCaveFloor(userId, floor));
}));

/**
 * POST /api/demon-cave/set-beast-team
 * 设置出战灵兽队伍
 */
router.post('/set-beast-team', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const { beastIds } = req.body as { beastIds: number[] };

  if (!Array.isArray(beastIds) || beastIds.length === 0 || beastIds.length > 4) {
    return sendResult(res, { success: false, message: '灵兽队伍数量必须在 1-4 只之间' });
  }

  return sendResult(res, await setDemonCaveBeastTeam(userId, beastIds));
}));

/**
 * POST /api/demon-cave/challenge/start
 * 开始挑战指定层（默认当前层）
 */
router.post('/challenge/start', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const { floor } = req.body as { floor?: number };
  return sendResult(res, await startDemonCaveChallenge(userId, floor));
}));

/**
 * POST /api/demon-cave/challenge/settle
 * 结算挑战结果（战斗结果由服务端计算）
 */
router.post('/challenge/settle', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const { runId } = req.body as { runId: string };

  if (!runId) {
    return sendResult(res, { success: false, message: '参数错误' });
  }

  return sendResult(res, await settleDemonCaveChallenge(userId, runId));
}));

/**
 * POST /api/demon-cave/challenge/abandon
 * 放弃当前挑战（清理 currentRunId）
 */
router.post('/challenge/abandon', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  return sendResult(res, await abandonDemonCaveChallenge(userId));
}));

/**
 * POST /api/demon-cave/idle/start
 * 开始挂机
 */
router.post('/idle/start', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const { floor } = req.body as { floor: number };

  if (!floor || typeof floor !== 'number') {
    return sendResult(res, { success: false, message: '参数错误' });
  }

  return sendResult(res, await startDemonCaveIdle(userId, floor));
}));

/**
 * POST /api/demon-cave/idle/stop
 * 停止挂机
 */
router.post('/idle/stop', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  return sendResult(res, await stopDemonCaveIdle(userId));
}));

/**
 * GET /api/demon-cave/idle/history
 * 获取挂机历史记录
 */
router.get('/idle/history', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const limit = parsePositiveInt(getSingleQueryValue(req.query.limit)) ?? 20;
  const offset = parsePositiveInt(getSingleQueryValue(req.query.offset)) ?? 0;
  return sendResult(res, await getDemonCaveIdleHistory(userId, limit, offset));
}));

/**
 * GET /api/demon-cave/idle/battle-logs/:historyId?limit=20&offset=0
 * 获取挂机战斗日志（分页 + 倒序）
 */
router.get('/idle/battle-logs/:historyId', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const historyId = parsePositiveInt(req.params.historyId);
  const limit = parsePositiveInt(getSingleQueryValue(req.query.limit)) ?? 20;
  const offset = parsePositiveInt(getSingleQueryValue(req.query.offset)) ?? 0;

  if (!historyId) {
    return sendResult(res, { success: false, message: '参数错误' });
  }

  return sendResult(res, await getIdleBattleLogs(userId, historyId, limit, offset));
}));

/**
 * GET /api/demon-cave/idle/battle-log/:battleLogId
 * 获取单场战斗的详细日志
 */
router.get('/idle/battle-log/:battleLogId', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const battleLogId = parsePositiveInt(req.params.battleLogId);

  if (!battleLogId) {
    return sendResult(res, { success: false, message: '参数错误' });
  }

  return sendResult(res, await getIdleBattleLogDetail(userId, battleLogId));
}));

/**
 * GET /api/demon-cave/drop-logs/:historyId
 * 获取指定挂机历史的掉落记录
 */
router.get('/drop-logs/:historyId', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const historyId = parsePositiveInt(req.params.historyId);

  if (!historyId) {
    return sendResult(res, { success: false, message: '参数错误' });
  }

  const { getDropLogsByHistoryId } = await import('../services/demonCave/dropService.js');
  return sendResult(res, {
    success: true,
    data: await getDropLogsByHistoryId(historyId),
  });
}));

/**
 * GET /api/demon-cave/recent-drop-logs?limit=20&offset=0
 * 获取角色最近的掉落记录
 */
router.get('/recent-drop-logs', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const limit = parsePositiveInt(getSingleQueryValue(req.query.limit)) ?? 20;
  const offset = parsePositiveInt(getSingleQueryValue(req.query.offset)) ?? 0;

  const { getRecentDropLogs } = await import('../services/demonCave/dropService.js');
  const { getCharacterIdByUserId } = await import('../services/shared/characterId.js');
  const characterId = await getCharacterIdByUserId(userId);
  if (!characterId) {
    return sendResult(res, { success: false, message: '角色不存在' });
  }

  return sendResult(res, {
    success: true,
    data: await getRecentDropLogs(characterId, limit, offset),
  });
}));

/**
 * GET /api/demon-cave/test-battle?floor=N
 * 测试战斗（输出完整战斗信息）
 */
router.get('/test-battle', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const floor = parsePositiveInt(getSingleQueryValue(req.query.floor)) ?? undefined;
  return sendResult(res, await testBattle(userId, floor));
}));

export default router;
