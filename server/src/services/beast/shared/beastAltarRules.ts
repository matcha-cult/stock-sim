/**
 * 祭坛召唤配方规则（纯函数）
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：根据祭品（最多6种）匹配配方，计算偏好得分。
 * 2. 不做什么：不操作数据库，不消耗物品。
 *
 * 祭坛规则：
 * - 祭坛有 6 个格子，每个格子放一种物品，可放多个
 * - 最多使用 6 种不同的祭品
 *
 * 配方匹配规则：
 * 1. 每个配方有 preferred（偏好）和 disliked（厌恶），各包含三维：
 *    - elements: 元素汉字（如 ["木"]）
 *    - items: 物品ID（如 ["qi_xing_lian"]）
 *    - traits: 物品特性（如 ["七星"]）
 * 2. 对每个祭品，检查其元素、ID、特性是否命中偏好/厌恶
 * 3. 命中偏好 +1，命中厌恶 -1，总分为所有祭品得分之和
 * 4. 得分最高的配方胜出；同分则按 weight 加权随机
 *
 * 关键边界条件与坑点：
 * 1) 祭品最多 6 种。
 * 2) 祭品可以是作物（有元素和特性）或其他物品。
 */

import type { AltarRecipeConfig } from '../beastConfigLoader.js';
import { getBloodlineById } from '../beastConfigLoader.js';
import { getCropConfig, getSeedConfig } from '../../farm/farmConfigLoader.js';
import { getItemDefinition } from '../../inventory/itemConfigLoader.js';

/**
 * 祭品信息（从作物配置或物品配置中提取）。
 */
interface OfferingInfo {
  itemId: string;
  element: string | null;  // 元素汉字，无元素为 null
  traits: string[];        // 物品特性
  rarity: string | null;   // 稀有度（common/uncommon/rare/legendary）
}

/**
 * 获取祭品信息（元素 + 特性 + 稀有度）。
 * 支持种子ID（seed_xxx）、收获物品（material_xxx）和作物ID。
 */
const getOfferingInfo = (itemId: string): OfferingInfo => {
  // 先尝试作为种子ID查找
  const seedConfig = getSeedConfig(itemId);
  if (seedConfig) {
    const crop = getCropConfig(seedConfig.cropId);
    if (crop) {
      // 从物品配置获取 element, traits, rarity
      const itemDef = getItemDefinition(itemId);
      const element = itemDef?.attributes?.element ?? [];
      const elementFirst = element.length > 0 ? element[0] : null;
      return { itemId: seedConfig.cropId, element: elementFirst, traits: itemDef?.attributes?.traits ?? [], rarity: itemDef?.rarity ?? null };
    }
  }

  // 再尝试作为作物ID查找
  const crop = getCropConfig(itemId);
  if (crop) {
    // 从物品配置获取 element, traits, rarity（优先 material_xxx）
    const itemDef = getItemDefinition(`material_${itemId}`) ?? getItemDefinition(`seed_${itemId}`);
    const element = itemDef?.attributes?.element ?? [];
    const elementFirst = element.length > 0 ? element[0] : null;
    return { itemId: crop.cropId, element: elementFirst, traits: itemDef?.attributes?.traits ?? [], rarity: itemDef?.rarity ?? null };
  }

  // 尝试从 material_xxx 提取 cropId（xxx）
  if (itemId.startsWith('material_')) {
    const cropId = itemId.replace(/^material_/, '');
    const cropFromMaterial = getCropConfig(cropId);
    if (cropFromMaterial) {
      // 从物品配置获取 element, traits, rarity
      const itemDef = getItemDefinition(itemId);
      const element = itemDef?.attributes?.element ?? [];
      const elementFirst = element.length > 0 ? element[0] : null;
      return { itemId: cropFromMaterial.cropId, element: elementFirst, traits: itemDef?.attributes?.traits ?? [], rarity: itemDef?.rarity ?? null };
    }
  }

  // 非作物物品，尝试从物品配置获取信息
  const itemDef = getItemDefinition(itemId);
  if (itemDef) {
    // 圣物类祭品带有"圣物"特性
    const traits = itemDef.subcategory === 'relic' ? ['圣物'] : [];
    return { itemId, element: null, traits, rarity: itemDef.rarity ?? null };
  }

  // 完全未知的物品
  return { itemId, element: null, traits: [], rarity: null };
};

/**
 * 计算单个祭品对单个配方的得分。
 */
