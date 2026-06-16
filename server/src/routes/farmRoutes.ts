/**
 * 灵田系统 V3 — HTTP 路由。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：解析参数、鉴权、QPS 限制、调用 service、返回标准响应。
 * 2. 不做什么：不处理业务逻辑（全部在 service 层）。
 *
 * 数据流 / 状态流：
 * 前端请求 → 本路由解析参数 → service → DTO → sendSuccess。
 *
 * 复用设计说明：
 * - 路由层只做鉴权/QPS/参数归一化，业务逻辑集中在 service。
 * - 货币操作成功后推送角色刷新（safePushCharacterUpdate）。
 * - QPS 限制复用 createQpsLimitMiddleware。
 *
 * 关键边界条件与坑点：
 * 1. plant/harvest 设置 5 QPS 防并发。
 * 2. overview 设置 10 QPS。
 * 3. V3 新增 reclaim（开垦）、expand-cell（扩展格子）、upgrade-tier（等阶突破）接口。
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCharacter } from '../middleware/auth.js';
import { createQpsLimitMiddleware } from '../middleware/qpsLimit.js';
import { safePushCharacterUpdate } from '../middleware/pushUpdate.js';
import { sendSuccess } from '../middleware/response.js';
import {
  parsePositiveInt,
  parseNonNegativeInt,
  parseNonEmptyText,
} from '../services/shared/httpParam.js';
import * as farmService from '../services/farm/farmService.js';
import type { CropQuality } from '../services/farm/farmTypes.js';

const router: RouterType = Router();

const QPS_WINDOW_MS = 1000;
const QPS_MESSAGE = '请求过于频繁，请稍后再试';

const createFarmQpsLimit = (routeKey: string, limit: number) =>
  createQpsLimitMiddleware({
    keyPrefix: `qps:farm:${routeKey}`,
    limit,
    windowMs: QPS_WINDOW_MS,
    message: QPS_MESSAGE,
    resolveScope: (req) => req.userId!,
  });

const overviewQpsLimit = createFarmQpsLimit('overview', 10);
const harvestQpsLimit = createFarmQpsLimit('harvest', 5);
const plantQpsLimit = createFarmQpsLimit('plant', 5);
const buySeedQpsLimit = createFarmQpsLimit('buy-seed', 5);
const defaultMutationQpsLimit = createFarmQpsLimit('mutation', 5);

// ==================== 概览 ====================

router.get(
  '/overview',
  requireCharacter,
  overviewQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const dto = await farmService.getFarmOverview(characterId);
    sendSuccess(res, dto);
  }),
);

// ==================== 活动日志 ====================

router.get(
  '/log',
  requireCharacter,
  defaultMutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const page = parsePositiveInt(req.query?.page) ?? 1;
    const pageSize = parsePositiveInt(req.query?.pageSize) ?? 20;
    const result = await farmService.getFarmLog(characterId, page, pageSize);
    sendSuccess(res, result);
  }),
);

// ==================== 静态配置 ====================

router.get(
  '/config',
  requireCharacter,
  asyncHandler(async (req, res) => {
    const dto = farmService.getFarmStaticConfig();
    sendSuccess(res, dto);
  }),
);

// ==================== 种子商店 ====================

router.post(
  '/buy-seed',
  requireCharacter,
  buySeedQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const itemId = parseNonEmptyText(req.body?.itemId);
    const quantity = parsePositiveInt(req.body?.quantity) ?? 1;
    if (!itemId) {
      res.status(400).json({ success: false, message: 'itemId 不能为空' });
      return;
    }
    const result = await farmService.buySeed(characterId, itemId, quantity);
    if (result.success) safePushCharacterUpdate(characterId);
    sendSuccess(res, result);
  }),
);

router.post(
  '/sell-seed',
  requireCharacter,
  defaultMutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const itemId = parseNonEmptyText(req.body?.itemId);
    const quantity = parsePositiveInt(req.body?.quantity) ?? 1;
    const mutationType = parseNonEmptyText(req.body?.mutationType);
    if (!itemId) {
      res.status(400).json({ success: false, message: 'itemId 不能为空' });
      return;
    }
    const result = await farmService.sellSeed(characterId, itemId, quantity, mutationType);
    if (result.success) safePushCharacterUpdate(characterId);
    sendSuccess(res, result);
  }),
);

// ==================== 种植 & 收获 ====================

router.post(
  '/plant',
  requireCharacter,
  plantQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const row = parseNonNegativeInt(req.body?.row);
    const col = parseNonNegativeInt(req.body?.col);
    const seedId = parseNonNegativeInt(req.body?.seedId);
    if (row == null || col == null || seedId == null) {
      res.status(400).json({ success: false, message: '参数不完整' });
      return;
    }
    const result = await farmService.plantCrop(characterId, row, col, seedId);
    sendSuccess(res, result);
  }),
);

router.post(
  '/harvest',
  requireCharacter,
  harvestQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const row = parseNonNegativeInt(req.body?.row);
    const col = parseNonNegativeInt(req.body?.col);
    if (row == null || col == null) {
      res.status(400).json({ success: false, message: 'row/col 不能为空' });
      return;
    }
    const result = await farmService.harvestCrop(characterId, row, col);
    if (result.success) safePushCharacterUpdate(characterId);
    sendSuccess(res, result);
  }),
);

const harvestAllQpsLimit = createFarmQpsLimit('harvestAll', 2);

router.post(
  '/harvest-all',
  requireCharacter,
  harvestAllQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const result = await farmService.harvestAll(characterId);
    if (result.success) safePushCharacterUpdate(characterId);
    sendSuccess(res, result);
  }),
);

const removeQpsLimit = createFarmQpsLimit('remove', 5);

router.post(
  '/remove',
  requireCharacter,
  removeQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const row = parseNonNegativeInt(req.body?.row);
    const col = parseNonNegativeInt(req.body?.col);
    if (row == null || col == null) {
      res.status(400).json({ success: false, message: 'row/col 不能为空' });
      return;
    }
    const result = await farmService.removeCrop(characterId, row, col);
    sendSuccess(res, result);
  }),
);

const transplantQpsLimit = createFarmQpsLimit('transplant', 5);

router.post(
  '/transplant',
  requireCharacter,
  transplantQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const fromRow = parseNonNegativeInt(req.body?.fromRow);
    const fromCol = parseNonNegativeInt(req.body?.fromCol);
    const toRow = parseNonNegativeInt(req.body?.toRow);
    const toCol = parseNonNegativeInt(req.body?.toCol);
    if (fromRow == null || fromCol == null || toRow == null || toCol == null) {
      res.status(400).json({ success: false, message: '参数不完整' });
      return;
    }
    const result = await farmService.transplantCrop(characterId, fromRow, fromCol, toRow, toCol);
    sendSuccess(res, result);
  }),
);

// ==================== 灵材出售 ====================

router.post(
  '/sell-harvest',
  requireCharacter,
  defaultMutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const cropId = parseNonEmptyText(req.body?.cropId);
    const quality = parseNonEmptyText(req.body?.quality) as CropQuality | null;
    const tradeUnits = parsePositiveInt(req.body?.tradeUnits) ?? 1;
    if (!cropId || !quality) {
      res.status(400).json({ success: false, message: 'cropId/quality 不能为空' });
      return;
    }
    if (!['hq', 'normal', 'lq'].includes(quality)) {
      res.status(400).json({ success: false, message: 'quality 无效' });
      return;
    }
    const result = await farmService.sellHarvest(characterId, cropId, quality, tradeUnits);
    if (result.success) safePushCharacterUpdate(characterId);
    sendSuccess(res, result);
  }),
);

router.post(
  '/sell-all-harvest',
  requireCharacter,
  defaultMutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const result = await farmService.sellAllHarvest(characterId);
    if (result.success) safePushCharacterUpdate(characterId);
    sendSuccess(res, result);
  }),
);

// ==================== 灵田开垦 ====================

router.post(
  '/reclaim',
  requireCharacter,
  defaultMutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const result = await farmService.reclaimFarm(characterId);
    if (result.success) safePushCharacterUpdate(characterId);
    sendSuccess(res, result);
  }),
);

// ==================== 格子扩展 & 等阶突破 ====================

router.post(
  '/expand-cell',
  requireCharacter,
  defaultMutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const row = parseNonNegativeInt(req.body?.row);
    const col = parseNonNegativeInt(req.body?.col);
    if (row == null || col == null) {
      res.status(400).json({ success: false, message: 'row/col 不能为空' });
      return;
    }
    const result = await farmService.expandCell(characterId, row, col);
    if (result.success) safePushCharacterUpdate(characterId);
    sendSuccess(res, result);
  }),
);

router.post(
  '/upgrade-tier',
  requireCharacter,
  defaultMutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const result = await farmService.upgradeTier(characterId);
    if (result.success) safePushCharacterUpdate(characterId);
    sendSuccess(res, result);
  }),
);

export default router;
