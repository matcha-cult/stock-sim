/**
 * 三元刮刮乐模拟器
 *
 * 规则：
 * 1. 6个格子，每格roll 3个数字（0-9）
 * 2. 3个数字相同 = 中奖
 * 3. 最多3格中奖
 * 4. 奖级概率（中奖时的权重）：
 *    - 奖级1（10万）：20%
 *    - 奖级2（50万）：0.5%
 *    - 奖级3（1亿）：0.05%
 *    - 奖级4（500万）：0.5%
 *    - 奖级5（1000万）：0.1%
 *    - 奖级6（1亿）：0.005%
 * 5. 整张票最多1格中1亿（奖级3+奖级6）
 */

import { writeFileSync } from 'fs';

// 奖级配置
// 格子1和格子6互换，格子6作为兜底格（类似七喜的格子4）
// pityTriggerRate: 兜底触发概率（当前5格都未中奖时触发）
const PRIZE_TIERS = [
  { key: 'tier1', name: '5000万', amount: 50_000_000, weight: 0.0017, is1Yi: false },
  { key: 'tier2', name: '50万', amount: 500_000, weight: 0.005, is1Yi: false },
  { key: 'tier3', name: '1亿', amount: 100_000_000, weight: 0.00003, is1Yi: true },
  { key: 'tier4', name: '500万', amount: 5_000_000, weight: 0.018, is1Yi: false },
  { key: 'tier5', name: '1000万', amount: 10_000_000, weight: 0.0002, is1Yi: false },
  { key: 'tier6', name: '10万', amount: 100_000, weight: 0.18, is1Yi: false, pityTriggerRate: 0.43 },
];

const TOTAL_WEIGHT = PRIZE_TIERS.reduce((sum, t) => sum + t.weight, 0);
const TICKET_PRICE = 100_000;
const CELL_COUNT = 6;
const MAX_WIN_CELLS = 3;
const SIMULATION_COUNT = 100_000;

// 按权重roll奖级
function rollTier(): typeof PRIZE_TIERS[number] {
  const roll = Math.random() * TOTAL_WEIGHT;
  let cumulative = 0;
  for (const tier of PRIZE_TIERS) {
    cumulative += tier.weight;
    if (roll < cumulative) {
      return tier;
    }
  }
  return PRIZE_TIERS[PRIZE_TIERS.length - 1];
}

// roll 3个相同数字（中奖）
function rollWinningNumbers(): [number, number, number] {
  const n = Math.floor(Math.random() * 10);
  return [n, n, n];
}

// roll 3个不全相同数字（不中奖）
function rollLosingNumbers(): [number, number, number] {
  let a: number, b: number, c: number;
  do {
    a = Math.floor(Math.random() * 10);
    b = Math.floor(Math.random() * 10);
    c = Math.floor(Math.random() * 10);
  } while (a === b && b === c);
  return [a, b, c];
}

