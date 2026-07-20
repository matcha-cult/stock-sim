/**
 * GM 灵田管理路由。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供 GM 按角色 ID 或昵称查询指定玩家灵田总览与活动日志的只读接口，
 *    以及为指定角色直接添加种子 / 灵材的写入接口。
 * 2. 不做什么：不做权限分级（由 requireGm 中间件保证 GM 身份）。
 *
 * 数据流 / 状态流：
 * 前端请求 → 本路由解析参数 → gmFarmService → 返回 DTO。
 *
 * 复用设计说明：
 * - 路由层只做鉴权 / QPS / 参数归一化，业务逻辑全部集中在 gmFarmService。
 * - 复用 farmService 已有的 getFarmOverview / getFarmStaticConfig / getFarmLog，
 *   避免在 GM 侧重复实现 DTO 构建。
 *
 * 关键边界条件与坑点：
 * 1. characterId 与 nickname 二选一即可；characterId 优先。
 * 2. 都未提供返回 400，匹配不到返回 404。
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireGm } from '../middleware/auth.js';
import { createQpsLimitMiddleware } from '../middleware/qpsLimit.js';
import { sendSuccess } from '../middleware/response.js';
import { parsePositiveInt, parseNonEmptyText } from '../services/shared/httpParam.js';
import * as gmFarmService from '../services/farm/gmFarmService.js';
import type { CropQuality } from '../services/farm/farmTypes.js';

const router: RouterType = Router();

const QPS_WINDOW_MS = 1000;
const QPS_MESSAGE = '请求过于频繁，请稍后再试';

const createGmFarmQpsLimit = (routeKey: string, limit: number) =>
  createQpsLimitMiddleware({
    keyPrefix: `qps:gm-farm:${routeKey}`,
    limit,
    windowMs: QPS_WINDOW_MS,
    message: QPS_MESSAGE,
    resolveScope: (req) => req.userId!,
  });

const overviewQpsLimit = createGmFarmQpsLimit('overview', 10);
const logQpsLimit = createGmFarmQpsLimit('log', 10);
const addSeedQpsLimit = createGmFarmQpsLimit('add-seed', 10);
const addHarvestQpsLimit = createGmFarmQpsLimit('add-harvest', 10);
const addAllHarvestQpsLimit = createGmFarmQpsLimit('add-all-harvest', 2);

function parseLookupParams(query: Record<string, unknown>): gmFarmService.GmFarmLookupParams | { error: string } {
  const characterId = parsePositiveInt(query?.characterId);
  const nickname = parseNonEmptyText(query?.nickname as string | string[] | undefined | null) ?? undefined;

  if ((characterId == null || characterId <= 0) && !nickname) {
    return { error: 'characterId 或 nickname 至少提供一个' };
  }

  return {
    characterId: characterId != null && characterId > 0 ? characterId : undefined,
    nickname,
  };
}

// ==================== 灵田总览 ====================

router.get(
  '/overview',
  requireGm,
  overviewQpsLimit,
  asyncHandler(async (req, res) => {
    const params = parseLookupParams(req.query as Record<string, unknown>);
    if ('error' in params) {
      res.status(400).json({ success: false, message: params.error });
      return;
    }

    const result = await gmFarmService.getGmFarmOverview(params);
    if (result == null) {
      res.status(404).json({ success: false, message: '角色不存在' });
      return;
    }
    sendSuccess(res, result);
  }),
);

// ==================== 活动日志 ====================

router.get(
  '/log',
  requireGm,
  logQpsLimit,
  asyncHandler(async (req, res) => {
    const params = parseLookupParams(req.query as Record<string, unknown>);
    if ('error' in params) {
      res.status(400).json({ success: false, message: params.error });
      return;
    }
    const page = parsePositiveInt(req.query?.page) ?? 1;
    const pageSize = parsePositiveInt(req.query?.pageSize) ?? 20;

    const result = await gmFarmService.getGmFarmLog(params, page, pageSize);
    if (result == null) {
      res.status(404).json({ success: false, message: '角色不存在' });
      return;
    }
    sendSuccess(res, result);
  }),
);

// ==================== 添加种子 ====================

router.post(
  '/add-seed',
  requireGm,
  addSeedQpsLimit,
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const lookupParams = parseLookupParams({
      characterId: body.characterId,
      nickname: body.nickname,
    });
    if ('error' in lookupParams) {
      res.status(400).json({ success: false, message: lookupParams.error });
      return;
    }

    const itemId = parseNonEmptyText(body.itemId as string | string[] | undefined | null);
    if (!itemId) {
      res.status(400).json({ success: false, message: 'itemId 不能为空' });
      return;
    }

    const quantity = parsePositiveInt(body.quantity);
    if (quantity == null) {
      res.status(400).json({ success: false, message: 'quantity 必须为正整数' });
      return;
    }

    const mutationType = (parseNonEmptyText(body.mutationType as string | string[] | undefined | null)) ?? '';
    const generation = parsePositiveInt(body.generation) ?? 0;

    const result = await gmFarmService.gmAddSeed(lookupParams, itemId, quantity, mutationType, generation);
    if (!result.success) {
      const status = result.message === '角色不存在' ? 404 : 400;
      res.status(status).json({ success: false, message: result.message });
      return;
    }
    sendSuccess(res, result);
  }),
);

// ==================== 添加灵材 ====================

router.post(
  '/add-harvest',
  requireGm,
  addHarvestQpsLimit,
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const lookupParams = parseLookupParams({
      characterId: body.characterId,
      nickname: body.nickname,
    });
    if ('error' in lookupParams) {
      res.status(400).json({ success: false, message: lookupParams.error });
      return;
    }

    const cropId = parseNonEmptyText(body.cropId as string | string[] | undefined | null);
    if (!cropId) {
      res.status(400).json({ success: false, message: 'cropId 不能为空' });
      return;
    }

    const quantity = parsePositiveInt(body.quantity);
    if (quantity == null) {
      res.status(400).json({ success: false, message: 'quantity 必须为正整数' });
      return;
    }

    const qualityRaw = parseNonEmptyText(body.quality as string | string[] | undefined | null) ?? 'normal';
    if (!['hq', 'normal', 'lq'].includes(qualityRaw)) {
      res.status(400).json({ success: false, message: 'quality 必须为 hq / normal / lq' });
      return;
    }
    const quality = qualityRaw as CropQuality;

    const result = await gmFarmService.gmAddHarvest(lookupParams, cropId, quantity, quality);
    if (!result.success) {
      const status = result.message === '角色不存在' ? 404 : 400;
      res.status(status).json({ success: false, message: result.message });
      return;
    }
    sendSuccess(res, result);
  }),
);

// ==================== 一键添加所有灵材 ====================

router.post(
  '/add-all-harvest',
  requireGm,
  addAllHarvestQpsLimit,
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const lookupParams = parseLookupParams({
      characterId: body.characterId,
      nickname: body.nickname,
    });
    if ('error' in lookupParams) {
      res.status(400).json({ success: false, message: lookupParams.error });
      return;
    }

    const quantity = parsePositiveInt(body.quantity);
    if (quantity == null) {
      res.status(400).json({ success: false, message: 'quantity 必须为正整数' });
      return;
    }

    const qualitiesRaw = body.qualities;
    if (!Array.isArray(qualitiesRaw) || qualitiesRaw.length === 0) {
      res.status(400).json({ success: false, message: 'qualities 必须为非空数组' });
      return;
    }

    const allowed = new Set(['hq', 'normal', 'lq']);
    const invalid = qualitiesRaw.find((q) => !allowed.has(q));
    if (invalid) {
      res.status(400).json({ success: false, message: `无效品质 ${invalid}，可选：hq / normal / lq` });
      return;
    }
    const qualities = qualitiesRaw as CropQuality[];

    const result = await gmFarmService.gmAddAllHarvest(lookupParams, quantity, qualities);
    if (!result.success) {
      const status = result.message === '角色不存在' ? 404 : 400;
      res.status(status).json({ success: false, message: result.message });
      return;
    }
    sendSuccess(res, result);
  }),
);

export default router;
