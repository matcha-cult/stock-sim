/**
 * 灵田格子调度器 — 统一管理所有格子的阶段切换唤醒。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：维护一个最小堆，按 intervals[].endAt 排序，单定时器驱动最近的切换点。
 * 2. 不做什么：不做进度条插值（由各 CellCard 自己处理）。
 *
 * 数据流 / 状态流：
 * - CellCard mount 时调用 register(key, intervals, callback)
 * - 调度器找到最近的 endAt（排除 Infinity），设定 setTimeout
 * - 到期时触发所有到时的 callback，然后重新调度下一个
 * - CellCard unmount 时调用 unregister(key)
 *
 * 复用设计说明：
 * - 模块级单例，所有 CellCard 共享同一个调度器
 * - 避免每个格子独立 setInterval，减少定时器数量
 *
 * 关键边界条件与坑点：
 * 1. intervals 必须是升序数组，且 endAt 为绝对时间（ms）或 Infinity
 * 2. Infinity（枯萎期）不参与调度
 * 3. 如果所有 endAt 都已过期或为 Infinity，调度器会立即触发并移除该格子
 */

import type { StageIntervalDto } from '../../services/api/farm';

type SchedulerCallback = () => void;

interface ScheduledCell {
  key: string;
  intervals: StageIntervalDto[];
  nextIndex: number; // 下一个要触发的 interval 索引（其 endAt 即将到期）
  callback: SchedulerCallback;
}

class PlotScheduler {
  private cells = new Map<string, ScheduledCell>();
  private timerId: ReturnType<typeof setTimeout> | null = null;

  /**
   * 注册一个格子。
   * @param key 格子唯一标识（如 `${row}-${col}`）
   * @param intervals 生命周期区间数组（升序）
   * @param callback 切换时触发的回调
   */
  register(key: string, intervals: StageIntervalDto[], callback: SchedulerCallback): void {
    const now = Date.now();
    // 找到第一个 endAt > now 且 endAt !== Infinity 的区间
    let nextIndex = intervals.findIndex((iv) => iv.endAt > now && iv.endAt !== Infinity);
    if (nextIndex === -1) {
      // 所有区间都已过期或为 Infinity，不注册
      return;
    }

    this.cells.set(key, {
      key,
      intervals,
      nextIndex,
      callback,
    });

    this.scheduleNext();
  }

  /**
   * 更新一个格子的 intervals（如播种后重新计算）。
   */
  update(key: string, intervals: StageIntervalDto[]): void {
    const cell = this.cells.get(key);
    if (!cell) return;

    const now = Date.now();
    const nextIndex = intervals.findIndex((iv) => iv.endAt > now && iv.endAt !== Infinity);
    if (nextIndex === -1) {
      this.unregister(key);
      return;
    }

    cell.intervals = intervals;
    cell.nextIndex = nextIndex;
    this.scheduleNext();
  }

  /**
   * 注销一个格子。
   */
  unregister(key: string): void {
    this.cells.delete(key);
    this.scheduleNext();
  }

  /**
   * 调度下一个最近的切换点。
   */
  private scheduleNext(): void {
    // 清除现有定时器
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    if (this.cells.size === 0) {
      return;
    }

    // 找到所有格子中最近的 endAt（排除 Infinity）
    let nearestTime = Infinity;
    let nearestCells: ScheduledCell[] = [];

    for (const cell of this.cells.values()) {
      const nextInterval = cell.intervals[cell.nextIndex];
      const nextTime = nextInterval?.endAt ?? Infinity;
      if (nextTime === Infinity) continue;

      if (nextTime < nearestTime) {
        nearestTime = nextTime;
        nearestCells = [cell];
      } else if (nextTime === nearestTime) {
        nearestCells.push(cell);
      }
    }

    if (nearestTime === Infinity) {
      return;
    }

    const delay = Math.max(0, nearestTime - Date.now());
    this.timerId = setTimeout(() => {
      this.handleTick(nearestCells);
    }, delay);
  }

  /**
   * 处理到期 tick：触发所有到期格子的回调，推进它们的 nextIndex，重新调度。
   */
  private handleTick(cells: ScheduledCell[]): void {
    this.timerId = null;

    const now = Date.now();
    const toRemove: string[] = [];

    for (const cell of cells) {
      // 触发回调
      cell.callback();

      // 推进 nextIndex
      cell.nextIndex++;

      // 检查是否还有未来的切换点
      if (cell.nextIndex >= cell.intervals.length) {
        toRemove.push(cell.key);
      } else {
        const nextEndAt = cell.intervals[cell.nextIndex].endAt;
        if (nextEndAt === Infinity || nextEndAt <= now) {
          // 下一个是枯萎期（Infinity）或已过期，移除
          toRemove.push(cell.key);
        }
      }
    }

    // 移除已完成的格子
    for (const key of toRemove) {
      this.cells.delete(key);
    }

    // 重新调度下一个
    this.scheduleNext();
  }

  /**
   * 清空所有注册（用于测试或页面卸载）。
   */
  clear(): void {
    this.cells.clear();
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}

// 模块级单例
export const plotScheduler = new PlotScheduler();
