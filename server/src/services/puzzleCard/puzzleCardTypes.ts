/**
 * 常驻刮刮乐共享类型与内存常量。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：定义玩法类型、奖级配置、结算函数签名，注册所有玩法（内存常量，无 DB 表）。
 * 2. 不做什么：不处理购票/兑奖业务逻辑（由 puzzleCardService 负责）。
 *
 * 数据流 / 状态流：
 * 服务层通过 PUZZLE_CARD_TYPES 读取类型配置，通过 SETTLE_FNS 调用对应结算函数。
 * 七喜格子生成函数从 seeds/puzzleCardQixiConfig.json 读取概率配置。
 *
 * 复用设计说明：
 * - 所有玩法配置集中注册，新增玩法只需在注册表中追加条目。
 * - 结算函数纯函数化，输入 grid、输出中奖结果，无副作用。
 * - 生成函数支持概率乘数（probabilityMultiplier），用于惩罚机制。
 *
 * 关键边界条件与坑点：
 * 1. grid 数组长度为 rows × cols，按行优先顺序（[0]=左上角）。
 * 2. 奖级 prizeAmount 为绝对值（灵石），不是倍数。
 * 3. typeKey 必须全局唯一，与 DB type_key 一致。
 */

// ========== 类型定义 ==========

export interface PuzzlePrizeTier {
  tierKey: string;
  tierName: string;
  /** 中奖判定条件（结构依 ruleType 而定） */
  ruleMatch: Record<string, unknown>;
  prizeType: 'spirit_stones' | 'silver';
  prizeAmount: bigint;
}

export interface PuzzleCardType {
  typeKey: string;
  name: string;
  description: string;
  gridRows: number;
  gridCols: number;
  numbersPerCell: number;
  price: bigint;
  ruleType: string;
  prizeTiers: readonly PuzzlePrizeTier[];
  /** 每日购票上限（按 UTC+8 08:00 刷新），0 表示不限 */
  dailyLimit: number;
}

export interface SettleMatchedLine {
  tierKey: string;
  tierName: string;
  prizeType: string;
  prizeAmount: bigint;
}

export interface SettleResult {
  matchedLines: SettleMatchedLine[];
  prizeType: string;
  prizeAmount: bigint;
}

export type SettleFn = (grid: number[]) => SettleResult;

// ========== 七喜概率配置 ==========

interface QixiCellConfig {
  cellIndex: number;
  name: string;
  prizeAmount: number;
  winProbability: number;
  pityTriggerRate?: number;
}

interface QixiConfig {
  typeKey: string;
  cells: QixiCellConfig[];
  penaltyMultiplier: number;
  penaltyThreshold: number;
  batchSize: number;
}

import qixiConfigRaw from '../../seeds/puzzleCardQixiConfig.json' assert { type: 'json' };
import sanyuanConfigRaw from '../../seeds/puzzleCardSanyuanConfig.json' assert { type: 'json' };

const QIXI_CONFIG = qixiConfigRaw as QixiConfig;
const SANYUAN_CONFIG = sanyuanConfigRaw as QixiConfig;

export const QIXI_PENALTY_MULTIPLIER = QIXI_CONFIG.penaltyMultiplier;
export const QIXI_PENALTY_THRESHOLD = QIXI_CONFIG.penaltyThreshold;
export const QIXI_BATCH_SIZE = QIXI_CONFIG.batchSize;

export const SANYUAN_PENALTY_MULTIPLIER = SANYUAN_CONFIG.penaltyMultiplier;
export const SANYUAN_PENALTY_THRESHOLD = SANYUAN_CONFIG.penaltyThreshold;
export const SANYUAN_BATCH_SIZE = SANYUAN_CONFIG.batchSize;

// ========== 七喜（QIXI）常量 ==========

const QIXI_PRIZE_TIERS: PuzzlePrizeTier[] = [
  { tierKey: 'cell_0', tierName: '格子1中奖', ruleMatch: { cellIndex: 0 }, prizeType: 'spirit_stones', prizeAmount: 5_000_000n },
  { tierKey: 'cell_1', tierName: '格子2中奖', ruleMatch: { cellIndex: 1 }, prizeType: 'spirit_stones', prizeAmount: 100_000_000n },
  { tierKey: 'cell_2', tierName: '格子3中奖', ruleMatch: { cellIndex: 2 }, prizeType: 'spirit_stones', prizeAmount: 100_000n },
  { tierKey: 'cell_3', tierName: '格子4中奖', ruleMatch: { cellIndex: 3 }, prizeType: 'spirit_stones', prizeAmount: 50_000n },
];