// 模拟一张票
function simulateTicket(ticketIndex: number): {
  ticketIndex: number;
  cells: { numbers: [number, number, number]; isWin: boolean; tierKey?: string; tierName?: string; amount?: number }[];
  totalPrize: number;
  winCellCount: number;
  has1Yi: boolean;
  pityTriggered: boolean;
} {
  const cells: { numbers: [number, number, number]; isWin: boolean; tierKey?: string; tierName?: string; amount?: number }[] = [];

  // 第一步：每个格子先判断是否"中奖"（按权重roll）
  const cellWinResults: { isWin: boolean; tier?: typeof PRIZE_TIERS[number] }[] = [];
  let pityTriggered = false;

  // 每个格子按概率判定，格子6有兜底逻辑
  for (let i = 0; i < CELL_COUNT; i++) {
    const tier = PRIZE_TIERS[i];

    if (tier.pityTriggerRate !== undefined) {
      // 兜底格子（格子6）：检查前面5格是否都未中奖
      const allPreviousMissed = cellWinResults.every(r => !r.isWin);

      if (allPreviousMissed) {
        // 触发兜底判定
        if (Math.random() < tier.pityTriggerRate) {
          cellWinResults.push({ isWin: true, tier });
          pityTriggered = true;
        } else {
          cellWinResults.push({ isWin: false });
        }
      } else {
        // 前面已有中奖，按正常概率判定
        const roll = Math.random();
        if (roll < tier.weight) {
          cellWinResults.push({ isWin: true, tier });
        } else {
          cellWinResults.push({ isWin: false });
        }
      }
    } else {
      // 普通格子：按概率判定
      const roll = Math.random();
      if (roll < tier.weight) {
        cellWinResults.push({ isWin: true, tier });
      } else {
        cellWinResults.push({ isWin: false });
      }
    }
  }

  // 统计中奖格子数
  let winIndices = cellWinResults.map((r, i) => r.isWin ? i : -1).filter(i => i >= 0);

  // 限制最多3格中奖
  if (winIndices.length > MAX_WIN_CELLS) {
    // 随机选3格保留
    const shuffled = [...winIndices].sort(() => Math.random() - 0.5);
    const keepIndices = new Set(shuffled.slice(0, MAX_WIN_CELLS));
    winIndices = winIndices.filter(i => keepIndices.has(i));

    // 被移除的格子改为不中奖
    for (let i = 0; i < CELL_COUNT; i++) {
      if (cellWinResults[i].isWin && !keepIndices.has(i)) {
        cellWinResults[i] = { isWin: false };
      }
    }
  }

  // 限制最多1格中1亿
  let has1Yi = false;
  for (let i = 0; i < CELL_COUNT; i++) {
    const result = cellWinResults[i];
    if (result.isWin && result.tier?.is1Yi) {
      if (has1Yi) {
        // 已经有一个1亿了，这个改为不中奖
        cellWinResults[i] = { isWin: false };
      } else {
        has1Yi = true;
      }
    }
  }

  // 第二步：根据是否中奖roll出数字
  let totalPrize = 0;
  let winCellCount = 0;

  for (let i = 0; i < CELL_COUNT; i++) {
    const result = cellWinResults[i];
    if (result.isWin && result.tier) {
      const numbers = rollWinningNumbers();
      cells.push({
        numbers,
        isWin: true,
        tierKey: result.tier.key,
        tierName: result.tier.name,
        amount: result.tier.amount,
      });
      totalPrize += result.tier.amount;
      winCellCount++;
    } else {
      const numbers = rollLosingNumbers();
      cells.push({ numbers, isWin: false });
    }
  }

  return {
    ticketIndex,
    cells,
    totalPrize,
    winCellCount,
    has1Yi: cellWinResults.some(r => r.isWin && r.tier?.is1Yi),
    pityTriggered,
  };
}

// 运行模拟
console.log(`开始模拟 ${SIMULATION_COUNT} 次...`);
console.log(`票价: ${TICKET_PRICE}`);
console.log(`格子数: ${CELL_COUNT}`);
console.log(`最多中奖格子: ${MAX_WIN_CELLS}`);
console.log(`奖级权重总和: ${TOTAL_WEIGHT} (${(TOTAL_WEIGHT * 100).toFixed(3)}%)`);
console.log('');

const logs: string[] = [];

// 统计
let totalPrizeSum = 0;
let totalCost = 0;
const tierHitCount: Record<string, number> = {};
const winCellCountDist: Record<number, number> = {};
let ticketWith1YiCount = 0;
let ticketWithAnyWinCount = 0;
let bigWinCount = 0; // 奖金 >= 票价
let pityTriggeredCount = 0; // 保底触发次数

for (const tier of PRIZE_TIERS) {
  tierHitCount[tier.key] = 0;
}
for (let i = 0; i <= MAX_WIN_CELLS; i++) {
  winCellCountDist[i] = 0;
}

// 详细log只记录前100张
const DETAIL_LOG_COUNT = 100;

