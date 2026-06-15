/**
 * 灵田格子本地状态计算。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：根据 intervals 和当前时间，本地计算格子当前所处的区间、进度、阶段标签。
 * 2. 不做什么：不做网络请求、不做调度。
 *
 * 数据流 / 状态流：
 * 后端下发 intervals（配置时间，未加速） + accelerationMultiplier → 前端本地计算 → CellCard 渲染。
 *
 * 复用设计说明：
 * - 纯函数，无副作用，可被 CellCard 和测试复用。
 * - 二分查找优化区间定位（O(log n)）。
 * - 计算逻辑与后端 computeCropState 保持一致：用加速后的有效时间判断阶段。
 *
 * 关键边界条件与坑点：
 * 1. 枯萎区间的 endAt 为 Infinity，需特殊处理（进度显示 100%）。
 * 2. 如果 now 早于第一个区间的 startAt（时钟不同步），返回第一个区间。
 * 3. intervals 表示配置时间（未加速），计算进度时需乘以 accelerationMultiplier。
 */

import type { StageIntervalDto, CropStage } from '../../services/api/farm';

export interface LocalCropState {
  intervalIndex: number;
  stage: CropStage;
  stageIndex: number;
  stageLabel: string;
  /** 区间内进度百分比（0-100）。枯萎固定为 100。 */
  progressPercent: number;
}

/**
 * 根据 intervals 和当前时间计算本地状态。
 * 使用二分查找定位当前区间（O(log n)）。
 *
 * @param intervals 后端下发的阶段区间列表（配置时间，未加速）
 * @param now 当前时间戳（毫秒）
 * @param accelerationMultiplier 加速倍率（后端返回，用于计算有效经过时间）
 */
export function computeLocalState(
  intervals: StageIntervalDto[],
  now: number,
  accelerationMultiplier: number = 1.0,
): LocalCropState {
  if (intervals.length === 0) {
    // 防御性兜底，理论上不会出现
    return {
      intervalIndex: -1,
      stage: 'withered',
      stageIndex: -1,
      stageLabel: '枯萎',
      progressPercent: 100,
    };
  }

  // 计算加速后的有效时间（与后端 elapsedMinutes 逻辑一致）
  const effectiveNow = intervals[0].startAt + (now - intervals[0].startAt) * accelerationMultiplier;

  // 二分查找：找到第一个 endAt > effectiveNow 的区间
  let lo = 0;
  let hi = intervals.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (intervals[mid].endAt > effectiveNow) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  const iv = intervals[lo];

  // 检查 effectiveNow 是否在区间内（startAt <= effectiveNow < endAt）
  // 如果 effectiveNow < startAt（时钟不同步），返回第一个区间
  if (effectiveNow < iv.startAt) {
    const first = intervals[0];
    return {
      intervalIndex: 0,
      stage: first.stage,
      stageIndex: first.stageIndex,
      stageLabel: first.stageLabel,
      progressPercent: 0,
    };
  }

  // 计算进度（使用有效时间）
  let progressPercent: number;
  if (iv.endAt === Infinity) {
    // 枯萎区间，进度固定 100%
    progressPercent = 100;
  } else {
    const duration = iv.endAt - iv.startAt;
    const elapsed = effectiveNow - iv.startAt;
    progressPercent = Math.min(100, Math.floor((elapsed / duration) * 100));
  }

  return {
    intervalIndex: lo,
    stage: iv.stage,
    stageIndex: iv.stageIndex,
    stageLabel: iv.stageLabel,
    progressPercent,
  };
}
