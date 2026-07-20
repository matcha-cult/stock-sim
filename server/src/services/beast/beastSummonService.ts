/**
 * 祭坛召唤服务
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：处理祭坛召唤流程——消耗祭品、匹配配方、创建灵兽草稿、确认加入。
 * 2. 不做什么：不处理 HTTP 参数。
 *
 * 数据流 / 状态流：
 * route -> beastSummonService -> beastAltarRules + SQL -> DTO。
 *
 * 关键边界条件与坑点：
 * 1) 草稿灵兽在确认前不计入灵兽上限。
 * 2) 祭品必须恰好 3 个。
 */
import { query } from '../../config/database.js';
import { getBeastDefinitionById, getBeastTemplateById, getAltarRecipes, getBloodlineById, getEnabledBeastDefinitions } from './beastConfigLoader.js';
import { matchAltarRecipe } from './shared/beastAltarRules.js';
import { generateInitialAptitudeBonus } from './shared/beastCultivationRules.js';
import { loadSingleBeastRow, loadBeastDetailById, type BeastDetailDto } from './shared/beastView.js';

/** 角色模板 ID 列表（召唤时随机选择） */
const ROLE_TEMPLATE_IDS = ['tpl-balanced', 'tpl-attack', 'tpl-defense', 'tpl-support'];
import { consumeSpiritStones } from '../inventory/shared/consume.js';
import { removeItem } from '../inventory/unifiedInventoryService.js';
import { getItemDefinition } from '../inventory/itemConfigLoader.js';
import { getAllCrops, getCropConfig } from '../farm/farmConfigLoader.js';
import { recordBeastAction } from './beastActionLogService.js';

interface ServiceResult<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
}

// ==================== 召唤生成 ====================

export interface SummonGenerateDto extends BeastDetailDto {
  minSpiritStones: number;
}

export interface OfferingInput {
  itemId: string;
  quality?: 'hq' | 'normal' | 'lq';
}

/**
 * 发起祭坛召唤。
 * 消耗祭品（最多6种，每种1交易单位）+ 灵石，匹配配方，创建草稿灵兽。
 * 灵石超出最低需求部分会提升资质（每倍+2%，上限+10%）。
 * 劣质祭品有90%概率召唤失败，优质祭品资质额外+5%。
 */
