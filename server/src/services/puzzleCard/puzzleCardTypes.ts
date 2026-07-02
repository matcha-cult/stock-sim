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
  /** 每日购票上限（按 UTC+8 08:00 刷新） */
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
  dailyLimit: 777,
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

/**
 * 七喜专用格子生成：按奖级调整roll次数，高奖金格子更难中奖。
 *
 * 规则：
 * - 格子1（500万）：roll 3次取最差结果（离7绝对值最大）
 * - 格子2（1亿）：roll 5次取最差结果
 * - 格子3（10万）：roll 1次
 * - 格子4（5万）：若前3格均未中奖，则54%概率强制和为7（保底）；否则强制不中奖
 *
 * 每次roll生成2个**不重复**数字（1~6），选择和值离7最远的结果。
 * 约束：同一格子内两个数字不能相同。
 */
export const generateQixiGrid = (): number[] => {
  const MIN = 1;
  const MAX = 6;

  // 生成两个不重复的数字
  const rollPair = (): [number, number] => {
    const num1 = MIN + Math.floor(Math.random() * (MAX - MIN + 1));
    let num2 = MIN + Math.floor(Math.random() * (MAX - MIN + 1));
    while (num2 === num1) {
      num2 = MIN + Math.floor(Math.random() * (MAX - MIN + 1));
    }
    return [num1, num2];
  };

  // 普通 roll：rollCount 次取最差（离7最远）
  const rollCellWorst = (rollCount: number, cellIndex: number): [number, number] => {
    let bestPair: [number, number] = [MIN, MIN];
    let maxDistance = -1;

    for (let i = 0; i < rollCount; i++) {
      const [num1, num2] = rollPair();
      const distance = Math.abs(num1 + num2 - 7);
      // console.log(`[格子${cellIndex + 1}] roll ${i + 1}/${rollCount}: ${num1}+${num2}=${num1 + num2}, 距离=${distance}`);
      if (distance > maxDistance) {
        maxDistance = distance;
        bestPair = [num1, num2];
      }
    }
    // console.log(`[格子${cellIndex + 1}] 最终选择: ${bestPair[0]}+${bestPair[1]}=${bestPair[0] + bestPair[1]}, 距离=${maxDistance}`);

    return bestPair;
  };

  // 强制 roll 中和值 7（从和为7的组合中随机选一个）
  const rollPairSumSeven = (): [number, number] => {
    const sumSevenPairs: [number, number][] = [[1, 6], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1]];
    return sumSevenPairs[Math.floor(Math.random() * sumSevenPairs.length)];
  };

  // 强制 roll 不中和值 7（和值不为7的组合中随机选一个）
  const rollPairNotSeven = (): [number, number] => {
    const notSevenPairs: [number, number][] = [];
    for (let i = MIN; i <= MAX; i++) {
      for (let j = MIN; j <= MAX; j++) {
        if (i !== j && i + j !== 7) {
          notSevenPairs.push([i, j]);
        }
      }
    }
    return notSevenPairs[Math.floor(Math.random() * notSevenPairs.length)];
  };

  const grid: number[] = [];
  const cellResults: [number, number][] = [];

  // 格子1：roll 3次取最差
  // console.log('=== 七喜票据生成开始 ===');
  cellResults[0] = rollCellWorst(3, 0);
  grid.push(...cellResults[0]);

  // 格子2：roll 5次取最差
  cellResults[1] = rollCellWorst(5, 1);
  grid.push(...cellResults[1]);

  // 格子3：roll 1次
  cellResults[2] = rollCellWorst(1, 2);
  grid.push(...cellResults[2]);

  // 格子4：若前3格均未中奖，则54%概率强制和为7（保底），使总中奖率达60%；否则强制不中奖
  const allPreviousMissed = cellResults[0].reduce((a, b) => a + b, 0) !== 7
    && cellResults[1].reduce((a, b) => a + b, 0) !== 7
    && cellResults[2].reduce((a, b) => a + b, 0) !== 7;

  // console.log(`[格子4] 前3格中奖情况: 格子1=${cellResults[0][0] + cellResults[0][1] === 7 ? '中奖' : '未中奖'}, 格子2=${cellResults[1][0] + cellResults[1][1] === 7 ? '中奖' : '未中奖'}, 格子3=${cellResults[2][0] + cellResults[2][1] === 7 ? '中奖' : '未中奖'}`);

  if (allPreviousMissed) {
    // 54%概率触发保底，使总中奖率达到60%
    const pityRoll = Math.random();
    if (pityRoll < 0.54) {
      // console.log(`[格子4] 触发保底（${(pityRoll * 100).toFixed(1)}% < 54%）：强制和为7`);
      cellResults[3] = rollPairSumSeven();
      // console.log(`[格子4] 保底结果: ${cellResults[3][0]}+${cellResults[3][1]}=${cellResults[3][0] + cellResults[3][1]}`);
    } else {
      // console.log(`[格子4] 未触发保底（${(pityRoll * 100).toFixed(1)}% >= 54%）：强制不中奖`);
      cellResults[3] = rollPairNotSeven();
      // console.log(`[格子4] 不中奖结果: ${cellResults[3][0]}+${cellResults[3][1]}=${cellResults[3][0] + cellResults[3][1]}`);
    }
  } else {
    // console.log('[格子4] 前3格已有中奖，强制不中奖');
    cellResults[3] = rollPairNotSeven();
    // console.log(`[格子4] 强制不中奖结果: ${cellResults[3][0]}+${cellResults[3][1]}=${cellResults[3][0] + cellResults[3][1]}`);
  }
  grid.push(...cellResults[3]);

  // console.log(`=== 七喜票据生成完成: grid=[${grid}] ===`);

  return grid;
};
