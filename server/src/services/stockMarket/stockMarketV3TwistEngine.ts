/**
 * V3 反转引擎。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：每个 tick 独立判定是否触发场景中的子叙事反转，返回被反转覆盖的股票方向。
 * 2. 不做什么：不修改场景定义、不读写数据库、不直接调用 AI。
 *
 * 输入 / 输出：
 * - 输入：当前场景、seed（用于确定性随机）。
 * - 输出：activeTwists 列表（可能为空），每个条目包含被覆盖的 stockId、新方向、新强度、反转理由。
 *
 * 数据流 / 状态流：
 * tick 流程 → maybeTriggerTwists(scene, seed) → 返回 activeTwists → 合并到涨跌因子 → 传入 AI prompt。
 *
 * 复用设计说明：
 * - 反转判定逻辑集中在此，纯函数，不依赖外部状态。
 * - seed 驱动，同一 seed 结果一致，支持复盘回放。
 *
 * 关键边界条件与坑点：
 * 1. 每个反转条目独立判定，可能出现多条反转同时触发。
 * 2. 同一股票不可能被多个反转过载（每个场景的 possibleTwists 中 stockId 唯一）。
 * 3. 反转强度上限为 2（不超过 ±10%），避免盖过主趋势。
 */

import { V3_TWIST_MAX_STRENGTH, type V3SceneDefinition } from './stockMarketV3SceneDefinitions.js';

export type V3ActiveTwist = {
  stockId: string;
  directionOverride: 'bullish' | 'bearish';
  strengthOverride: number;
  narrativeReason: string;
};

/** 次级反转触发概率（20%）。 */
const TWIST_TRIGGER_PROBABILITY = 0.20;

/**
 * 判定当前 tick 触发了哪些反转。
 *
 * 每个 possibleTwists 条目独立判定，seed 驱动，可复现。
 *
 * @param scene 当前场景定义
 * @param seed 随机种子（0~2147483647）
 * @returns 触发中的反转列表（可能为空）
 */
export const maybeTriggerTwists = (
  scene: V3SceneDefinition,
  seed: number,
): V3ActiveTwist[] => {
  if (scene.possibleTwists.length === 0) return [];

  const activeTwists: V3ActiveTwist[] = [];

  for (let i = 0; i < scene.possibleTwists.length; i++) {
    const twist = scene.possibleTwists[i];
    // 确定性随机：用 scene ID + twist index + seed 生成独立骰子
    const twistSeed = hashSeed(seed, scene.id, i);
    const threshold = Math.floor((twistSeed / 2147483647) * 100);
    const triggerPercent = Math.round(TWIST_TRIGGER_PROBABILITY * 100);

    console.log(`[V3TwistEngine] 反转判定: ${twist.stockId} seed=${twistSeed} threshold=${threshold} trigger=${triggerPercent}% ${threshold < triggerPercent ? '✅ 触发' : '❌ 未触发'}`);
    if (threshold < triggerPercent) {
      activeTwists.push({
        stockId: twist.stockId,
        directionOverride: twist.directionOverride,
        strengthOverride: Math.min(twist.strengthOverride, V3_TWIST_MAX_STRENGTH),
        narrativeReason: twist.narrativeReason,
      });
    }
  }

  return activeTwists;
};

/** 简单的确定性 hash：seed + string + index → 0~2147483647 范围内的数字。 */
const hashSeed = (seed: number, sceneId: string, index: number): number => {
  let h = seed ^ sceneId.length;
  for (let i = 0; i < sceneId.length; i++) {
    h = ((h << 5) - h) ^ sceneId.charCodeAt(i);
    h |= 0; // 强制 32-bit 整数
  }
  h = (h ^ index) >>> 0; // 转无符号
  return h % 2147483647;
};
