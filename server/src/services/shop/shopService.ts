/**
 * 收租系统 — 店铺核心服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：店铺创建、概览查询、租金收取、装修调整、空间扩展、tick 批量结算。
 * 2. 不做什么：不处理前端 UI 渲染、不重复 tick 调度逻辑。
 *
 * 输入 / 输出：
 * - 输入：角色 ID、店铺操作参数。
 * - 输出：店铺 DTO、操作结果。
 *
 * 数据流 / 状态流：
 * tick 调度器 → processShopRentTick → 批量更新 pending_rent → 玩家收取 → 转账 + 升级判定；
 * 玩家操作 → 装修/扩空间 → 扣灵石 → 更新店铺属性。
 *
 * 复用设计说明：
 * - 租金计算、装修费用、扩展费用统一引用 `types.ts` 中的纯函数，避免 service / route 各自实现。
 * - 货币操作复用 `consumeSpiritStones` / `addSpiritStones`，与股市交易保持一致。
 *
 * 关键边界条件与坑点：
 * 1. 收取租金需 SELECT FOR UPDATE 防止并发重复收取。
 * 2. 装修 tick 跳过逻辑依赖 last_decorate_tick_id，必须和 tick ID 严格比对。
 * 3. 租金存储单位为「分」（BigInt），前端展示时需 ÷100。
 */
import { query } from '../../config/database.js';
import { Transactional } from '../../decorators/transactional.js';
import { consumeSpiritStones, addSpiritStones } from '../inventory/shared/consume.js';
import {
  SHOP_TYPES,
  SHOP_TYPE_CONFIG,
  DECORATION_TIERS,
  DECORATION_TIER_ORDER,
  DECORATION_TIER_RENT_MULTIPLIER,
  DECORATION_TIER_EXPANSION_MULTIPLIER,
  DECORATION_TIER_PRICE_PER_SQM,
  DECORATION_TIER_INDEX,
  DECORATION_TIER_LABEL,
  SPACE_EXPANSION_AREA_INCREMENT,
  SPACE_EXPANSION_BASE_COST,
  MAX_PENDING_RENT_TICKS,
  SHOP_RENT_TICK_INTERVAL_MINUTES,
  DECORATION_REFUND_RATE,
  UPGRADE_LEVEL_BONUS_RATE,
  UPGRADE_TICKS_BASE,
  INITIAL_SHOP_TYPE,
  INITIAL_SHOP_TIER,
  type ShopType,
  type DecorationTier,
  calculateRentPerTick,
  calculateDecorationCost,
  calculateDecorationRefund,
  calculateSpaceExpansionCost,
  calculateUpgradeTicksNeeded,
} from './types.js';
import { getNextShopRentTickAt } from './shopRentTime.js';

// ==================== 功能开关 ====================

/** 收租系统总开关：SHOP_FEATURE_ENABLED=false|0 时关闭所有接口与调度。 */
const isShopFeatureEnabled = (): boolean => {
  const env = process.env.SHOP_FEATURE_ENABLED;
  return env !== 'false' && env !== '0';
};

const ensureShopFeatureEnabled = (): void => {
  if (!isShopFeatureEnabled()) {
    throw new Error('功能未开放');
  }
};

// ==================== 类型定义 ====================

