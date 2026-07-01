/**
 * 常驻刮刮乐共享类型与内存常量。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：定义玩法类型、奖级配置、结算函数签名，注册所有玩法（内存常量，无 DB 表）。
 * 2. 不做什么：不处理购票/兑奖业务逻辑（由 puzzleCardService 负责）。
 *
 * 数据流 / 状态流：
 * 服务层通过 PUZZLE_CARD_TYPES 读取类型配置，通过 SETTLE_FNS 调用对应结算函数。
 *
 * 复用设计说明：
 * - 所有玩法配置集中注册，新增玩法只需在注册表中追加条目。
 * - 结算函数纯函数化，输入 grid、输出中奖结果，无副作用。
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

// ========== 七喜（QIXI）常量 ==========

const QIXI_PRIZE_TIERS: PuzzlePrizeTier[] = [
  { tierKey: 'cell_0', tierName: '格子1中奖', ruleMatch: { cellIndex: 0 }, prizeType: 'spirit_stones', prizeAmount: 500_000n },
  { tierKey: 'cell_1', tierName: '格子2中奖', ruleMatch: { cellIndex: 1 }, prizeType: 'spirit_stones', prizeAmount: 10_000_000n },
  { tierKey: 'cell_2', tierName: '格子3中奖', ruleMatch: { cellIndex: 2 }, prizeType: 'spirit_stones', prizeAmount: 10_000n },
  { tierKey: 'cell_3', tierName: '格子4中奖', ruleMatch: { cellIndex: 3 }, prizeType: 'spirit_stones', prizeAmount: 5_000n },
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
};

// ========== 七喜结算函数 ==========

const NO_WIN: SettleResult = { matchedLines: [], prizeType: 'spirit_stones', prizeAmount: 0n };

const settleQixi: SettleFn = (grid: number[]): SettleResult => {
  // grid 长度 = 4格子 × 2数字 = 8
  if (grid.length !== 8) return NO_WIN;

  const matchedLines: SettleMatchedLine[] = [];
  let totalPrize = 0n;

  // 每个格子独立判断：格子内两数之和为7则中奖
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

// ========== 注册表 ==========

export const PUZZLE_CARD_TYPES: Record<string, PuzzleCardType> = {
  QIXI: QIXI_TYPE,
};

export const SETTLE_FNS: Record<string, SettleFn> = {
  CELL_SUM_MATCH: settleQixi,
};

// ========== 工具函数 ==========

/** 生成 [min, max] 范围内 length 个随机整数数组（含两端）。 */
export const generateRandomGrid = (length: number, min: number, max: number): number[] => {
  const range = max - min + 1;
  return Array.from({ length }, () => min + Math.floor(Math.random() * range));
};