const QIXI_TYPE: PuzzleCardType = {
  typeKey: 'QIXI',
  name: '七喜',
  description: '4格各含2个数字(1~6)，每格两数之和为7即该格中奖，按格子序号分档兑奖',
  gridRows: 2,
  gridCols: 2,
  numbersPerCell: 2,
  price: 50_000n,
  ruleType: 'CELL_SUM_MATCH',
  prizeTiers: QIXI_PRIZE_TIERS,
  dailyLimit: 0,
};

// ========== 三元（SANYUAN）常量 ==========

const SANYUAN_PRIZE_TIERS: PuzzlePrizeTier[] = [
  { tierKey: 'sanyuan_cell_0', tierName: '格子1中奖', ruleMatch: { cellIndex: 0 }, prizeType: 'spirit_stones', prizeAmount: 50_000_000n },
  { tierKey: 'sanyuan_cell_1', tierName: '格子2中奖', ruleMatch: { cellIndex: 1 }, prizeType: 'spirit_stones', prizeAmount: 500_000n },
  { tierKey: 'sanyuan_cell_2', tierName: '格子3中奖', ruleMatch: { cellIndex: 2 }, prizeType: 'spirit_stones', prizeAmount: 100_000_000n },
  { tierKey: 'sanyuan_cell_3', tierName: '格子4中奖', ruleMatch: { cellIndex: 3 }, prizeType: 'spirit_stones', prizeAmount: 5_000_000n },
  { tierKey: 'sanyuan_cell_4', tierName: '格子5中奖', ruleMatch: { cellIndex: 4 }, prizeType: 'spirit_stones', prizeAmount: 10_000_000n },
  { tierKey: 'sanyuan_cell_5', tierName: '格子6中奖', ruleMatch: { cellIndex: 5 }, prizeType: 'spirit_stones', prizeAmount: 100_000n },
];

const SANYUAN_TYPE: PuzzleCardType = {
  typeKey: 'SANYUAN',
  name: '三元',
  description: '6格各含3个数字(0~9)，每格三个数字相同则该格中奖，最多3格中奖，兼中兼得',
  gridRows: 2,
  gridCols: 3,
  numbersPerCell: 3,
  price: 100_000n,
  ruleType: 'SANYUAN_MATCH',
  prizeTiers: SANYUAN_PRIZE_TIERS,
  dailyLimit: 0,
};

// ========== 七喜结算函数 ==========

const NO_WIN: SettleResult = { matchedLines: [], prizeType: 'spirit_stones', prizeAmount: 0n };

const settleQixi: SettleFn = (grid: number[]): SettleResult => {
  if (grid.length !== 8) return NO_WIN;

  const matchedLines: SettleMatchedLine[] = [];
  let totalPrize = 0n;

  for (let cellIndex = 0; cellIndex < 4; cellIndex++) {
    const num1 = grid[cellIndex * 2];
    const num2 = grid[cellIndex * 2 + 1];
    if (num1 + num2 === 7) {
      const tier = QIXI_PRIZE_TIERS.find(t => (t.ruleMatch as { cellIndex: number }).cellIndex === cellIndex);
      if (tier) {
        matchedLines.push({
          tierKey: tier.tierKey,
          tierName: tier.tierName,
          prizeType: tier.prizeType,
          prizeAmount: tier.prizeAmount,
        });
        totalPrize += tier.prizeAmount;
      }
    }
  }

  if (matchedLines.length === 0) return NO_WIN;

  return {
    matchedLines,
    prizeType: 'spirit_stones',
    prizeAmount: totalPrize,
  };
};

// ========== 三元结算函数 ==========

