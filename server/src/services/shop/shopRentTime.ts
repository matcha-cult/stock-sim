/**
 * 收租系统周期时间工具。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：计算收租 tick 的时间边界和调度延迟。
 * 2. 不做什么：不启动定时器、不处理收租逻辑。
 *
 * 输入 / 输出：
 * - 输入：任意 Date。
 * - 输出：当前 tick 边界和下一次 tick 时间、调度延迟。
 *
 * 复用设计说明：
 * - 与股市 tick 时间工具保持同一模式，仅间隔不同（由 SHOP_RENT_TICK_INTERVAL_MS 控制）。
 *
 * 关键边界条件与坑点：
 * 1. 使用 UTC 毫秒时间戳按周期取整作为 shop_tick 表唯一键，避免时区变化影响幂等。
 * 2. 当前时间刚好落在周期边界时，下一次刷新必须是下一个周期。
 */
import { SHOP_RENT_TICK_INTERVAL_MS } from './types.js';

export const floorShopRentTickTime = (date: Date): Date => {
  const tickTime = Math.floor(date.getTime() / SHOP_RENT_TICK_INTERVAL_MS) * SHOP_RENT_TICK_INTERVAL_MS;
  return new Date(tickTime);
};

export const getNextShopRentTickAt = (date: Date = new Date()): Date => {
  const currentTick = floorShopRentTickTime(date);
  const nextTick = new Date(currentTick.getTime() + SHOP_RENT_TICK_INTERVAL_MS);
  return nextTick.getTime() <= date.getTime()
    ? new Date(nextTick.getTime() + SHOP_RENT_TICK_INTERVAL_MS)
    : nextTick;
};

export const getShopRentTickDelayMs = (date: Date = new Date()): number => {
  return Math.max(0, getNextShopRentTickAt(date).getTime() - date.getTime());
};
