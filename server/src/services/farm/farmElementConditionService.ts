/**
 * 灵田 V4 — 元素条件判定服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：硬编码元素条件判定逻辑（单元素入侵、元素相生、五行归元）。
 * 2. 不做什么：不做杂交配方匹配（farmHybridService）、不做数据库操作。
 *
 * 数据流 / 状态流：
 * farmHybridService → checkElementCondition() → 返回布尔值。
 *
 * 复用设计说明：
 * - 条件 ID 常量化，便于配方引用和代码维护。
 * - 条件判定函数纯函数化，便于测试和复用。
 *
 * 关键边界条件与坑点：
 * 1. 五行归元不考虑元素数量，只检查五种元素是否全部出现（去重后）。
 * 2. 单元素入侵和元素相生需要动态参数（element/elements），由配方指定。
 */
import type { CropConfig, CropElement } from './farmTypes.js';

// ── 条件 ID 常量 ──

export const ELEMENT_CONDITIONS = {
  SINGLE_ELEMENT_INVASION: 'single_element_invasion',
  DUAL_ELEMENT_GENERATION: 'dual_element_generation',
  WU_XING_GUI_YUAN: 'wu_xing_gui_yuan',
} as const;

// ── 条件判定函数 ──

/**
 * 检查相邻作物是否满足指定的元素条件。
 *
 * @param conditionId 条件 ID（参考 ELEMENT_CONDITIONS）
 * @param adjacentCrops 相邻作物配置数组
 * @param params 动态参数（单元素条件需要 element，双元素条件需要 elements）
 * @returns 是否满足条件
 */
export function checkElementCondition(
  conditionId: string,
  adjacentCrops: CropConfig[],
  params?: { element?: CropElement; elements?: CropElement[] },
): boolean {
  switch (conditionId) {
    case ELEMENT_CONDITIONS.SINGLE_ELEMENT_INVASION:
      return checkSingleElementInvasion(adjacentCrops, params?.element);
    case ELEMENT_CONDITIONS.DUAL_ELEMENT_GENERATION:
      return checkDualElementGeneration(adjacentCrops, params?.elements);
    case ELEMENT_CONDITIONS.WU_XING_GUI_YUAN:
      return checkWuXingGuiYuan(adjacentCrops);
    default:
      return false;
  }
}

/**
 * 单元素入侵：检查相邻作物中是否有指定元素。
 *
 * @param adjacentCrops 相邻作物配置数组
 * @param element 指定的元素（如 "金"）
 * @returns 是否有作物具有该元素
 */
function checkSingleElementInvasion(adjacentCrops: CropConfig[], element?: CropElement): boolean {
  if (!element) return false;
  return adjacentCrops.some((crop) => crop.element.includes(element));
}

/**
 * 元素相生：检查相邻作物中是否同时有两种元素。
 *
 * @param adjacentCrops 相邻作物配置数组
 * @param elements 指定的两种元素（如 ["水", "木"]）
 * @returns 是否同时具有这两种元素
 */
function checkDualElementGeneration(adjacentCrops: CropConfig[], elements?: CropElement[]): boolean {
  if (!elements || elements.length !== 2) return false;
  const hasElement = (elem: CropElement) => adjacentCrops.some((crop) => crop.element.includes(elem));
  return hasElement(elements[0]) && hasElement(elements[1]);
}

/**
 * 五行归元：检查相邻作物的元素是否五种全部出现,并处理多余元素。
 *
 * 底层世界观设定：
 * 1. 收集所有相邻作物带来的元素影响（计数）
 * 2. 如果五种元素（金、木、水、火、土）全部出现 → 五种元素抵消归零
 * 3. 抵消时,每种元素各消耗 1 个
 * 4. 如果某元素出现多次,抵消后还剩余的 → 作物受多余元素影响,继续参与后续杂交判定
 *
 * 示例：
 * - 相邻有 2个金灵稻[金] + 1个灵根·木[木] + 1个灵根·水[水] + 1个灵根·火[火] + 1个灵根·土[土]
 * - 元素计数：金×2, 木×1, 水×1, 火×1, 土×1
 * - 五种齐全 → 抵消：金×1, 木×0, 水×0, 火×0, 土×0
 * - 剩余：金×1 → 目标作物受金元素影响,可参与金灵稻杂交
 *
 * @param adjacentCrops 相邻作物配置数组
 * @returns 是否五行齐全（归零）
 */
function checkWuXingGuiYuan(adjacentCrops: CropConfig[]): boolean {
  // 统计每个元素的出现次数
  const elementCount = new Map<CropElement, number>();
  for (const crop of adjacentCrops) {
    for (const elem of crop.element) {
      elementCount.set(elem, (elementCount.get(elem) ?? 0) + 1);
    }
  }

  // 检查五种元素是否全部出现
  const requiredElements: CropElement[] = ['金', '木', '水', '火', '土'];
  const allPresent = requiredElements.every((elem) => (elementCount.get(elem) ?? 0) >= 1);
  if (!allPresent) {
    return false;
  }

  // 五行齐全,每种元素各消耗 1 个
  for (const elem of requiredElements) {
    const count = elementCount.get(elem) ?? 0;
    if (count > 1) {
      elementCount.set(elem, count - 1);
    } else {
      elementCount.delete(elem);
    }
  }

  // 注意：此函数返回是否五行齐全（归零）
  // 多余元素的处理在 checkRequiredAdjacent 中通过其他条件判定
  return true;
}

/**
 * 获取五行归元后剩余的元素（用于后续条件判定）。
 *
 * @param adjacentCrops 相邻作物配置数组
 * @returns 剩余元素数组（去重后的元素列表）
 */
export function getRemainingElementsAfterWuXing(adjacentCrops: CropConfig[]): CropElement[] {
  // 统计每个元素的出现次数
  const elementCount = new Map<CropElement, number>();
  for (const crop of adjacentCrops) {
    for (const elem of crop.element) {
      elementCount.set(elem, (elementCount.get(elem) ?? 0) + 1);
    }
  }

  // 检查五种元素是否全部出现
  const requiredElements: CropElement[] = ['金', '木', '水', '火', '土'];
  const allPresent = requiredElements.every((elem) => (elementCount.get(elem) ?? 0) >= 1);

  if (allPresent) {
    // 五行齐全,每种元素各消耗 1 个
    for (const elem of requiredElements) {
      const count = elementCount.get(elem) ?? 0;
      if (count > 1) {
        elementCount.set(elem, count - 1);
      } else {
        elementCount.delete(elem);
      }
    }
  }

  // 返回剩余元素（去重）
  const remaining = new Set<CropElement>();
  for (const [elem, count] of elementCount.entries()) {
    if (count > 0) {
      remaining.add(elem);
    }
  }
  return Array.from(remaining);
}
