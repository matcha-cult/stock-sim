/**
 * 月卡配置种子数据导入脚本。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：读取 monthCardConfig.json，UPSERT 到 month_card_config 表。
 * 2. 不做什么：不处理月卡业务逻辑，仅做配置数据初始化。
 *
 * 输入/输出：
 * - 输入：monthCardConfig.json 种子文件。
 * - 输出：导入结果统计（新增 N 条，更新 M 条）。
 *
 * 关键边界条件与坑点：
 * 1. 以 config_key 为唯一键，重复导入时更新而非新增（UPSERT）。
 * 2. 导入操作包裹在事务中，失败时全部回滚。
 * 3. 导入时校验：durationDays > 0、dailyRewardSpiritStones >= 0。
 */
import { query, withTransaction } from '../config/database.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const SEED_PATH = resolve(__dirname, 'monthCardConfig.json');

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

const main = async (): Promise<void> => {
  const seed: MonthCardConfigSeedFile = JSON.parse(readFileSync(SEED_PATH, 'utf-8'));

  for (const config of seed.configs) {
    validate(config);
  }

  const results: ('insert' | 'update')[] = [];
  await withTransaction(async () => {
    for (const config of seed.configs) {
      const result = await upsertConfig(config);
      results.push(result);
    }
  });

  const inserted = results.filter(r => r === 'insert').length;
  const updated = results.filter(r => r === 'update').length;

  console.log(`月卡配置导入完成：新增 ${inserted} 条，更新 ${updated} 条`);
};

main().catch((err) => {
  console.error('月卡配置导入失败:', err);
  process.exit(1);
});
