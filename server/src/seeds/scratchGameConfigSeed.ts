/**
 * 刮刮乐配置种子数据导入脚本。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：读取 scratchGameConfig.json，UPSERT 到 scratch_ticket_config 表，
 *    并全量替换对应 config 的 scratch_prize_tier 数据。
 * 2. 不做什么：不处理刮刮乐业务逻辑，仅做配置数据初始化。
 *
 * 输入/输出：
 * - 输入：scratchGameConfig.json 种子文件。
 * - 输出：导入结果统计（配置新增/更新 N 条，奖级 M 条）。
 *
 * 关键边界条件与坑点：
 * 1. 以 config_key 为唯一键，重复导入时更新而非新增（UPSERT）。
 * 2. 奖金 tier 采用「先删后插」策略，保证与种子文件完全一致。
 * 3. 导入操作包裹在事务中，失败时全部回滚。
 * 4. 导入时校验：maxScratchCount >= minVisibleCount、ticketNumber 与 configKey 对应关系、
 *    gridSize 必须为完全平方数、奖金 tier 无缝覆盖理论线和值范围。
 */
import { query, withTransaction } from '../config/database.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ========== 类型定义 ==========

interface ConfigSeed {
  configKey: string;
  ticketNumber: number;
  gridSize: number;
  maxScratchCount: number;
  minVisibleCount: number;
  description: string;
}

interface TierSeed {
  tierKey: string;
  tierName: string;
  sumMin: number;
  sumMax: number;
  prizeAmount: number;
  sortOrder: number;
}

interface PrizeTierGroup {
  configKey: string;
  tiers: TierSeed[];
}

interface ScratchGameConfigSeedFile {
  configs: ConfigSeed[];
  prizeTiers: PrizeTierGroup[];
}

// ========== 常量与校验 ==========

const SEED_PATH = resolve(__dirname, 'scratchGameConfig.json');

const EXPECTED_MAPPING: Record<string, { ticketNumber: number; sqrt: number }> = {
  '3x3': { ticketNumber: 1, sqrt: 3 },
  '4x4': { ticketNumber: 2, sqrt: 4 },
  '5x5': { ticketNumber: 3, sqrt: 5 },
};

const validate = (config: ConfigSeed): void => {
  const expected = EXPECTED_MAPPING[config.configKey];
  if (!expected) {
    throw new Error(`config ${config.configKey}: 不支持的 configKey，仅允许 3x3/4x4/5x5`);
  }
  if (config.ticketNumber !== expected.ticketNumber) {
    throw new Error(`config ${config.configKey}: ticketNumber 必须为 ${expected.ticketNumber}`);
  }
  const sqrt = Math.round(Math.sqrt(config.gridSize));
  if (sqrt * sqrt !== config.gridSize || sqrt !== expected.sqrt) {
    throw new Error(`config ${config.configKey}: gridSize ${config.gridSize} 不是完全平方数或不符合预期`);
  }
  if (config.maxScratchCount < config.minVisibleCount) {
    throw new Error(`config ${config.configKey}: maxScratchCount 必须 >= minVisibleCount`);
  }
  if (config.maxScratchCount > config.gridSize) {
    throw new Error(`config ${config.configKey}: maxScratchCount 必须 <= gridSize`);
  }
  if (config.minVisibleCount < sqrt) {
    throw new Error(`config ${config.configKey}: minVisibleCount 必须 >= N(${sqrt})，至少要能覆盖一条线`);
  }
};

