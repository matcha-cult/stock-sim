/**
 * 月卡静态配置加载器。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：从 data/seeds/monthCardConfig.json 加载月卡配置到内存，不写数据库。
 * 2. 不做什么：不做种子 UPSERT、不做热更新、不持久化。
 *
 * 输入 / 输出：
 * - 输入：monthCardConfig.json
 * - 输出：内存缓存，通过 getMonthCardConfig() 同步获取。
 *
 * 数据流 / 状态流：
 * 启动时异步加载 → 缓存到内存 → monthCardService 同步读取。
 *
 * 复用设计说明：
 * - 单例导出 initMonthCardConfig() + getMonthCardConfig()，与 industryConfigLoader 风格一致。
 * - 被 monthCardService 的 getMonthCardStatus / gmGrantMonthCard / claimDailyReward 调用。
 *
 * 关键边界条件与坑点：
 * 1. 文件不存在时抛错，部署前需确保 data/seeds/monthCardConfig.json 存在。
 * 2. 配置缓存后不会自动刷新，需要重启服务。
 * 3. 当前只有一档配置（configKey="default"），多档位时需扩展 getByKey()。
 */
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { MonthCardConfigDto } from './monthCardTypes.js';

interface MonthCardConfigFile {
  configs: MonthCardConfigDto[];
}

let cachedConfig: MonthCardConfigDto | null = null;

const SEED_PATH = join(process.cwd(), 'data/seeds/monthCardConfig.json');

/**
 * 加载月卡静态配置（异步，仅内存，不写 DB）。
 */
export async function initMonthCardConfig(): Promise<void> {
  const content = await readFile(SEED_PATH, 'utf-8');
  const seed: MonthCardConfigFile = JSON.parse(content) as MonthCardConfigFile;

  // 取 configKey = "default" 的配置
  const defaultConfig = seed.configs.find(c => c.configKey === 'default');
  if (!defaultConfig) {
    throw new Error('月卡配置中缺少 configKey="default" 的默认档位');
  }

  cachedConfig = defaultConfig;
}

/**
 * 获取月卡配置。
 * @throws 如果未初始化则抛错。
 */
export function getMonthCardConfig(): MonthCardConfigDto {
  if (cachedConfig === null) {
    throw new Error('月卡配置未初始化，请先调用 initMonthCardConfig()');
  }
  return cachedConfig;
}