type ShopRow = {
  id: string | number;
  character_id: string | number;
  shop_type: string;
  area: string | number;
  decoration_tier: string;
  upgrade_level: string | number;
  space_expansion: string | number;
  pending_rent: string | number | bigint;
  total_rent_collected: string | number | bigint;
  rent_tick_count: string | number | bigint;
  last_rent_tick_id: string | number | bigint | null;
  last_decorate_tick_id: string | number | bigint | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type TickRow = {
  id: string | number | bigint;
};

export type ShopDto = {
  id: number;
  shopType: ShopType;
  shopTypeName: string;
  area: number;
  decorationTier: DecorationTier;
  decorationTierLabel: string;
  upgradeLevel: number;
  spaceExpansion: number;
  pendingRent: number; // 前端展示用（灵石，非分）
  totalRentCollected: number;
  rentTickCount: number;
  rentPerTick: number; // 当前每 tick 租金（灵石）
  isDecorating: boolean; // 当前 tick 是否在装修中（跳过租金）
};

export type ShopOverviewDto = {
  shops: ShopDto[];
  totalPendingRent: number;
  nextRentAt: string;
};

export type CollectRentResult = {
  success: boolean;
  message: string;
  collectedRent?: number;
  upgraded?: boolean;
  newUpgradeLevel?: number;
};

export type DecorationResult = {
  success: boolean;
  message: string;
  newTier?: DecorationTier;
  cost?: number;
  refund?: number;
};

export type SpaceExpansionResult = {
  success: boolean;
  message: string;
  newExpansion?: number;
  newArea?: number;
  cost?: number;
};

export type ClaimInitialShopResult = {
  success: boolean;
  message: string;
  shop?: ShopDto;
};

export type PurchaseShopResult = {
  success: boolean;
  message: string;
  shop?: ShopDto;
  cost?: number;
};

// ==================== 工具函数 ====================

const toBigIntValue = (value: string | number | bigint | null | undefined): bigint => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.trim()) return BigInt(value);
  return 0n;
};

