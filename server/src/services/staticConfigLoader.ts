/**
 * 静态配置加载器（精简版）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：仅加载股票定义文件 stock_def.json。
 * 2. 不做什么：不加载功法、技能、任务、物品等其他配置。
 *
 * 输入 / 输出：
 * - 输入：股票定义 JSON 文件。
 * - 输出：股票定义列表和索引。
 *
 * 数据流 / 状态流：
 * 启动时加载 -> 缓存到内存 -> 通过 getStockDefinitions() 获取。
 *
 * 关键边界条件与坑点：
 * 1. 文件不存在时返回空数组，不抛错。
 * 2. 配置缓存后不会自动刷新，需要重启服务。
 */
import { readFile } from 'fs/promises';
import { join } from 'path';

/**
 * 股票定义配置类型。
 */
export interface StockDefConfig {
  id: string;
  code: string;
  name: string;
  short_name?: string;
  sector: string;
  description?: string;
  initial_price_spirit_stones: number;
  enabled?: boolean;
  sort_weight?: number;
}

let cachedStockDefinitions: readonly StockDefConfig[] | null = null;

const STOCK_DEF_PATH = join(process.cwd(), 'data/seeds/stock_def.json');

/**
 * 加载股票定义文件。
 */
async function loadStockDefinitions(): Promise<readonly StockDefConfig[]> {
  if (cachedStockDefinitions !== null) {
    return cachedStockDefinitions;
  }

  try {
    const content = await readFile(STOCK_DEF_PATH, 'utf-8');
    const parsed = JSON.parse(content) as { stocks: StockDefConfig[] };
    cachedStockDefinitions = parsed.stocks;
    return parsed.stocks;
  } catch {
    // 文件不存在或解析失败时返回空数组
    cachedStockDefinitions = [];
    return [];
  }
}

/**
 * 获取所有股票定义（同步版本，用于已加载场景）。
 */
export function getStockDefinitions(): readonly StockDefConfig[] {
  if (cachedStockDefinitions === null) {
    throw new Error('Stock definitions not loaded. Call loadStockDefinitions() first.');
  }
  return cachedStockDefinitions;
}

/**
 * 初始化股票定义（异步加载）。
 */
export async function initStockDefinitions(): Promise<void> {
  await loadStockDefinitions();
}

/**
 * 清除缓存（用于测试）。
 */
export function clearStaticConfigCache(): void {
  cachedStockDefinitions = null;
}