const calcOfferingScore = (
  offering: OfferingInfo,
  recipe: AltarRecipeConfig,
): number => {
  let score = 0;

  // 检查配方对应的血脉是否为无属性
  const bloodline = getBloodlineById(recipe.bloodline_id);
  const isVoidElement = bloodline?.element === null;

  // 无属性配方：奖励无元素祭品，惩罚有元素祭品
  if (isVoidElement) {
    if (offering.element === null) {
      score += 1;  // 无元素祭品加分
    } else {
      score -= 1;  // 有元素祭品扣分
    }
    return score;
  }

  // 有属性配方：原有逻辑
  // 检查元素维度
  if (offering.element) {
    if (recipe.preferred.elements.includes(offering.element)) score += 1;
    if (recipe.disliked.elements.includes(offering.element)) score -= 1;
  }

  // 检查物品ID维度
  if (recipe.preferred.items.includes(offering.itemId)) score += 1;
  if (recipe.disliked.items.includes(offering.itemId)) score -= 1;

  // 检查特性维度
  for (const trait of offering.traits) {
    if (recipe.preferred.traits.includes(trait)) score += 1;
    if (recipe.disliked.traits.includes(trait)) score -= 1;
  }

  return score;
};

/**
 * 计算配方的总匹配得分。
 */
const calcRecipeScore = (
  recipe: AltarRecipeConfig,
  offerings: string[],
): number => {
  let totalScore = 0;
  for (const itemId of offerings) {
    const offering = getOfferingInfo(itemId);
    totalScore += calcOfferingScore(offering, recipe);
  }
  return totalScore;
};

/**
 * 祭坛配方匹配结果。
 */
export interface AltarRecipeMatchResult {
  matchedRecipe: AltarRecipeConfig | null;
  score: number;
  allScores: Array<{ recipeId: string; score: number }>;
}

/**
 * 匹配祭坛配方，返回得分最高的配方。
 * 同分则按 weight 加权随机选取。
 * 祭坛最多 6 种祭品。
 */
export const matchAltarRecipe = (
  offerings: string[],
  recipes: readonly AltarRecipeConfig[],
): AltarRecipeMatchResult => {
  if (offerings.length === 0 || offerings.length > 6) {
    return { matchedRecipe: null, score: -Infinity, allScores: [] };
  }

  // 获取祭品信息（包含稀有度）
  const offeringInfos = offerings.map(id => getOfferingInfo(id));

  // 计算所有配方的得分
  const allScores = recipes.map((recipe) => {
    // 检查 required_rarity（SSR 配方需要无属性高稀有度祭品）
    if (recipe.required_rarity) {
      const hasVoidHighRarity = offeringInfos.some(info =>
        info.element === null && isHighRarity(info.rarity, recipe.required_rarity!)
      );
      if (!hasVoidHighRarity) {
        // 不满足 required_rarity，直接返回负分
        return { recipeId: recipe.id, score: -Infinity };
      }
    }
    return { recipeId: recipe.id, score: calcRecipeScore(recipe, offerings) };
  });

  // 找到最高分
  const maxScore = Math.max(...allScores.map((s) => s.score));

  // 如果最高分 <= 0，没有有效匹配
  if (maxScore <= 0) {
    return { matchedRecipe: null, score: maxScore, allScores };
  }

  // 收集所有最高分的配方
  const topRecipes = recipes.filter((recipe) => {
    const scoreEntry = allScores.find((s) => s.recipeId === recipe.id);
    return scoreEntry && scoreEntry.score === maxScore;
  });

  // 按 weight 加权随机选取
  const totalWeight = topRecipes.reduce((sum, r) => sum + r.weight, 0);
  let random = Math.random() * totalWeight;
  let selected = topRecipes[0];
  for (const recipe of topRecipes) {
    random -= recipe.weight;
    if (random <= 0) {
      selected = recipe;
      break;
    }
  }

  return { matchedRecipe: selected, score: maxScore, allScores };
};

/**
 * 检查稀有度是否满足最低要求。
 * 稀有度等级：common < uncommon < rare < legendary
 */
const isHighRarity = (rarity: string | null, minRarity: string): boolean => {
  if (!rarity) return false;
  const rarityLevels: Record<string, number> = {
    'common': 1,
    'uncommon': 2,
    'rare': 3,
    'legendary': 4,
  };
  return (rarityLevels[rarity] ?? 0) >= (rarityLevels[minRarity] ?? 0);
};
