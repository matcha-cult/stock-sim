/**
 * 收租系统 — HTTP 路由。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供店铺概览、收取租金、装修调整、空间扩展、免费领取初始店铺接口。
 * 2. 不做什么：不在路由层重复租金计算、装修费用等业务规则。
 *
 * 输入 / 输出：
 * - 输入：登录角色上下文、店铺 ID、操作参数。
 * - 输出：标准 `{ success, data?, message }` 响应。
 *
 * 数据流 / 状态流：
 * 前端店铺组件 → 本路由解析参数 → `shopService` → DTO → 必要时推送角色刷新。
 *
 * 复用设计说明：
 * - 路由只做鉴权、QPS 和参数归一化，业务逻辑集中在 service。
 * - 所有需要修改灵石的接口成功后推送角色刷新。
 *
 * 关键边界条件与坑点：
 * 1. 装修/扩空间成功后需要推送角色刷新，否则灵石余额会滞后。
 * 2. 查询接口设置 QPS 限制，避免频繁刷新。
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCharacter } from '../middleware/auth.js';
import { createQpsLimitMiddleware } from '../middleware/qpsLimit.js';
import { safePushCharacterUpdate } from '../middleware/pushUpdate.js';
import { sendSuccess } from '../middleware/response.js';
import { parseFiniteNumber, parseNonEmptyText, getSingleQueryValue } from '../services/shared/httpParam.js';
import { shopService } from '../services/shop/shopService.js';
import { DECORATION_TIERS, SHOP_TYPES, type DecorationTier, type ShopType } from '../services/shop/types.js';

const router: RouterType = Router();

const SHOP_QPS_WINDOW_MS = 1000;
const SHOP_QUERY_QPS_LIMIT = 5;
const SHOP_MUTATION_QPS_LIMIT = 2;
const SHOP_QPS_LIMIT_MESSAGE = '店铺请求过于频繁，请稍后再试';

const createShopQpsLimit = (routeKey: string, limit: number) => createQpsLimitMiddleware({
  keyPrefix: `qps:shop:${routeKey}`,
  limit,
  windowMs: SHOP_QPS_WINDOW_MS,
  message: SHOP_QPS_LIMIT_MESSAGE,
  resolveScope: (req) => req.userId!,
});

const shopOverviewQpsLimit = createShopQpsLimit('overview', SHOP_QUERY_QPS_LIMIT);
const shopCollectQpsLimit = createShopQpsLimit('collect', SHOP_MUTATION_QPS_LIMIT);
const shopDecorationQpsLimit = createShopQpsLimit('decoration', SHOP_MUTATION_QPS_LIMIT);
const shopExpandQpsLimit = createShopQpsLimit('expand', SHOP_MUTATION_QPS_LIMIT);
const shopClaimQpsLimit = createShopQpsLimit('claim', SHOP_MUTATION_QPS_LIMIT);

const parseDecorationTier = (value: string | null | undefined): DecorationTier | null => {
  if (!value) return null;
  const tiers = Object.values(DECORATION_TIERS) as string[];
  return tiers.includes(value) ? (value as DecorationTier) : null;
};

type ShopDecorationBody = {
  targetTier?: string | null;
};

router.get('/overview', requireCharacter, shopOverviewQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const data = await shopService.getOverview(characterId);
  sendSuccess(res, data);
}));

router.get('/config', requireCharacter, shopOverviewQpsLimit, asyncHandler(async (req, res) => {
  const data = shopService.getConfig();
  sendSuccess(res, data);
}));

router.post('/collect-all', requireCharacter, shopCollectQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const result = await shopService.collectAllRent(characterId);
  if (result.success) {
    await safePushCharacterUpdate(req.userId!);
  }
  sendSuccess(res, result);
}));

router.post('/:id/collect', requireCharacter, shopCollectQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const shopId = parseFiniteNumber(req.params.id);
  if (!shopId) {
    sendSuccess(res, { success: false, message: '店铺 ID 无效' });
    return;
  }

  const result = await shopService.collectRent(characterId, shopId);
  if (result.success) {
    await safePushCharacterUpdate(req.userId!);
  }
  sendSuccess(res, result);
}));

router.post('/:id/decoration', requireCharacter, shopDecorationQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const shopId = parseFiniteNumber(req.params.id);
  if (!shopId) {
    sendSuccess(res, { success: false, message: '店铺 ID 无效' });
    return;
  }

  const body = req.body as ShopDecorationBody;
  const targetTier = parseDecorationTier(body.targetTier ?? null);
  if (!targetTier) {
    sendSuccess(res, { success: false, message: '目标装修等级无效' });
    return;
  }

  const result = await shopService.adjustDecoration(characterId, shopId, targetTier);
  if (result.success) {
    await safePushCharacterUpdate(req.userId!);
  }
  sendSuccess(res, result);
}));

router.post('/:id/expand', requireCharacter, shopExpandQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const shopId = parseFiniteNumber(req.params.id);
  if (!shopId) {
    sendSuccess(res, { success: false, message: '店铺 ID 无效' });
    return;
  }

  const result = await shopService.expandSpace(characterId, shopId);
  if (result.success) {
    await safePushCharacterUpdate(req.userId!);
  }
  sendSuccess(res, result);
}));

router.post('/claim-initial', requireCharacter, shopClaimQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const result = await shopService.claimInitialShop(characterId);
  if (result.success) {
    await safePushCharacterUpdate(req.userId!);
  }
  sendSuccess(res, result);
}));

const shopPurchaseQpsLimit = createShopQpsLimit('purchase', SHOP_MUTATION_QPS_LIMIT);

router.post('/purchase', requireCharacter, shopPurchaseQpsLimit, asyncHandler(async (req, res) => {
  const characterId = req.characterId!;
  const body = req.body as { shopType?: string };
  const rawType = body.shopType;
  const shopType = (rawType && (Object.values(SHOP_TYPES) as string[]).includes(rawType))
    ? rawType as ShopType
    : null;
  if (!shopType) {
    sendSuccess(res, { success: false, message: '店铺类型无效' });
    return;
  }

  const result = await shopService.purchaseShop(characterId, shopType);
  if (result.success) {
    await safePushCharacterUpdate(req.userId!);
  }
  sendSuccess(res, result);
}));

export default router;
