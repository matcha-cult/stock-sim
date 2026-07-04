/**
 * 刮刮乐奖金配置运行时缓存。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：应用启动时从种子文件 UPSERT 到 DB，再加载到内存 Map，
 *    提供 getConfig(configKey) 和 lookupPrize(configKey, lineSum) 的 O(1) 查询。
 * 2. 不做什么：不写回数据库（写入由种子导入脚本处理）。
 *
 * 输入 / 输出：
 * - init()：种子 UPSERT + 内存加载。
 * - getConfig() / lookupPrize()：返回内存中的配置对象。
 *
 * 数据流 / 状态流：
 * seed JSON → UPSERT DB → loadFromDb() → 内存 Map → getConfig/lookupPrize 返回。
 *
 * 复用设计说明：
 * - 种子结构和导入逻辑与 scratchGameConfigSeed.ts 共享。
 * - buildLines 在 scratchTicketTypes.ts 中统一定义，前后端共用。
 * - 被 scratchPrizeService 开奖时查询奖级，被 scratchTicketService 创建票时读取规格。
 *
 * 关键边界条件与坑点：
 * 1. 启动时必须调用 init()，否则 getConfig() 会抛错。
 * 2. 种子文件 UPSET 奖金 tier 采用「先删后插」策略。
 * 3. 配置热更新后需重启应用。
 */
import { query, withTransaction } from '../../config/database.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TicketConfig, PrizeTier } from './scratchTicketTypes.js';
import { buildLines, type LineDef } from './scratchTicketTypes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SEED_PATH = resolve(__dirname, '../../seeds/scratchGameConfig.json');

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

interface SeedFile {
  configs: ConfigSeed[];
  prizeTiers: { configKey: string; tiers: TierSeed[] }[];
}

const EXPECTED_MAPPING: Record<string, { ticketNumber: number; sqrt: number }> = {
  '3x3': { ticketNumber: 1, sqrt: 3 },
  '4x4': { ticketNumber: 2, sqrt: 4 },
  '5x5': { ticketNumber: 3, sqrt: 5 },
};

const validate = (config: ConfigSeed): void => {
  const expected = EXPECTED_MAPPING[config.configKey];
  if (!expected) {
    throw new Error(`config ${config.configKey}: 不支持的 configKey`);
  }
  if (config.ticketNumber !== expected.ticketNumber) {
    throw new Error(`config ${config.configKey}: ticketNumber 必须为 ${expected.ticketNumber}`);
  }
  const sqrt = Math.round(Math.sqrt(config.gridSize));
  if (sqrt * sqrt !== config.gridSize || sqrt !== expected.sqrt) {
    throw new Error(`config ${config.configKey}: gridSize 不是完全平方数或不符合预期`);
  }
  if (config.maxScratchCount < config.minVisibleCount) {
    throw new Error(`config ${config.configKey}: maxScratchCount 必须 >= minVisibleCount`);
  }
  if (config.minVisibleCount < sqrt) {
    throw new Error(`config ${config.configKey}: minVisibleCount 必须 >= N(${sqrt})`);
  }
};

const validateTiers = (configKey: string, tiers: TierSeed[], lineLen: number): void => {
  if (tiers.length < 6) {
    throw new Error(`config ${configKey}: 奖金 tier 数量不能少于 6，当前 ${tiers.length}`);
  }
  const gridSize = lineLen * lineLen;
  const minSum = (lineLen * (lineLen + 1)) / 2;
  const maxSum = Array.from({ length: lineLen }, (_, i) => gridSize - lineLen + 1 + i).reduce((a, b) => a + b, 0);
  const covered = new Set<number>();
  for (const tier of tiers) {
    for (let s = tier.sumMin; s <= tier.sumMax; s++) covered.add(s);
  }
  for (let s = minSum; s <= maxSum; s++) {
    if (!covered.has(s)) {
      throw new Error(`config ${configKey}: 奖金 tier 未覆盖线和值 ${s}`);
    }
  }
};

class ScratchPrizeConfigCache {
  private configs: Map<string, TicketConfig> = new Map();
  private prizeTiers: Map<string, PrizeTier[]> = new Map();
  private loaded = false;

  /** 启动时调用：种子 UPSERT + 加载到内存。 */
  async init(): Promise<void> {
    const seed: SeedFile = JSON.parse(readFileSync(SEED_PATH, 'utf-8'));

    for (const config of seed.configs) validate(config);
    for (const group of seed.prizeTiers) {
      const config = seed.configs.find(c => c.configKey === group.configKey);
      if (!config) throw new Error(`prizeTiers 中的 configKey "${group.configKey}" 不存在`);
      validateTiers(group.configKey, group.tiers, Math.round(Math.sqrt(config.gridSize)));
    }

    await withTransaction(async () => {
      for (const config of seed.configs) {
        const configId = await this.upsertConfig(config);
        const tierGroup = seed.prizeTiers.find(p => p.configKey === config.configKey);
        if (tierGroup) {
          await this.replacePrizeTiers(configId, config.configKey, tierGroup.tiers);
        }
      }
    });

    await this.loadFromDb();
  }