const validateTiers = (configKey: string, tiers: TierSeed[], lineLen: number): void => {
  if (tiers.length !== 6) {
    throw new Error(`config ${configKey}: 奖金 tier 数量必须为 6（1 特等 + 4 普通 + 1 安慰），当前 ${tiers.length}`);
  }

  const minSum = (lineLen * (lineLen + 1)) / 2;  // 1+2+...+N
  const maxVal = lineLen * lineLen + lineLen;     // N*N = gridSize, maxVal = (gridSize - lineLen + 1) + ... + gridSize
  // 实际上 maxSum = (gridSize - lineLen + 1) + (gridSize - lineLen + 2) + ... + gridSize
  // = lineLen * gridSize - lineLen*(lineLen-1)/2
  const gridSize = lineLen * lineLen;
  const maxSum = Array.from({ length: lineLen }, (_, i) => gridSize - lineLen + 1 + i).reduce((a, b) => a + b, 0);

  // 检查无缝覆盖
  const covered = new Set<number>();
  for (const tier of tiers) {
    for (let s = tier.sumMin; s <= tier.sumMax; s++) {
      covered.add(s);
    }
  }
  for (let s = minSum; s <= maxSum; s++) {
    if (!covered.has(s)) {
      throw new Error(`config ${configKey}: 奖金 tier 未覆盖线和值 ${s}（范围 ${minSum}~${maxSum}）`);
    }
  }
};

// ========== UPSERT 操作 ==========

const upsertConfig = async (config: ConfigSeed): Promise<bigint> => {
  const result = await query(
    `INSERT INTO scratch_ticket_config
      (config_key, ticket_number, grid_size, max_scratch_count, min_visible_count, description, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (config_key) DO UPDATE SET
       ticket_number = EXCLUDED.ticket_number,
       grid_size = EXCLUDED.grid_size,
       max_scratch_count = EXCLUDED.max_scratch_count,
       min_visible_count = EXCLUDED.min_visible_count,
       description = EXCLUDED.description,
       updated_at = NOW()
     RETURNING id, (xmax = 0) AS inserted`,
    [
      config.configKey,
      config.ticketNumber,
      config.gridSize,
      config.maxScratchCount,
      config.minVisibleCount,
      config.description,
    ],
  );

  return BigInt(result.rows[0].id);
};

const replacePrizeTiers = async (configId: bigint, configKey: string, tiers: TierSeed[]): Promise<number> => {
  // 先删
  await query(`DELETE FROM scratch_prize_tier WHERE config_id = $1`, [configId]);

  // 后插
  let inserted = 0;
  for (const tier of tiers) {
    await query(
      `INSERT INTO scratch_prize_tier
        (config_id, tier_key, tier_name, sum_min, sum_max, prize_type, prize_amount, sort_order, created_at)
       VALUES ($1, $2, $3, $4, $5, 'spirit_stones', $6, $7, NOW())`,
      [configId, tier.tierKey, tier.tierName, tier.sumMin, tier.sumMax, tier.prizeAmount, tier.sortOrder],
    );
    inserted++;
  }
  return inserted;
};

// ========== 主入口 ==========

const main = async (): Promise<void> => {
  const seed: ScratchGameConfigSeedFile = JSON.parse(readFileSync(SEED_PATH, 'utf-8'));

  // 校验所有 config
  for (const config of seed.configs) {
    validate(config);
  }

  // 校验所有 prizeTiers
  for (const group of seed.prizeTiers) {
    const config = seed.configs.find(c => c.configKey === group.configKey);
    if (!config) {
      throw new Error(`prizeTiers 中的 configKey "${group.configKey}" 在 configs 中不存在`);
    }
    const lineLen = Math.round(Math.sqrt(config.gridSize));
    validateTiers(group.configKey, group.tiers, lineLen);
  }

  // 执行导入
  const configResults: string[] = [];
  let totalTiers = 0;

  await withTransaction(async () => {
    for (const config of seed.configs) {
      const configId = await upsertConfig(config);

      const tierGroup = seed.prizeTiers.find(p => p.configKey === config.configKey);
      if (tierGroup) {
        const count = await replacePrizeTiers(configId, config.configKey, tierGroup.tiers);
        totalTiers += count;
      }

      configResults.push(`${config.configKey}(id=${configId})`);
    }
  });

  console.log(`刮刮乐配置导入完成：${configResults.join(', ')}，奖金等级 ${totalTiers} 条`);
};

main().catch((err) => {
  console.error('刮刮乐配置导入失败:', err);
  process.exit(1);
});
