/**
 * 股市涨跌停配置加载模块。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：从环境变量加载涨跌停幅度配置，提供运行时访问。
 * 2. 不做什么：不修改环境变量，不在运行时重新加载。
 *
 * 输入 / 输出：
 * - 输入：环境变量 STOCK_MARKET_LIMIT_UP_PERCENT / STOCK_MARKET_LIMIT_DOWN_PERCENT / STOCK_MARKET_LIMIT_ENABLED。
 * - 输出：涨跌停幅度配置（百分比）。
 *
 * 数据流 / 状态流：
 * 环境变量 → 模块加载时读取 → 导出常量供其他模块使用。
 *
 * 复用设计说明：
 * - 配置集中管理，避免硬编码在业务逻辑中。
 * - 运营人员可通过 .env 文件调整涨跌停幅度，无需修改代码。
 *
 * 关键边界条件与坑点：
 * 1. 环境变量缺失时使用默认值（500% / 50%）。
 * 2. 配置值必须为正数，否则使用默认值。
 */

const DEFAULT_LIMIT_UP_PERCENT = 500;
const DEFAULT_LIMIT_DOWN_PERCENT = 50;
const DEFAULT_ENABLED = true;

function parseEnvNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parseEnvBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const lower = value.toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  return defaultValue;
}

/** 涨停幅度（百分比） */
export const STOCK_MARKET_LIMIT_UP_PERCENT = parseEnvNumber(
  process.env.STOCK_MARKET_LIMIT_UP_PERCENT,
  DEFAULT_LIMIT_UP_PERCENT,
);

/** 跌停幅度（百分比） */
export const STOCK_MARKET_LIMIT_DOWN_PERCENT = parseEnvNumber(
  process.env.STOCK_MARKET_LIMIT_DOWN_PERCENT,
  DEFAULT_LIMIT_DOWN_PERCENT,
);

/** 是否启用涨跌停 */
export const STOCK_MARKET_LIMIT_ENABLED = parseEnvBoolean(
  process.env.STOCK_MARKET_LIMIT_ENABLED,
  DEFAULT_ENABLED,
);

/** 涨停幅度（基点，1% = 100 bps） */
export const STOCK_MARKET_LIMIT_UP_BPS = Math.round(STOCK_MARKET_LIMIT_UP_PERCENT * 100);

/** 跌停幅度（基点，1% = 100 bps） */
export const STOCK_MARKET_LIMIT_DOWN_BPS = Math.round(STOCK_MARKET_LIMIT_DOWN_PERCENT * 100);