export const generateSummon = async (
  characterId: number,
  offerings: OfferingInput[],
  spiritStones: number,
): Promise<ServiceResult<SummonGenerateDto>> => {
  if (offerings.length === 0 || offerings.length > 6) {
    return { success: false, message: '祭品数量必须在 1-6 之间' };
  }

  // 检查是否有劣质祭品，90%概率失败
  const hasLowQuality = offerings.some((o) => o.quality === 'lq');
  if (hasLowQuality && Math.random() < 0.9) {
    // 消耗祭品
    for (const offering of offerings) {
      await consumeOffering(characterId, offering.itemId, offering.quality);
    }
    // 吞掉灵石
    await consumeSpiritStones(characterId, BigInt(spiritStones), {
      bizType: 'altar_summon',
      bizId: 'failed_summon_lq',
      memo: '祭坛召唤失败：劣质祭品导致献祭被终止',
    });
    return { success: false, message: '祭品已被接受，被单方面终止献祭，传送通道关闭。' };
  }

  // 消耗祭品（每种1交易单位）
  for (const offering of offerings) {
    const consumeResult = await consumeOffering(characterId, offering.itemId, offering.quality);
    if (!consumeResult.success) {
      return { success: false, message: consumeResult.message };
    }
  }

  const recipes = getAltarRecipes();
  const matchResult = matchAltarRecipe(offerings.map((o) => o.itemId), recipes);

  if (!matchResult.matchedRecipe) {
    // 未匹配配方，吞掉灵石和祭品
    await consumeSpiritStones(characterId, BigInt(spiritStones), {
      bizType: 'altar_summon',
      bizId: 'failed_summon',
      memo: '祭坛召唤失败：无法匹配配方',
    });
    return { success: false, message: '传送门打开...但是立即崩溃' };
  }

  const bloodlineId = matchResult.matchedRecipe.bloodline_id;
  const bloodline = getBloodlineById(bloodlineId);
  if (!bloodline) {
    return { success: false, message: '血脉配置不存在' };
  }

  // 根据血脉元素筛选可承载的基础灵
  const element = bloodline.element;
  const candidates = element === null
    ? getEnabledBeastDefinitions().filter(d => d.attribute_element.length === 0)
    : getEnabledBeastDefinitions().filter(d => d.attribute_element.includes(element));
  if (candidates.length === 0) {
    return { success: false, message: '无匹配的基础灵' };
  }
  // 从候选中随机选择一个
  const beastDefId = candidates[Math.floor(Math.random() * candidates.length)].id;

  const def = getBeastDefinitionById(beastDefId);
  if (!def) {
    return { success: false, message: '灵兽模板不存在' };
  }

  // 根据血脉配置决定基础模板
  const templateId = bloodline.forced_template
    ? bloodline.forced_template  // SSR 强制使用 balanced
    : ROLE_TEMPLATE_IDS[Math.floor(Math.random() * ROLE_TEMPLATE_IDS.length)];  // SR 随机选择
  const template = getBeastTemplateById(templateId);
  if (!template) {
    return { success: false, message: '角色模板不存在' };
  }

  // 统一最低灵石需求：50w
  const MIN_SPIRIT_STONES = 500000;

  // 检查灵石是否足够
  if (spiritStones < MIN_SPIRIT_STONES) {
    return { success: false, message: `灵石不足，至少需要 ${MIN_SPIRIT_STONES.toLocaleString()}` };
  }

  // 计算资质加成：每超出1倍+1%，上限+10%
  const multiples = Math.floor(spiritStones / MIN_SPIRIT_STONES);
  let bonusPercent = Math.min(0.10, (multiples - 1) * 0.01);

  // 优质祭品额外+5%（与灵石加成独立，可叠加）
  const hasHighQuality = offerings.some((o) => o.quality === 'hq');
  if (hasHighQuality) {
    bonusPercent = Math.min(0.15, bonusPercent + 0.05);
  }

  // 生成初始资质加成乘数并应用灵石加成
  const baseAptitudeBonus = generateInitialAptitudeBonus(template.base_aptitude_level);
  const aptitudeBonus = baseAptitudeBonus * (1 + bonusPercent);

  // 消耗灵石
  const consumeResult = await consumeSpiritStones(characterId, BigInt(spiritStones), {
    bizType: 'altar_summon',
    bizId: String(def.id),
    memo: `祭坛召唤：${def.name}（${bloodline.name}）`,
  });
  if (!consumeResult.success) {
    return { success: false, message: '灵石消耗失败' };
  }

  // 创建草稿灵兽（is_active=FALSE，obtained_from='altar'，custom_tag 默认空）
  const insertResult = await query<{ id: number }>(
    `INSERT INTO character_beast
       (character_id, beast_def_id, bloodline_id, nickname, level, progress_exp,
        template_id, aptitude_bonus,
        cultivation_count, beast_tier, star_level, is_transformed, is_active, obtained_from, updated_at)
     VALUES ($1, $2, $3, $4, 1, 0,
             $5, $6,
             0, 'huang', 1, FALSE, FALSE, 'altar', NOW())
     RETURNING id`,
    [
      characterId, def.id, bloodline.id, def.name,
      templateId, aptitudeBonus,
    ],
  );

  const beastId = insertResult.rows[0]?.id;
  if (!beastId) {
    return { success: false, message: '创建灵兽失败' };
  }

  // 血脉天赋将在化形后解锁，此处不再创建天生兽诀

  // 获取祭品名称用于日志记录
  const allCrops = getAllCrops();
  const offeringNames = offerings.map((o) => {
    const crop = allCrops.find((c) => c.seedItemId === o.itemId);
    const name = crop?.name ?? o.itemId;
    return o.quality ? `${name}(${o.quality})` : name;
  });

  // 记录操作日志
  await recordBeastAction({
    characterId,
    actionType: 'summon',
    spiritStonesCost: spiritStones,
    otherCost: `祭品: ${offeringNames.join(', ')}`,
    actionDetail: `召唤获得 ${def.name}（${bloodline.name}）`,
  });

  // 获取完整的灵兽详情
  const beastDetail = await loadBeastDetailById(beastId);
  if (!beastDetail) {
    return { success: false, message: '获取灵兽详情失败' };
  }

  return {
    success: true,
    data: {
      ...beastDetail,
      minSpiritStones: MIN_SPIRIT_STONES,
    },
  };
};

export interface BatchSummonResult {
  successCount: number;
  failCount: number;
  errors: string[];
}

/**
 * 批量召唤（自动签订契约）。
 * 一次请求处理多次召唤，避免前端循环调用触发限流。
 */
