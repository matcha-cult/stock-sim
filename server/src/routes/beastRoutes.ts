/**
 * 灵兽系统 HTTP 路由
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：解析参数、鉴权、QPS 限制、调用 service、返回标准响应。
 * 2. 不做什么：不处理业务逻辑（全部在 service 层）。
 *
 * 数据流 / 状态流：
 * 前端请求 -> 路由解析参数 -> service -> DTO -> sendSuccess。
 *
 * 关键边界条件与坑点：
 * 1. 涉及货币/消耗的操作成功后需推送角色刷新。
 * 2. QPS 限制防止并发滥用。
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCharacter } from '../middleware/auth.js';
import { createQpsLimitMiddleware } from '../middleware/qpsLimit.js';
import { safePushCharacterUpdate } from '../middleware/pushUpdate.js';
import { sendSuccess, sendResult } from '../middleware/response.js';
import {
  parsePositiveInt,
  parseNonEmptyText,
} from '../services/shared/httpParam.js';
import * as beastService from '../services/beast/beastService.js';
import * as beastSummonService from '../services/beast/beastSummonService.js';
import * as beastCultivationService from '../services/beast/beastCultivationService.js';
import * as beastTierService from '../services/beast/beastTierService.js';
import * as beastAltarService from '../services/beast/beastAltarService.js';
import * as beastActionLogService from '../services/beast/beastActionLogService.js';

const router: RouterType = Router();

const QPS_WINDOW_MS = 1000;
const QPS_MESSAGE = '请求过于频繁，请稍后再试';

const createBeastQpsLimit = (routeKey: string, limit: number) =>
  createQpsLimitMiddleware({
    keyPrefix: `qps:beast:${routeKey}`,
    limit,
    windowMs: QPS_WINDOW_MS,
    message: QPS_MESSAGE,
    resolveScope: (req) => req.userId!,
  });

const overviewQpsLimit = createBeastQpsLimit('overview', 10);
const previewQpsLimit = createBeastQpsLimit('preview', 10);
const mutationQpsLimit = createBeastQpsLimit('mutation', 5);

// ==================== 总览 ====================

router.get(
  '/overview',
  requireCharacter,
  overviewQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const result = await beastService.getOverview(characterId);
    sendSuccess(res, result.data);
  }),
);

// ==================== 详情预览 ====================

router.get(
  '/preview',
  requireCharacter,
  previewQpsLimit,
  asyncHandler(async (req, res) => {
    const beastId = parsePositiveInt(req.query?.beastId);
    if (!beastId) {
      sendSuccess(res, { success: false, message: 'beastId 参数无效' });
      return;
    }
    const result = await beastService.getPreview(beastId);
    sendSuccess(res, result.data);
  }),
);

// ==================== 批量详情预览 ====================

router.get(
  '/preview/batch',
  requireCharacter,
  previewQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastIdsParam = req.query?.beastIds;
    if (!beastIdsParam || typeof beastIdsParam !== 'string') {
      sendSuccess(res, { success: false, message: 'beastIds 参数无效' });
      return;
    }

    const beastIds = beastIdsParam
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (beastIds.length === 0) {
      sendSuccess(res, { success: false, message: 'beastIds 参数无效' });
      return;
    }

    const result = await beastService.getBatchPreview(beastIds, characterId);
    sendSuccess(res, result.data);
  }),
);

// ==================== 技能策略 ====================

router.get(
  '/skill-policy',
  requireCharacter,
  previewQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastId = parsePositiveInt(req.query?.beastId);
    if (!beastId) {
      sendSuccess(res, { success: false, message: 'beastId 参数无效' });
      return;
    }
    const result = await beastService.getSkillPolicy(characterId, beastId);
    sendSuccess(res, result.data);
  }),
);

router.put(
  '/skill-policy',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastId = parsePositiveInt(req.body?.beastId);
    if (!beastId) {
      sendSuccess(res, { success: false, message: 'beastId 参数无效' });
      return;
    }
    const slots = req.body?.slots;
    const result = await beastService.updateSkillPolicy(characterId, beastId, slots);
    sendSuccess(res, result.data);
  }),
);

// ==================== 出战 / 收回 ====================

router.post(
  '/activate',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastId = parsePositiveInt(req.body?.beastId);
    if (!beastId) {
      sendSuccess(res, { success: false, message: 'beastId 参数无效' });
      return;
    }
    const result = await beastService.activate(characterId, beastId);
    if (result.success) {
      await safePushCharacterUpdate(characterId);
    }
    sendSuccess(res, result.data ?? { success: result.success, message: result.message });
  }),
);

router.post(
  '/dismiss',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const result = await beastService.dismiss(characterId);
    if (result.success) {
      await safePushCharacterUpdate(characterId);
    }
    sendSuccess(res, result.data ?? { success: result.success, message: result.message });
  }),
);

// ==================== 放生（解除契约） ====================

router.post(
  '/release',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastId = parsePositiveInt(req.body?.beastId);
    if (!beastId) {
      sendSuccess(res, { success: false, message: 'beastId 参数无效' });
      return;
    }
    const result = await beastService.release(characterId, beastId);
    if (result.success) {
      await safePushCharacterUpdate(characterId);
    }
    sendSuccess(res, result.data ?? { success: result.success, message: result.message });
  }),
);

// ==================== 赐名 ====================

router.post(
  '/renameWithCard',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastId = parsePositiveInt(req.body?.beastId);
    const name = parseNonEmptyText(req.body?.name);
    if (!beastId || !name) {
      sendSuccess(res, { success: false, message: '参数无效' });
      return;
    }
    const description = typeof req.body?.description === 'string' ? req.body.description : undefined;
    const result = await beastService.renameWithCard(characterId, beastId, name, description);
    sendSuccess(res, result.data ?? { success: result.success, message: result.message });
  }),
);

// ==================== 更新自定义标签 ====================

router.post(
  '/update-custom-tag',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastId = parsePositiveInt(req.body?.beastId);
    const customTag = typeof req.body?.customTag === 'string' ? req.body.customTag : null;
    if (!beastId) {
      sendSuccess(res, { success: false, message: '参数无效' });
      return;
    }
    const result = await beastService.updateCustomTag(characterId, beastId, customTag || null);
    sendSuccess(res, result.data ?? { success: result.success, message: result.message });
  }),
);

// ==================== 经验灌注 ====================

router.post(
  '/inject-exp',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastId = parsePositiveInt(req.body?.beastId);
    const exp = parsePositiveInt(req.body?.exp);
    if (!beastId || !exp) {
      sendSuccess(res, { success: false, message: '参数无效' });
      return;
    }
    const result = await beastService.injectExp(characterId, beastId, exp);
    if (result.success) {
      await safePushCharacterUpdate(characterId);
    }
    sendSuccess(res, result.data ?? { success: result.success, message: result.message });
  }),
);

// ==================== 祭坛召唤 ====================

router.post(
  '/summon/generate',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const rawOfferings = req.body?.offerings;
    const spiritStones = req.body?.spiritStones;
    if (!Array.isArray(rawOfferings) || rawOfferings.length === 0 || rawOfferings.length > 6) {
      sendSuccess(res, { success: false, message: '祭品数量必须在 1-6 之间' });
      return;
    }
    // 解析祭品：支持 { itemId, quality } 格式
    const offerings: beastSummonService.OfferingInput[] = rawOfferings.map((o: string | { itemId: string; quality?: 'hq' | 'normal' | 'lq' }) => {
      if (typeof o === 'string') {
        return { itemId: o };
      }
      return { itemId: o.itemId, quality: o.quality };
    });
    if (typeof spiritStones !== 'number' || spiritStones <= 0) {
      sendSuccess(res, { success: false, message: '灵石数量必须大于 0' });
      return;
    }
    const result = await beastSummonService.generateSummon(characterId, offerings, spiritStones);
    if (result.success) {
      sendSuccess(res, result.data);
    } else {
      sendResult(res, result);
    }
  }),
);

// ==================== 批量召唤 ====================

router.post(
  '/altar/summon/batch',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const rawOfferings = req.body?.offerings;
    const spiritStones = req.body?.spiritStones;
    const count = req.body?.count;

    if (!Array.isArray(rawOfferings) || rawOfferings.length === 0 || rawOfferings.length > 6) {
      sendSuccess(res, { success: false, message: '祭品数量必须在 1-6 之间' });
      return;
    }
    const offerings: beastSummonService.OfferingInput[] = rawOfferings.map((o: string | { itemId: string; quality?: 'hq' | 'normal' | 'lq' }) => {
      if (typeof o === 'string') {
        return { itemId: o };
      }
      return { itemId: o.itemId, quality: o.quality };
    });
    if (typeof spiritStones !== 'number' || spiritStones <= 0) {
      sendSuccess(res, { success: false, message: '灵石数量必须大于 0' });
      return;
    }
    if (typeof count !== 'number' || count <= 0 || count > 50) {
      sendSuccess(res, { success: false, message: '召唤次数必须在 1-50 之间' });
      return;
    }

    const result = await beastSummonService.batchSummon(characterId, offerings, spiritStones, count);
    sendSuccess(res, result.data);
  }),
);

router.post(
  '/summon/:beastId/confirm',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastId = parsePositiveInt(req.params.beastId);
    if (!beastId) {
      sendSuccess(res, { success: false, message: 'beastId 参数无效' });
      return;
    }
    const result = await beastSummonService.confirmSummon(characterId, beastId);
    sendSuccess(res, result.data ?? { success: result.success, message: result.message });
  }),
);

router.post(
  '/summon/:beastId/discard',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastId = parsePositiveInt(req.params.beastId);
    if (!beastId) {
      sendSuccess(res, { success: false, message: 'beastId 参数无效' });
      return;
    }
    const result = await beastSummonService.discardSummon(characterId, beastId);
    sendSuccess(res, result.data ?? { success: result.success, message: result.message });
  }),
);

// ==================== 培育 ====================

router.post(
  '/cultivate',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastId = parsePositiveInt(req.body?.beastId);
    const itemId = parseNonEmptyText(req.body?.itemId);
    if (!beastId || !itemId) {
      sendSuccess(res, { success: false, message: '参数无效' });
      return;
    }
    const result = await beastCultivationService.cultivate(characterId, beastId, itemId);
    if (result.success) {
      await safePushCharacterUpdate(characterId);
    }
    sendSuccess(res, result.data ?? { success: result.success, message: result.message });
  }),
);

router.post(
  '/cultivate/batch',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastId = parsePositiveInt(req.body?.beastId);
    const itemId = parseNonEmptyText(req.body?.itemId);
    const count = parsePositiveInt(req.body?.count);
    if (!beastId || !itemId || !count) {
      sendSuccess(res, { success: false, message: '参数无效' });
      return;
    }
    const result = await beastCultivationService.batchCultivate(characterId, beastId, itemId, count);
    if (result.success) {
      await safePushCharacterUpdate(characterId);
    }
    sendSuccess(res, result.data ?? { success: result.success, message: result.message });
  }),
);

router.get(
  '/cultivation-preview',
  requireCharacter,
  previewQpsLimit,
  asyncHandler(async (req, res) => {
    const beastId = parsePositiveInt(req.query?.beastId);
    const itemId = parseNonEmptyText(req.query?.itemId as string | undefined);
    const count = parsePositiveInt(req.query?.count) ?? 1;
    if (!beastId || !itemId) {
      sendSuccess(res, { success: false, message: '参数无效' });
      return;
    }
    const result = await beastCultivationService.getCultivationPreview(beastId, itemId, count);
    sendSuccess(res, result.data);
  }),
);

// ==================== 品阶提升 / 化形 ====================

router.post(
  '/tier-up',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastId = parsePositiveInt(req.body?.beastId);
    const autoBuyPill = req.body?.autoBuyPill === true;
    if (!beastId) {
      sendSuccess(res, { success: false, message: 'beastId 参数无效' });
      return;
    }
    const result = await beastTierService.tierUp(characterId, beastId, autoBuyPill);
    if (result.success) {
      await safePushCharacterUpdate(characterId);
      sendSuccess(res, result.data);
    } else {
      sendResult(res, { success: false, message: result.message });
    }
  }),
);

router.post(
  '/transform',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastId = parsePositiveInt(req.body?.beastId);
    if (!beastId) {
      sendSuccess(res, { success: false, message: 'beastId 参数无效' });
      return;
    }
    const result = await beastTierService.transform(characterId, beastId);
    if (result.success) {
      await safePushCharacterUpdate(characterId);
    }
    sendSuccess(res, result.data ?? { success: result.success, message: result.message });
  }),
);

router.get(
  '/tier-up/check',
  requireCharacter,
  previewQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastId = parsePositiveInt(req.query?.beastId);
    if (!beastId) {
      sendSuccess(res, { success: false, message: 'beastId 参数无效' });
      return;
    }
    const result = await beastTierService.checkTierUp(characterId, beastId);
    sendSuccess(res, result.data);
  }),
);

router.get(
  '/transform/check',
  requireCharacter,
  previewQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const beastId = parsePositiveInt(req.query?.beastId);
    if (!beastId) {
      sendSuccess(res, { success: false, message: 'beastId 参数无效' });
      return;
    }
    const result = await beastTierService.checkTransform(characterId, beastId);
    sendSuccess(res, result.data);
  }),
);

// ==================== 祭坛 ====================

router.get(
  '/altar/offerings',
  requireCharacter,
  previewQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const result = await beastAltarService.getAvailableOfferings(characterId);
    sendSuccess(res, result.data);
  }),
);

router.get(
  '/altar/recipes',
  requireCharacter,
  previewQpsLimit,
  asyncHandler(async (req, res) => {
    const { getAltarRecipes, getBloodlineById } = await import('../services/beast/beastConfigLoader.js');
    const recipes = getAltarRecipes();
    // 返回血脉名称 + 配方描述 + 化形形态
    const recipesWithNames = recipes.map((r) => {
      const bloodline = getBloodlineById(r.bloodline_id);
      return {
        bloodlineName: bloodline?.name ?? '未知血脉',
        transformForm: null,  // 已移除化形设定
        rarity: bloodline?.rarity ?? 'R',
        description: r.description,
      };
    });
    sendSuccess(res, recipesWithNames);
  }),
);

// ==================== 操作日志 ====================

router.get(
  '/action-log',
  requireCharacter,
  previewQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const page = parsePositiveInt(req.query?.page) ?? 1;
    const result = await beastActionLogService.getActionLogs(characterId, page);
    sendSuccess(res, result);
  }),
);

// ==================== 融合 ====================

router.post(
  '/fuse',
  requireCharacter,
  mutationQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const { beastIds } = req.body as { beastIds: number[] };

    console.log('[POST /api/beast/fuse] 收到融合请求，characterId:', characterId, 'beastIds:', beastIds);

    if (!Array.isArray(beastIds) || beastIds.length !== 5) {
      console.log('[POST /api/beast/fuse] 参数校验失败，beastIds:', beastIds);
      sendResult(res, { success: false, message: '融合需要 5 只灵兽' });
      return;
    }

    const materials = beastIds.map((id) => ({ beastId: id, characterId }));
    console.log('[POST /api/beast/fuse] 开始调用 fuseBeasts，materials:', materials);

    const result = await (await import('../services/beast/beastFusionService.js')).fuseBeasts(materials);

    console.log('[POST /api/beast/fuse] fuseBeasts 返回结果:', result);

    if (result.success) {
      safePushCharacterUpdate(characterId);
      sendSuccess(res, { newBeastId: result.newBeastId, newStarLevel: result.newStarLevel });
    } else {
      sendResult(res, { success: false, message: result.message });
    }
  }),
);

export default router;