const settleSanyuan: SettleFn = (grid: number[]): SettleResult => {
  if (grid.length !== 18) return NO_WIN; // 6格，每格3个数字 = 18个数字

  const matchedLines: SettleMatchedLine[] = [];
  let totalPrize = 0n;

  for (let cellIndex = 0; cellIndex < 6; cellIndex++) {
    const startIndex = cellIndex * 3;
    const a = grid[startIndex];
    const b = grid[startIndex + 1];
    const c = grid[startIndex + 2];

    // 三个数字相同则中奖
    if (a === b && b === c) {
      const tier = SANYUAN_PRIZE_TIERS.find(t => (t.ruleMatch as { cellIndex: number }).cellIndex === cellIndex);
      if (tier) {
        matchedLines.push({
          tierKey: tier.tierKey,
          tierName: tier.tierName,
          prizeType: tier.prizeType,
          prizeAmount: tier.prizeAmount,
        });
        totalPrize += tier.prizeAmount;
      }
    }
  }

  if (matchedLines.length === 0) return NO_WIN;

  return {
    matchedLines,
    prizeType: 'spirit_stones',
    prizeAmount: totalPrize,
  };
};

// ========== 注册表 ==========

export const PUZZLE_CARD_TYPES: Record<string, PuzzleCardType> = {
  QIXI: QIXI_TYPE,
  SANYUAN: SANYUAN_TYPE,
};

export const SETTLE_FNS: Record<string, SettleFn> = {
  CELL_SUM_MATCH: settleQixi,
  SANYUAN_MATCH: settleSanyuan,
};

// ========== 工具函数 ==========

/** 生成 [min, max] 范围内 length 个随机整数数组（含两端）。 */
export const generateRandomGrid = (length: number, min: number, max: number): number[] => {
  const range = max - min + 1;
  return Array.from({ length }, () => min + Math.floor(Math.random() * range));
};

// ========== 七喜概率格子生成 ==========

/** 和为7且两数不重复的组合（1~6范围内） */
const SUM_SEVEN_PAIRS: ReadonlyArray<[number, number]> = [
  [1, 6], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1],
];

/** 和不为7且两数不重复的组合（1~6范围内），模块初始化时预构建 */
const NOT_SEVEN_PAIRS: ReadonlyArray<[number, number]> = (() => {
  const pairs: [number, number][] = [];
  for (let i = 1; i <= 6; i++) {
    for (let j = 1; j <= 6; j++) {
      if (i !== j && i + j !== 7) pairs.push([i, j]);
    }
  }
  return pairs;
})();

const pickSumSevenPair = (): [number, number] =>
  SUM_SEVEN_PAIRS[Math.floor(Math.random() * SUM_SEVEN_PAIRS.length)];

const pickNotSevenPair = (): [number, number] =>
  NOT_SEVEN_PAIRS[Math.floor(Math.random() * NOT_SEVEN_PAIRS.length)];

/**
 * 七喜概率格子生成：按 seeds 配置概率判定每格是否中奖。
 *
 * 规则：
 * - 每格按 winProbability × probabilityMultiplier 判定是否中奖
 * - 中奖：随机生成和为7的一对数字
 * - 未中奖：随机生成和不为7的一对数字（两数不重复）
 * - 格子4保底：若前3格均未中奖，按 pityTriggerRate 概率强制中奖（惩罚模式下不生效）
 *
 * @param probabilityMultiplier 概率乘数（1=正常，0.1=惩罚模式）
 */
export const generateQixiGrid = (probabilityMultiplier = 1): number[] => {
  const grid: number[] = [];
  const cellResults: [number, number][] = [];
  const cells = QIXI_CONFIG.cells;

  for (let i = 0; i < 4; i++) {
    const cellConfig = cells[i];
    const effectiveProbability = cellConfig.winProbability * probabilityMultiplier;

    if (cellConfig.pityTriggerRate !== undefined && probabilityMultiplier >= 1) {
      // 格子4：保底逻辑（惩罚模式下不生效）
      const allPreviousMissed = cellResults.every(([a, b]) => a + b !== 7);

      if (allPreviousMissed) {
        const effectivePityRate = cellConfig.pityTriggerRate;
        if (Math.random() < effectivePityRate) {
          cellResults[i] = pickSumSevenPair();
        } else {
          cellResults[i] = pickNotSevenPair();
        }
      } else {
        // 前3格已有中奖，按正常概率判定（不再触发保底）
        if (Math.random() < effectiveProbability) {
          cellResults[i] = pickSumSevenPair();
        } else {
          cellResults[i] = pickNotSevenPair();
        }
      }
    } else {
      // 普通格子：按概率判定
      if (Math.random() < effectiveProbability) {
        cellResults[i] = pickSumSevenPair();
      } else {
        cellResults[i] = pickNotSevenPair();
      }
    }

    grid.push(...cellResults[i]);
  }

  return grid;
};