  private async upsertConfig(config: ConfigSeed): Promise<bigint> {
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
      [config.configKey, config.ticketNumber, config.gridSize,
       config.maxScratchCount, config.minVisibleCount, config.description],
    );
    return BigInt(result.rows[0].id);
  }

  private async replacePrizeTiers(configId: bigint, _configKey: string, tiers: TierSeed[]): Promise<void> {
    await query(`DELETE FROM scratch_prize_tier WHERE config_id = $1`, [configId]);
    for (const tier of tiers) {
      await query(
        `INSERT INTO scratch_prize_tier
          (config_id, tier_key, tier_name, sum_min, sum_max, prize_type, prize_amount, sort_order, created_at)
         VALUES ($1, $2, $3, $4, $5, 'spirit_stones', $6, $7, NOW())`,
        [configId, tier.tierKey, tier.tierName, tier.sumMin, tier.sumMax, tier.prizeAmount, tier.sortOrder],
      );
    }
  }

  private async loadFromDb(): Promise<void> {
    const configResult = await query(
      `SELECT config_key, ticket_number, grid_size, max_scratch_count, min_visible_count, description
       FROM scratch_ticket_config ORDER BY ticket_number`,
    );
    if (configResult.rows.length === 0) {
      throw new Error('scratch_ticket_config 表中无数据，请检查种子导入');
    }
    for (const row of configResult.rows) {
      this.configs.set(String(row.config_key), {
        configKey: String(row.config_key),
        ticketNumber: Number(row.ticket_number),
        gridSize: Number(row.grid_size),
        maxScratchCount: Number(row.max_scratch_count),
        minVisibleCount: Number(row.min_visible_count),
        description: String(row.description),
      });
    }

    const tierResult = await query(
      `SELECT stc.config_key, st.tier_key, st.tier_name, st.sum_min, st.sum_max,
              st.prize_amount, st.sort_order
       FROM scratch_prize_tier st
       JOIN scratch_ticket_config stc ON st.config_id = stc.id
       ORDER BY st.sort_order`,
    );
    for (const row of tierResult.rows) {
      const configKey = String(row.config_key);
      if (!this.prizeTiers.has(configKey)) this.prizeTiers.set(configKey, []);
      this.prizeTiers.get(configKey)!.push({
        tierKey: String(row.tier_key),
        tierName: String(row.tier_name),
        sumMin: Number(row.sum_min),
        sumMax: Number(row.sum_max),
        prizeAmount: Number(row.prize_amount),
        sortOrder: Number(row.sort_order),
      });
    }
    this.loaded = true;
  }

  getConfig(configKey: string): TicketConfig | null {
    return this.configs.get(configKey) ?? null;
  }

  lookupPrize(configKey: string, lineSum: number): PrizeTier | null {
    const tiers = this.prizeTiers.get(configKey);
    if (!tiers) return null;
    for (const tier of tiers) {
      if (lineSum >= tier.sumMin && lineSum <= tier.sumMax) return tier;
    }
    return null;
  }

  /** 获取指定 config 的所有奖级（用于反查奖级名称） */
  getPrizeTiers(configKey: string): PrizeTier[] | null {
    return this.prizeTiers.get(configKey) ?? null;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  /** 返回所有票据配置 + 奖级 + 可选项列表，用于前端展示开奖规则 */
  getAllRules(): {
    tickInfo: Array<{
      ticketNumber: number;
      configKey: string;
      description: string;
      gridSize: number;
      maxScratchCount: number;
      minVisibleCount: number;
      prizeTiers: PrizeTier[];
      lines: LineDef[];
    }>;
  } {
    const tickInfo: Array<{
      ticketNumber: number;
      configKey: string;
      description: string;
      gridSize: number;
      maxScratchCount: number;
      minVisibleCount: number;
      prizeTiers: PrizeTier[];
      lines: LineDef[];
    }> = [];

    const sortedConfigs = [...this.configs.values()].sort((a, b) => a.ticketNumber - b.ticketNumber);
    for (const config of sortedConfigs) {
      const tiers = this.prizeTiers.get(config.configKey) ?? [];
      const lines = buildLines(config.gridSize);
      tickInfo.push({
        ticketNumber: config.ticketNumber,
        configKey: config.configKey,
        description: config.description,
        gridSize: config.gridSize,
        maxScratchCount: config.maxScratchCount,
        minVisibleCount: config.minVisibleCount,
        prizeTiers: tiers,
        lines,
      });
    }
    return { tickInfo };
  }

  reset(): void {
    this.configs.clear();
    this.prizeTiers.clear();
    this.loaded = false;
  }
}

export const scratchPrizeConfigCache = new ScratchPrizeConfigCache();
