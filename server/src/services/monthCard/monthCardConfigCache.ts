/**
 * 月卡配置运行时缓存。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：应用启动时从种子文件 UPSERT 到 DB，再加载到内存。
 * 2. 不做什么：不提供热更新接口（热更新需重启应用）。
 *
 * 输入 / 输出：
 * - init()：种子 UPSERT + 内存加载。
 * - getConfig()：返回内存中的配置对象。
 *
 * 数据流 / 状态流：
 * seed JSON → UPSERT DB → loadFromDb() → 内存 Map → getConfig() 返回
 *
 * 关键边界条件与坑点：
 * 1. 启动时必须调用 init()，否则 getConfig() 会抛错。
 * 2. 配置热更新后必须重启应用或重新调用 init() 才能生效。
 * 3. 当前只有一档配置（configKey="default"），多档位时改用 getByKey() 查询。
 */
import { query, withTransaction } from '../../config/database.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MonthCardConfigDto } from './monthCardTypes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ConfigSeed {
  configKey: string;
  durationDays: number;
  dailyRewardSpiritStones: number;
  scratchBonusBps: number;
  shopRentBonusBps: number;
  description: string;
}

interface MonthCardConfigSeedFile {
  configs: ConfigSeed[];
}

const SEED_PATH = resolve(__dirname, '../../seeds/monthCardConfig.json');

const validate = (config: ConfigSeed): void => {
  if (config.durationDays <= 0) {
    throw new Error(`config ${config.configKey}: durationDays 必须 > 0`);
  }
  if (config.dailyRewardSpiritStones < 0) {
    throw new Error(`config ${config.configKey}: dailyRewardSpiritStones 必须 >= 0`);
  }
  if (!config.configKey || config.configKey.length > 64) {
    throw new Error(`config ${config.configKey}: configKey 长度必须在 1-64 之间`);
  }
};

const upsertConfig = async (config: ConfigSeed): Promise<'insert' | 'update'> => {
  const result = await query(
    `INSERT INTO month_card_config
      (config_key, duration_days, daily_reward_spirit_stones, scratch_bonus_bps, shop_rent_bonus_bps, description, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (config_key) DO UPDATE SET
       duration_days = EXCLUDED.duration_days,
       daily_reward_spirit_stones = EXCLUDED.daily_reward_spirit_stones,
       scratch_bonus_bps = EXCLUDED.scratch_bonus_bps,
       shop_rent_bonus_bps = EXCLUDED.shop_rent_bonus_bps,
       description = EXCLUDED.description,
       updated_at = NOW()
     RETURNING (xmax = 0) AS inserted`,
    [
      config.configKey,
      config.durationDays,
      config.dailyRewardSpiritStones,
      config.scratchBonusBps,
      config.shopRentBonusBps,
      config.description,
    ],
  );

  return result.rows[0].inserted ? 'insert' : 'update';
};

class MonthCardConfigCache {
  private config: MonthCardConfigDto | null = null;

  /**
   * 启动时调用：种子 UPSERT + 加载到内存。
   * 每次启动都会用种子文件同步数据库配置。
   */
  async init(): Promise<void> {
    const seed: MonthCardConfigSeedFile = JSON.parse(readFileSync(SEED_PATH, 'utf-8'));
    for (const config of seed.configs) {
      validate(config);
    }

    await withTransaction(async () => {
      for (const config of seed.configs) {
        await upsertConfig(config);
      }
    });

    await this.loadFromDb();
  }

  private async loadFromDb(): Promise<void> {
    const result = await query(
      `SELECT config_key, duration_days, daily_reward_spirit_stones,
              scratch_bonus_bps, shop_rent_bonus_bps, description
       FROM month_card_config
       WHERE config_key = 'default'
       LIMIT 1`,
    );

    if (result.rows.length === 0) {
      throw new Error('月卡配置不存在，请先执行种子数据导入脚本');
    }

    const row = result.rows[0];
    this.config = {
      configKey: String(row.config_key),
      durationDays: Number(row.duration_days),
      dailyRewardSpiritStones: Number(row.daily_reward_spirit_stones),
      scratchBonusBps: Number(row.scratch_bonus_bps),
      shopRentBonusBps: Number(row.shop_rent_bonus_bps),
      description: String(row.description ?? ''),
    };
  }

  getConfig(): MonthCardConfigDto {
    if (!this.config) {
      throw new Error('月卡配置未初始化，请先调用 init()');
    }
    return this.config;
  }

  /**
   * 重新加载配置（用于热更新后刷新缓存）。
   */
  async reload(): Promise<void> {
    await this.loadFromDb();
  }
}

export const monthCardConfigCache = new MonthCardConfigCache();
