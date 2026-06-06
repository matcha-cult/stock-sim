/**
 * 股市驱动器类型解析。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：解析 STOCK_MARKET_DRIVER 环境变量，返回确定的驱动器类型。
 * 2. 不做什么：不执行驱动器逻辑、不做数据迁移。
 *
 * 输入 / 输出：
 * - 输入：process.env.STOCK_MARKET_DRIVER
 * - 输出：'v1' | 'v3'，非法值默认回退 v1。
 *
 * 数据流 / 状态流：
 * 环境变量 → 归一化 → 校验 → 返回。
 *
 * 复用设计说明：
 * - 调度器和路由都调用此模块，避免开关逻辑散落。
 *
 * 关键边界条件与坑点：
 * 1. 非法值或空值默认回退 v1，确保线上不受影响。
 * 2. v2 已从驱动器列表中移除，如 .env 中仍为 v2 会回退到 v1。
 */

export type StockMarketDriverType = 'v1' | 'v3';

const VALID_DRIVERS: ReadonlySet<StockMarketDriverType> = new Set(['v1', 'v3']);

export const resolveStockMarketDriver = (): StockMarketDriverType => {
  const raw = process.env.STOCK_MARKET_DRIVER ?? 'v1';
  const normalized = raw.trim().toLowerCase();
  if (VALID_DRIVERS.has(normalized as StockMarketDriverType)) {
    return normalized as StockMarketDriverType;
  }
  return 'v1';
};