// ========== 三元概率格子生成 ==========

/** 生成三个相同数字（中奖） */
const pickTripleSame = (): [number, number, number] => {
  const digit = Math.floor(Math.random() * 10);
  return [digit, digit, digit];
};

/** 生成三个不全相同数字（不中奖），模块初始化时预构建所有组合 */
const NOT_TRIPLE_SAME_TRIPLES: ReadonlyArray<[number, number, number]> = (() => {
  const triples: [number, number, number][] = [];
  for (let i = 0; i <= 9; i++) {
    for (let j = 0; j <= 9; j++) {
      for (let k = 0; k <= 9; k++) {
        // 排除三个相同的情况
        if (!(i === j && j === k)) {
          triples.push([i, j, k]);
        }
      }
    }
  }
  return triples;
})();

const pickNotTripleSame = (): [number, number, number] =>
  NOT_TRIPLE_SAME_TRIPLES[Math.floor(Math.random() * NOT_TRIPLE_SAME_TRIPLES.length)];

/**
 * 三元概率格子生成：按 seeds 配置概率判定每格是否中奖。
 *
 * 规则：
 * - 每格按 winProbability × probabilityMultiplier 判定是否中奖
 * - 中奖：生成三个相同的数字（0-9）
 * - 未中奖：生成三个不全相同的数字
 * - 格子6兜底：若前5格均未中奖，按 pityTriggerRate 概率强制中奖（惩罚模式下不生效）
 * - 最多允许3格中奖，超过则随机选3格保留，其余设为未中奖
 * - 最多允许1格中1亿（格子3），若有多个1亿格子中奖，只保留第一个
 *
 * @param probabilityMultiplier 概率乘数（1=正常，0.1=惩罚模式）
 */
export const generateSanyuanGrid = (probabilityMultiplier = 1): number[] => {
  const grid: number[] = [];
  const cellResults: [number, number, number][] = [];
  const cells = SANYUAN_CONFIG.cells;

  for (let i = 0; i < 6; i++) {
    const cellConfig = cells[i];
    const effectiveProbability = cellConfig.winProbability * probabilityMultiplier;

    if (cellConfig.pityTriggerRate !== undefined && probabilityMultiplier >= 1) {
      // 格子6：兜底逻辑（惩罚模式下不生效）
      const allPreviousMissed = cellResults.every(([a, b, c]) => !(a === b && b === c));

      if (allPreviousMissed) {
        const effectivePityRate = cellConfig.pityTriggerRate;
        if (Math.random() < effectivePityRate) {
          cellResults[i] = pickTripleSame();
        } else {
          cellResults[i] = pickNotTripleSame();
        }
      } else {
        // 前5格已有中奖，按正常概率判定（不再触发兜底）
        if (Math.random() < effectiveProbability) {
          cellResults[i] = pickTripleSame();
        } else {
          cellResults[i] = pickNotTripleSame();
        }
      }
    } else {
      // 普通格子：按概率判定
      if (Math.random() < effectiveProbability) {
        cellResults[i] = pickTripleSame();
      } else {
        cellResults[i] = pickNotTripleSame();
      }
    }
  }

  // 检查中奖情况
  const winningCells: number[] = [];
  for (let i = 0; i < 6; i++) {
    const [a, b, c] = cellResults[i];
    if (a === b && b === c) {
      winningCells.push(i);
    }
  }

  // 应用限制1 - 最多3格中奖
  if (winningCells.length > 3) {
    // 随机打乱中奖格子顺序
    const shuffledWinners = [...winningCells].sort(() => Math.random() - 0.5);
    const keptWinners = new Set(shuffledWinners.slice(0, 3));

    // 将超出的中奖格子改为未中奖
    for (const cellIndex of winningCells) {
      if (!keptWinners.has(cellIndex)) {
        cellResults[cellIndex] = pickNotTripleSame();
      }
    }
  }

  // 应用限制2 - 最多1格中1亿（格子3的奖级是1亿，索引2）
  // 注意：根据当前配置，只有格子3（索引2）是1亿奖级
  // 所以实际上不会有多个1亿格子，这个限制主要是为了未来扩展性

  // 构建最终grid
  for (let i = 0; i < 6; i++) {
    grid.push(...cellResults[i]);
  }

  return grid;
};