const toIntValue = (value: string | number | bigint | null | undefined): number => {
  if (typeof value === 'bigint') return Number(value);
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

const validateShopType = (value: string): ShopType | null => {
  const types = Object.values(SHOP_TYPES) as string[];
  return types.includes(value) ? (value as ShopType) : null;
};

const validateDecorationTier = (value: string): DecorationTier | null => {
  const tiers = Object.values(DECORATION_TIERS) as string[];
  return tiers.includes(value) ? (value as DecorationTier) : null;
};

const toDtoShopPrice = (priceUnits: bigint): number => {
  return Number(priceUnits) / 100;
};

// ==================== 服务类 ====================

class ShopService {
  /**
   * 获取角色所有店铺概览。
   */
  async getOverview(characterId: number): Promise<ShopOverviewDto> {
    ensureShopFeatureEnabled();
    const rows = await query<ShopRow>(
      `SELECT * FROM shop_detail WHERE character_id = $1 ORDER BY id ASC`,
      [characterId],
    );

    // 获取当前 tick ID 用于判断装修状态
    const tickResult = await query<TickRow>(
      `SELECT id FROM shop_tick WHERE status = 'generated' ORDER BY tick_hour DESC LIMIT 1`,
    );
    const latestTickId = tickResult.rows[0]?.id ?? null;

    const shops = rows.rows.map((row) => this.buildShopDto(row, latestTickId));
    const totalPendingRent = shops.reduce((sum, s) => sum + s.pendingRent, 0);

    return { shops, totalPendingRent, nextRentAt: getNextShopRentTickAt().toISOString() };
  }

  /**
   * 构建单个店铺 DTO。
   */
  private buildShopDto(row: ShopRow, latestTickId: string | number | bigint | null): ShopDto {
    const shopType = row.shop_type as ShopType;
    const decorationTier = row.decoration_tier as DecorationTier;
    const config = SHOP_TYPE_CONFIG[shopType];
    const upgradeLevel = toIntValue(row.upgrade_level);
    const spaceExpansion = toIntValue(row.space_expansion);

    const rentPerTick = calculateRentPerTick({
      shopType,
      decorationTier,
      spaceExpansion,
      upgradeLevel,
    });

    const isDecorating = latestTickId !== null
      && row.last_decorate_tick_id !== null
      && toBigIntValue(row.last_decorate_tick_id) === toBigIntValue(latestTickId);

    return {
      id: toIntValue(row.id),
      shopType,
      shopTypeName: config?.name ?? shopType,
      area: toIntValue(row.area),
      decorationTier,
      decorationTierLabel: DECORATION_TIER_LABEL[decorationTier],
      upgradeLevel,
      spaceExpansion,
      pendingRent: toDtoShopPrice(toBigIntValue(row.pending_rent)),
      totalRentCollected: toDtoShopPrice(toBigIntValue(row.total_rent_collected)),
      rentTickCount: toIntValue(row.rent_tick_count),
      rentPerTick: toDtoShopPrice(rentPerTick),
      isDecorating,
    };
  }

  /**
   * 获取店铺配置常量（前端用）。
   */
  getConfig(): {
    shopTypes: Record<ShopType, { name: string; initialArea: number; initialRent: number }>;
    decorationTiers: Record<DecorationTier, {
      label: string;
      index: number;
      rentMultiplier: number;
      pricePerSqm: number;
      expansionMultiplier: number;
    }>;
    decorationTierOrder: DecorationTier[];
    constants: {
      spaceExpansionAreaIncrement: number;
      spaceExpansionBaseCost: number;
      maxPendingRentTicks: number;
      decorationRefundRate: number;
      upgradeLevelBonusRate: number;
      upgradeTicksBase: number;
      rentTickIntervalMinutes: number;
    };
  } {
    return {
      shopTypes: SHOP_TYPE_CONFIG,
      decorationTiers: Object.fromEntries(
        (Object.keys(DECORATION_TIERS) as DecorationTier[]).map((tier) => [
          tier,
          {
            label: DECORATION_TIER_LABEL[tier],
            index: DECORATION_TIER_INDEX[tier],
            rentMultiplier: DECORATION_TIER_RENT_MULTIPLIER[tier],
            pricePerSqm: DECORATION_TIER_PRICE_PER_SQM[tier],
            expansionMultiplier: DECORATION_TIER_EXPANSION_MULTIPLIER[tier],
          },
        ]),
      ) as Record<DecorationTier, {
        label: string;
        index: number;
        rentMultiplier: number;
        pricePerSqm: number;
        expansionMultiplier: number;
      }>,
      decorationTierOrder: DECORATION_TIER_ORDER,
      constants: {
        spaceExpansionAreaIncrement: SPACE_EXPANSION_AREA_INCREMENT,
        spaceExpansionBaseCost: SPACE_EXPANSION_BASE_COST,
        maxPendingRentTicks: MAX_PENDING_RENT_TICKS,
        decorationRefundRate: DECORATION_REFUND_RATE,
        upgradeLevelBonusRate: UPGRADE_LEVEL_BONUS_RATE,
        upgradeTicksBase: UPGRADE_TICKS_BASE,
        rentTickIntervalMinutes: SHOP_RENT_TICK_INTERVAL_MINUTES,
      },
    };
  }

  /**
   * 收取指定店铺的待收租金。
   * 使用 SELECT FOR UPDATE 保证并发安全。
   */
  @Transactional
  async collectRent(characterId: number, shopId: number): Promise<CollectRentResult> {
    ensureShopFeatureEnabled();
    // 加锁读取店铺
    const shopResult = await query<ShopRow>(
      `
        SELECT * FROM shop_detail
        WHERE id = $1 AND character_id = $2
        FOR UPDATE
      `,
      [shopId, characterId],
    );
    const shop = shopResult.rows[0];
    if (!shop) return { success: false, message: '店铺不存在' };

    const pendingRent = toBigIntValue(shop.pending_rent);
    if (pendingRent <= 0n) return { success: false, message: '没有可收取的租金' };

    // 转账到角色
    const addResult = await addSpiritStones(characterId, pendingRent);
    if (!addResult.success) return { success: false, message: addResult.message };

    // 更新店铺状态
    const newTickCount = toBigIntValue(shop.rent_tick_count) + 1n;
    const newTotalCollected = toBigIntValue(shop.total_rent_collected) + pendingRent;
    await query(
      `
        UPDATE shop_detail
        SET pending_rent = 0,
            total_rent_collected = $1,
            rent_tick_count = $2,
            updated_at = NOW()
        WHERE id = $3 AND character_id = $4
      `,
      [newTotalCollected.toString(), newTickCount.toString(), shopId, characterId],
    );

    // 升级判定
    let upgraded = false;
    let newUpgradeLevel = toIntValue(shop.upgrade_level);
    const currentLevel = newUpgradeLevel;
    const ticksNeeded = calculateUpgradeTicksNeeded(currentLevel);
    if (newTickCount >= BigInt(ticksNeeded)) {
      newUpgradeLevel = currentLevel + 1;
      upgraded = true;
      await query(
        `
          UPDATE shop_detail
          SET upgrade_level = $1,
              updated_at = NOW()
          WHERE id = $2 AND character_id = $3
        `,
        [newUpgradeLevel, shopId, characterId],
      );
    }

    return {
      success: true,
      message: upgraded
        ? `收取租金成功，获得 ${toDtoShopPrice(pendingRent)} 灵石，店铺升级到 Lv.${newUpgradeLevel}！`
        : `收取租金成功，获得 ${toDtoShopPrice(pendingRent)} 灵石`,
      collectedRent: toDtoShopPrice(pendingRent),
      upgraded,
      newUpgradeLevel,
    };
  }

  /**
   * 一键收取全部待收租金。
   */
  @Transactional
  async collectAllRent(characterId: number): Promise<{
    success: boolean;
    message: string;
    totalCollected: number;
    upgradedShops: number[];
  }> {
    ensureShopFeatureEnabled();
    // 加锁读取所有店铺
    const shopResult = await query<ShopRow>(
      `
        SELECT * FROM shop_detail
        WHERE character_id = $1 AND pending_rent > 0
        FOR UPDATE
      `,
      [characterId],
    );

    if (shopResult.rows.length === 0) {
      return { success: false, message: '没有可收取的租金', totalCollected: 0, upgradedShops: [] };
    }

    let totalRent = 0n;
    const shopUpdates: Array<{
      id: number;
      pendingRent: bigint;
      rentTickCount: bigint;
      totalRentCollected: bigint;
      upgradeLevel: number;
    }> = [];

    for (const row of shopResult.rows) {
      const pending = toBigIntValue(row.pending_rent);
      if (pending <= 0n) continue;
      totalRent += pending;
      shopUpdates.push({
        id: toIntValue(row.id),
        pendingRent: pending,
        rentTickCount: toBigIntValue(row.rent_tick_count),
        totalRentCollected: toBigIntValue(row.total_rent_collected),
        upgradeLevel: toIntValue(row.upgrade_level),
      });
    }

    if (totalRent <= 0n) {
      return { success: false, message: '没有可收取的租金', totalCollected: 0, upgradedShops: [] };
    }

    // 转账
    const addResult = await addSpiritStones(characterId, totalRent);
    if (!addResult.success) return { success: false, message: addResult.message, totalCollected: 0, upgradedShops: [] };

    // 批量更新
    const upgradedShops: number[] = [];
    for (const s of shopUpdates) {
      const newTickCount = s.rentTickCount + 1n;
      const newTotalCollected = s.totalRentCollected + s.pendingRent;

      let upgraded = false;
      let newLevel = s.upgradeLevel;
      const ticksNeeded = calculateUpgradeTicksNeeded(s.upgradeLevel);
      if (newTickCount >= BigInt(ticksNeeded)) {
        newLevel = s.upgradeLevel + 1;
        upgraded = true;
        upgradedShops.push(s.id);
      }

      await query(
        `
          UPDATE shop_detail
          SET pending_rent = 0,
              total_rent_collected = $1,
              rent_tick_count = $2,
              upgrade_level = $3,
              updated_at = NOW()
          WHERE id = $4 AND character_id = $5
        `,
        [newTotalCollected.toString(), newTickCount.toString(), newLevel, s.id, characterId],
      );
    }

    return {
      success: true,
      message: `一键收取成功，共获得 ${toDtoShopPrice(totalRent)} 灵石`,
      totalCollected: toDtoShopPrice(totalRent),
      upgradedShops,
    };
  }

  /**
   * 调整装修等级（升级或降级）。
   * 升级：扣除灵石；降级：返还 60% 装修费。
   * 装修消耗 1 次 tick，当前 tick 无租金。
   */
  @Transactional
  async adjustDecoration(characterId: number, shopId: number, targetTier: DecorationTier): Promise<DecorationResult> {
    ensureShopFeatureEnabled();
    // 加锁读取店铺
    const shopResult = await query<ShopRow>(
      `
        SELECT * FROM shop_detail
        WHERE id = $1 AND character_id = $2
        FOR UPDATE
      `,
      [shopId, characterId],
    );
    const shop = shopResult.rows[0];
    if (!shop) return { success: false, message: '店铺不存在' };

    const currentTier = shop.decoration_tier as DecorationTier;
    if (currentTier === targetTier) return { success: false, message: '当前已是该装修等级' };

    const currentTierIdx = DECORATION_TIER_INDEX[currentTier];
    const targetTierIdx = DECORATION_TIER_INDEX[targetTier];
    if (targetTierIdx < 0 || targetTierIdx > 3) return { success: false, message: '目标装修等级无效' };

    const area = toIntValue(shop.area);
    const tickResult = await query<TickRow>(
      `SELECT id FROM shop_tick ORDER BY tick_hour DESC LIMIT 1`,
    );
    const currentTickId = tickResult.rows[0]?.id ?? null;

    if (targetTierIdx > currentTierIdx) {
      // 升级装修
      const cost = calculateDecorationCost({ currentTier, targetTier, area });
      const consumeResult = await consumeSpiritStones(characterId, cost);
      if (!consumeResult.success) return { success: false, message: '灵石不足' };

      await query(
        `
          UPDATE shop_detail
          SET decoration_tier = $1,
              last_decorate_tick_id = $2,
              updated_at = NOW()
          WHERE id = $3 AND character_id = $4
        `,
        [targetTier, currentTickId?.toString() ?? null, shopId, characterId],
      );

      return {
        success: true,
        message: `装修升级到 ${DECORATION_TIER_LABEL[targetTier]}，消耗 ${Number(cost)} 灵石`,
        newTier: targetTier,
        cost: Number(cost),
      };
    } else {
      // 降级装修
      const refund = calculateDecorationRefund({ currentTier, targetTier, area });
      const addResult = await addSpiritStones(characterId, refund);
      if (!addResult.success) return { success: false, message: addResult.message };

      await query(
        `
          UPDATE shop_detail
          SET decoration_tier = $1,
              last_decorate_tick_id = $2,
              updated_at = NOW()
          WHERE id = $3 AND character_id = $4
        `,
        [targetTier, currentTickId?.toString() ?? null, shopId, characterId],
      );

      return {
        success: true,
        message: `装修降级到 ${DECORATION_TIER_LABEL[targetTier]}，返还 ${Number(refund)} 灵石`,
        newTier: targetTier,
        refund: Number(refund),
      };
    }
  }

  /**
   * 空间阵法扩展。
   * 费用 = 空间扩展费用 + 扩展面积装修费用（10㎡ × 当前等级单价）
   */
  @Transactional
  async expandSpace(characterId: number, shopId: number): Promise<SpaceExpansionResult> {
    ensureShopFeatureEnabled();
    // 加锁读取店铺
    const shopResult = await query<ShopRow>(
      `
        SELECT * FROM shop_detail
        WHERE id = $1 AND character_id = $2
        FOR UPDATE
      `,
      [shopId, characterId],
    );
    const shop = shopResult.rows[0];
    if (!shop) return { success: false, message: '店铺不存在' };

    const expansion = toIntValue(shop.space_expansion);
    const tier = shop.decoration_tier as DecorationTier;
    const tierPrice = DECORATION_TIER_PRICE_PER_SQM[tier];
    const spaceCost = calculateSpaceExpansionCost({ currentExpansion: expansion, decorationTier: tier });
    const decorCost = BigInt(tierPrice * SPACE_EXPANSION_AREA_INCREMENT);
    const totalCost = spaceCost + decorCost;

    const consumeResult = await consumeSpiritStones(characterId, totalCost);
    if (!consumeResult.success) return { success: false, message: '灵石不足' };

    const newArea = toIntValue(shop.area) + SPACE_EXPANSION_AREA_INCREMENT;
    await query(
      `
        UPDATE shop_detail
        SET space_expansion = space_expansion + 1,
            area = $1,
            updated_at = NOW()
        WHERE id = $2 AND character_id = $3
      `,
      [newArea, shopId, characterId],
    );

    return {
      success: true,
      message: `空间扩展成功，当前面积 ${newArea} ㎡，消耗 ${Number(totalCost)} 灵石`,
      newExpansion: expansion + 1,
      newArea,
      cost: Number(totalCost),
    };
  }

  /**
   * 免费领取初始店铺（容错机制）。
   * 每种类型最多 1 间。
   */
  @Transactional
  async claimInitialShop(characterId: number): Promise<ClaimInitialShopResult> {
    ensureShopFeatureEnabled();
    // 检查是否已有该类型店铺
    const existCheck = await query(
      `SELECT id FROM shop_detail WHERE character_id = $1 AND shop_type = $2`,
      [characterId, INITIAL_SHOP_TYPE],
    );
    if (existCheck.rows.length > 0) {
      return { success: false, message: '已拥有该类型店铺' };
    }

    // 检查是否已有任意店铺（防止滥用）
    const anyShopCheck = await query(
      `SELECT id FROM shop_detail WHERE character_id = $1 LIMIT 1`,
      [characterId],
    );

    const config = SHOP_TYPE_CONFIG[INITIAL_SHOP_TYPE];
    const area = config.initialArea;

    await query(
      `
        INSERT INTO shop_detail (
          character_id, shop_type, area, decoration_tier,
          upgrade_level, space_expansion, pending_rent,
          total_rent_collected, rent_tick_count, updated_at
        ) VALUES ($1, $2, $3, $4, 0, 0, 0, 0, 0, NOW())
        ON CONFLICT (character_id, shop_type) DO NOTHING
        RETURNING id
      `,
      [characterId, INITIAL_SHOP_TYPE, area, INITIAL_SHOP_TIER],
    );

    const shopResult = await query<ShopRow>(
      `SELECT * FROM shop_detail WHERE character_id = $1 AND shop_type = $2`,
      [characterId, INITIAL_SHOP_TYPE],
    );
    const shop = shopResult.rows[0];
    if (!shop) return { success: false, message: '领取失败，请稍后重试' };

    return {
      success: true,
      message: `免费领取 ${config.name}店铺成功！`,
      shop: this.buildShopDto(shop, null),
    };
  }

  /**
   * 购买新类型店铺。
   * 每种类型最多 1 间，购买成本固定。
   */
  @Transactional
  async purchaseShop(characterId: number, shopType: ShopType): Promise<PurchaseShopResult> {
    ensureShopFeatureEnabled();
    // 检查是否已有该类型店铺
    const existCheck = await query(
      `SELECT id FROM shop_detail WHERE character_id = $1 AND shop_type = $2`,
      [characterId, shopType],
    );
    if (existCheck.rows.length > 0) {
      return { success: false, message: '已拥有该类型店铺' };
    }

    const config = SHOP_TYPE_CONFIG[shopType];
    if (!config) return { success: false, message: '店铺类型不存在' };
    if (config.purchaseCost <= 0) return { success: false, message: '该类型不可购买' };

    const cost = BigInt(config.purchaseCost);
    const consumeResult = await consumeSpiritStones(characterId, cost);
    if (!consumeResult.success) return { success: false, message: '灵石不足' };

    await query(
      `
        INSERT INTO shop_detail (
          character_id, shop_type, area, decoration_tier,
          upgrade_level, space_expansion, pending_rent,
          total_rent_collected, rent_tick_count, updated_at
        ) VALUES ($1, $2, $3, $4, 0, 0, 0, 0, 0, NOW())
        RETURNING *
      `,
      [characterId, shopType, config.initialArea, DECORATION_TIERS.YELLOW],
    );

    const shopResult = await query<ShopRow>(
      `SELECT * FROM shop_detail WHERE character_id = $1 AND shop_type = $2`,
      [characterId, shopType],
    );
    const shop = shopResult.rows[0];
    if (!shop) return { success: false, message: '购买失败，请稍后重试' };

    return {
      success: true,
      message: `购买 ${config.name}店铺成功，消耗 ${config.purchaseCost} 灵石`,
      shop: this.buildShopDto(shop, null),
      cost: config.purchaseCost,
    };
  }

  /**
   * 为角色创建初始店铺（角色创建时调用）。
   */
  async createInitialShopForCharacter(characterId: number): Promise<void> {
    ensureShopFeatureEnabled();
    const config = SHOP_TYPE_CONFIG[INITIAL_SHOP_TYPE];
    await query(
      `
        INSERT INTO shop_detail (
          character_id, shop_type, area, decoration_tier,
          upgrade_level, space_expansion, pending_rent,
          total_rent_collected, rent_tick_count, updated_at
        ) VALUES ($1, $2, $3, $4, 0, 0, 0, 0, 0, NOW())
        ON CONFLICT (character_id, shop_type) DO NOTHING
      `,
      [characterId, INITIAL_SHOP_TYPE, config.initialArea, INITIAL_SHOP_TIER],
    );
  }

  /**
   * Tick 批量结算租金。
   * 创建独立的 shop_tick 记录，不依赖 stock_market_tick。
   */
  async processRentTick(tickHour: Date): Promise<{ processed: number; tickId: bigint }> {
    ensureShopFeatureEnabled();
    // 创建 shop_tick 记录
    const tickInsertResult = await query<{ id: string | number | bigint }>(
      `
        INSERT INTO shop_tick (tick_hour, status, created_at)
        VALUES ($1, 'running', $2)
        ON CONFLICT (tick_hour) DO NOTHING
        RETURNING id
      `,
      [tickHour, tickHour],
    );
    const insertedTick = tickInsertResult.rows[0];
    if (!insertedTick) {
      const existingResult = await query<{ id: string | number | bigint }>(
        `SELECT id FROM shop_tick WHERE tick_hour = $1`,
        [tickHour],
      );
      const existingTickId = existingResult.rows[0]?.id ?? 0;
      return { processed: 0, tickId: BigInt(existingTickId) };
    }

    const currentTickId = BigInt(insertedTick.id);

    const allShops = await query<ShopRow>(
      `
        SELECT id, shop_type, decoration_tier, upgrade_level, space_expansion,
               pending_rent, last_rent_tick_id, last_decorate_tick_id
        FROM shop_detail
      `,
    );

    if (allShops.rows.length === 0) {
      await query(
        `UPDATE shop_tick SET status = 'generated', finished_at = NOW() WHERE id = $1`,
        [currentTickId.toString()],
      );
      return { processed: 0, tickId: currentTickId };
    }

    let processed = 0;
    for (const row of allShops.rows) {
      const lastDecorateTickId = row.last_decorate_tick_id;
      if (lastDecorateTickId !== null && toBigIntValue(lastDecorateTickId) === currentTickId) {
        continue;
      }

      const shopType = validateShopType(row.shop_type);
      const decorationTier = validateDecorationTier(row.decoration_tier);
      if (!shopType || !decorationTier) continue;

      const upgradeLevel = toIntValue(row.upgrade_level);
      const spaceExpansion = toIntValue(row.space_expansion);
      const rentPerTick = calculateRentPerTick({
        shopType,
        decorationTier,
        spaceExpansion,
        upgradeLevel,
      });

      const maxPendingRent = rentPerTick * BigInt(MAX_PENDING_RENT_TICKS);
      const cappedPendingRent = toBigIntValue(row.pending_rent) + rentPerTick > maxPendingRent
        ? maxPendingRent
        : toBigIntValue(row.pending_rent) + rentPerTick;

      await query(
        `
          UPDATE shop_detail
          SET pending_rent = $1,
              last_rent_tick_id = $2,
              updated_at = NOW()
          WHERE id = $3
        `,
        [cappedPendingRent.toString(), currentTickId.toString(), toIntValue(row.id)],
      );

      processed++;
    }

    await query(
      `UPDATE shop_tick SET status = 'generated', finished_at = NOW() WHERE id = $1`,
      [currentTickId.toString()],
    );

    return { processed, tickId: currentTickId };
  }
}

export const shopService = new ShopService();