export const batchSummon = async (
  characterId: number,
  offerings: OfferingInput[],
  spiritStones: number,
  count: number,
): Promise<ServiceResult<BatchSummonResult>> => {
  if (count <= 0 || count > 50) {
    return { success: false, message: '召唤次数必须在 1-50 之间' };
  }

  const result: BatchSummonResult = {
    successCount: 0,
    failCount: 0,
    errors: [],
  };

  for (let i = 0; i < count; i++) {
    const summonResult = await generateSummon(characterId, offerings, spiritStones);
    if (summonResult.success && summonResult.data) {
      // 批量召唤自动签订契约（灵兽已创建，无需额外操作）
      // 注意：不设置 is_active=TRUE，因为那表示"出战中"
      result.successCount++;
    } else {
      result.failCount++;
      if (summonResult.message) {
        result.errors.push(summonResult.message);
      }
      // 如果是灵石不足或祭品不足，提前终止
      if (summonResult.message?.includes('灵石不足') || summonResult.message?.includes('祭品不足')) {
        break;
      }
    }
  }

  return { success: true, data: result };
};

/**
 * 确认灵兽加入（草稿 -> 正式）。
 * 当前实现中草稿直接就是正式的，此方法保留用于未来扩展。
 */
export const confirmSummon = async (
  characterId: number,
  beastId: number,
): Promise<ServiceResult> => {
  const row = await loadSingleBeastRow(beastId);
  if (!row || row.character_id !== characterId) {
    return { success: false, message: '灵兽不存在' };
  }
  return { success: true };
};

/**
 * 放弃灵兽（删除草稿）。
 */
export const discardSummon = async (
  characterId: number,
  beastId: number,
): Promise<ServiceResult> => {
  const row = await loadSingleBeastRow(beastId);
  if (!row || row.character_id !== characterId) {
    return { success: false, message: '灵兽不存在' };
  }

  if (row.is_active) {
    return { success: false, message: '已出战的灵兽不能放弃' };
  }

  await query('DELETE FROM character_beast WHERE id = $1', [beastId]);
  return { success: true };
};

// ==================== 祭品消耗 ====================

/**
 * 消耗 1 个交易单位的祭品。
 * 从统一背包扣除：有品质（hq/normal/lq）扣除对应品质的物品，无品质从种子扣除。
 */
const consumeOffering = async (
  characterId: number,
  itemId: string,
  quality?: 'hq' | 'normal' | 'lq',
): Promise<ServiceResult> => {
  // 获取物品配置
  const itemDef = getItemDefinition(itemId);

  // 先检查是否为圣物类祭品（无作物配置）
  if (itemDef && itemDef.subcategory === 'relic') {
    // 圣物类祭品：交易单位为 1
    const removeResult = await removeItem({
      characterId,
      itemKey: itemId,
      quantity: 1,
      operationType: 'consume',
      bizType: 'beast_summon',
      memo: `祭坛召唤消耗：${itemDef.name}`,
    });

    if (!removeResult.success) {
      return {
        success: false,
        message: `祭品不足：${itemDef.name}（需要 1 个）`,
      };
    }
    return { success: true };
  }

  // 作物类祭品：获取作物配置以确定交易单位大小
  const allCrops = getAllCrops();
  // 支持种子（seed_xxx）和收获物（material_xxx）的 item_key
  let cropConfig = allCrops.find((c) => c.seedItemId === itemId);
  if (!cropConfig) {
    // 从 material_xxx 提取 cropId（xxx）
    const cropId = itemId.replace(/^material_/, '');
    cropConfig = allCrops.find((c) => c.cropId === cropId);
  }
  if (!cropConfig) {
    return { success: false, message: `祭品配置不存在：${itemId}` };
  }

  // 从 items.attributes.tradeUnit 获取交易单位
  const tradeUnit = itemDef?.attributes?.tradeUnit ?? 1;

  // 从统一背包扣除
  const removeResult = await removeItem({
    characterId,
    itemKey: itemId,
    quantity: tradeUnit,
    attributes: quality ? { quality } : undefined,
    operationType: 'consume',
    bizType: 'beast_summon',
    memo: `祭坛召唤消耗：${cropConfig.name}${quality ? `（${quality}品质）` : ''}`,
  });

  if (!removeResult.success) {
    return {
      success: false,
      message: `祭品不足：${cropConfig.name}${quality ? `（${quality}品质，需要 ${tradeUnit} 个）` : `（需要 ${tradeUnit} 个）`}`,
    };
  }

  return { success: true };
};