for (let i = 0; i < SIMULATION_COUNT; i++) {
  const result = simulateTicket(i);

  totalPrizeSum += result.totalPrize;
  totalCost += TICKET_PRICE;

  if (result.winCellCount > 0) {
    ticketWithAnyWinCount++;
  }
  if (result.has1Yi) {
    ticketWith1YiCount++;
  }
  if (result.totalPrize >= TICKET_PRICE) {
    bigWinCount++;
  }
  if (result.pityTriggered) {
    pityTriggeredCount++;
  }

  winCellCountDist[result.winCellCount]++;

  for (const cell of result.cells) {
    if (cell.isWin && cell.tierKey) {
      tierHitCount[cell.tierKey]++;
    }
  }

  // 详细log
  if (i < DETAIL_LOG_COUNT) {
    logs.push(`\n========== 票据 #${i + 1} ==========`);
    logs.push(`中奖格子数: ${result.winCellCount}`);
    logs.push(`总奖金: ${result.totalPrize}`);
    for (let j = 0; j < result.cells.length; j++) {
      const cell = result.cells[j];
      if (cell.isWin) {
        logs.push(`  格子${j + 1}: [${cell.numbers.join(',')}] 中奖 → ${cell.tierName} (+${cell.amount})`);
      } else {
        logs.push(`  格子${j + 1}: [${cell.numbers.join(',')}] 不中奖`);
      }
    }
  }
}

// 写入详细log
const logFile = 'scripts/sanyuan_simulation_log.txt';
writeFileSync(logFile, logs.join('\n'));
console.log(`详细log已写入: ${logFile} (前${DETAIL_LOG_COUNT}张)`);

// 输出统计结果
console.log('\n========== 统计结果 ==========');
console.log(`\n总模拟次数: ${SIMULATION_COUNT}`);
console.log(`总投入: ${totalCost.toLocaleString()}`);
console.log(`总奖金: ${totalPrizeSum.toLocaleString()}`);
console.log(`返奖率: ${(totalPrizeSum / totalCost * 100).toFixed(2)}%`);
console.log(`净收益: ${(totalPrizeSum - totalCost).toLocaleString()}`);

console.log('\n=== 中奖格子数分布 ===');
for (let i = 0; i <= MAX_WIN_CELLS; i++) {
  const count = winCellCountDist[i];
  console.log(`${i}格中奖: ${count} (${(count / SIMULATION_COUNT * 100).toFixed(2)}%)`);
}

console.log('\n=== 各奖级中奖次数 ===');
for (const tier of PRIZE_TIERS) {
  const count = tierHitCount[tier.key];
  const expected = SIMULATION_COUNT * CELL_COUNT * tier.weight;
  console.log(`${tier.name}: ${count}次 (期望: ${expected.toFixed(0)}次, 偏差: ${((count / expected - 1) * 100).toFixed(2)}%)`);
}

console.log('\n=== 特殊统计 ===');
console.log(`有中奖的票据: ${ticketWithAnyWinCount} (${(ticketWithAnyWinCount / SIMULATION_COUNT * 100).toFixed(2)}%)`);
console.log(`有1亿的票据: ${ticketWith1YiCount} (${(ticketWith1YiCount / SIMULATION_COUNT * 100).toFixed(2)}%)`);
console.log(`奖金>=票价的票据: ${bigWinCount} (${(bigWinCount / SIMULATION_COUNT * 100).toFixed(2)}%)`);
console.log(`兜底触发（格子6）: ${pityTriggeredCount} (${(pityTriggeredCount / SIMULATION_COUNT * 100).toFixed(2)}%)`);

// 计算每张票的期望
const expectedPerTicket = totalPrizeSum / SIMULATION_COUNT;
console.log(`\n=== 期望分析 ===`);
console.log(`每张票平均奖金: ${expectedPerTicket.toFixed(2)}`);
console.log(`每张票成本: ${TICKET_PRICE}`);
console.log(`每张票期望收益: ${(expectedPerTicket - TICKET_PRICE).toFixed(2)}`);
console.log(`返奖率: ${(expectedPerTicket / TICKET_PRICE * 100).toFixed(2)}%`);
