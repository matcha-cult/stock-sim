/**
 * 七喜格子生成算法模拟器。
 * 输出详细 roll 日志到文件，运行 1000 次后分析。
 */
import { writeFileSync } from 'fs';

const MIN = 1;
const MAX = 6;
const SIMULATION_COUNT = 1000;

const logs: string[] = [];

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
const rollCellWorst = (rollCount: number, cellIndex: number, ticketIndex: number): { pair: [number, number]; rolls: string } => {
  let bestPair: [number, number] = [MIN, MIN];
  let maxDistance = -1;
  const rollLogs: string[] = [];

  for (let i = 0; i < rollCount; i++) {
    const [num1, num2] = rollPair();
    const distance = Math.abs(num1 + num2 - 7);
    rollLogs.push(`  roll ${i + 1}/${rollCount}: ${num1}+${num2}=${num1 + num2}, 距离=${distance}`);
    if (distance > maxDistance) {
      maxDistance = distance;
      bestPair = [num1, num2];
    }
  }
  rollLogs.push(`  最终选择: ${bestPair[0]}+${bestPair[1]}=${bestPair[0] + bestPair[1]}, 距离=${maxDistance}, 中奖=${bestPair[0] + bestPair[1] === 7 ? '是' : '否'}`);

  return { pair: bestPair, rolls: rollLogs.join('\n') };
};

// 强制 roll 中和值 7
const rollPairSumSeven = (): [number, number] => {
  const sumSevenPairs: [number, number][] = [[1, 6], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1]];
  return sumSevenPairs[Math.floor(Math.random() * sumSevenPairs.length)];
};

// 强制 roll 不中和值 7
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

// 生成一次完整的格子数据
const generateOnce = (ticketIndex: number): { cells: [number, number][]; hits: boolean[]; ticketLog: string } => {
  const ticketLogs: string[] = [];
  ticketLogs.push(`\n========== 票据 #${ticketIndex + 1} ==========`);
  const cells: [number, number][] = [];

  // 格子1：roll 3次取最差
  ticketLogs.push('\n[格子1] roll 3次取最差:');
  const cell1 = rollCellWorst(3, 0, ticketIndex);
  cells[0] = cell1.pair;
  ticketLogs.push(cell1.rolls);

  // 格子2：roll 5次取最差
  ticketLogs.push('\n[格子2] roll 5次取最差:');
  const cell2 = rollCellWorst(5, 1, ticketIndex);
  cells[1] = cell2.pair;
  ticketLogs.push(cell2.rolls);

  // 格子3：roll 1次
  ticketLogs.push('\n[格子3] roll 1次:');
  const cell3 = rollCellWorst(1, 2, ticketIndex);
  cells[2] = cell3.pair;
  ticketLogs.push(cell3.rolls);

  // 格子4：保底逻辑
  const cell1Hit = cells[0][0] + cells[0][1] === 7;
  const cell2Hit = cells[1][0] + cells[1][1] === 7;
  const cell3Hit = cells[2][0] + cells[2][1] === 7;
  const allPreviousMissed = !cell1Hit && !cell2Hit && !cell3Hit;

  ticketLogs.push(`\n[格子4] 前3格中奖情况: 格1=${cell1Hit ? '中奖' : '未中奖'}, 格2=${cell2Hit ? '中奖' : '未中奖'}, 格3=${cell3Hit ? '中奖' : '未中奖'}`);

  if (allPreviousMissed) {
    const pityRoll = Math.random();
    ticketLogs.push(`[格子4] 保底判定: random=${(pityRoll * 100).toFixed(2)}%`);
    if (pityRoll < 0.54) {
      cells[3] = rollPairSumSeven();
      ticketLogs.push(`[格子4] 触发保底 (< 54%)，强制和为7: ${cells[3][0]}+${cells[3][1]}=${cells[3][0] + cells[3][1]}`);
    } else {
      cells[3] = rollPairNotSeven();
      ticketLogs.push(`[格子4] 未触发保底 (>= 54%)，强制不中奖: ${cells[3][0]}+${cells[3][1]}=${cells[3][0] + cells[3][1]}`);
    }
  } else {
    cells[3] = rollPairNotSeven();
    ticketLogs.push(`[格子4] 前3格有中奖，强制不中奖: ${cells[3][0]}+${cells[3][1]}=${cells[3][0] + cells[3][1]}`);
  }

  const hits = cells.map(c => c[0] + c[1] === 7);
  ticketLogs.push(`\n[结果] 中奖格子: ${hits.map((h, i) => h ? `格${i + 1}` : '').filter(Boolean).join(', ') || '无'}`);

  return { cells, hits, ticketLog: ticketLogs.join('\n') };
};

// 运行模拟
console.log(`开始模拟 ${SIMULATION_COUNT} 次...`);

const cellHitCount = [0, 0, 0, 0];
const anyHitCount = { value: 0 };
const combinationCount: Record<string, number> = {};

// 统计"格子1中奖时，其他格子的中奖情况"
const cell1HitStats: Record<string, number> = {
  '仅格子1': 0,
  '格子1+格子2': 0,
  '格子1+格子3': 0,
  '格子1+格子4': 0,
  '格子1+格子2+格子3': 0,
  '格子1+格子2+格子4': 0,
  '格子1+格子3+格子4': 0,
  '全部': 0,
};

for (let i = 0; i < SIMULATION_COUNT; i++) {
  const { hits, ticketLog } = generateOnce(i);
  logs.push(ticketLog);

  // 统计每个格子中奖次数
  for (let j = 0; j < 4; j++) {
    if (hits[j]) cellHitCount[j]++;
  }

  // 统计至少一个中奖
  if (hits.some(h => h)) anyHitCount.value++;

  // 统计组合
  const combo = hits.map((h, idx) => h ? `格${idx + 1}` : '').filter(Boolean).join('+') || '无中奖';
  combinationCount[combo] = (combinationCount[combo] ?? 0) + 1;

  // 统计格子1中奖时的情况
  if (hits[0]) {
    const hitCells = hits.map((h, idx) => h ? idx : -1).filter(x => x >= 0);
    if (hitCells.length === 1) cell1HitStats['仅格子1']++;
    else if (hitCells.length === 2) {
      if (hitCells.includes(1)) cell1HitStats['格子1+格子2']++;
      else if (hitCells.includes(2)) cell1HitStats['格子1+格子3']++;
      else cell1HitStats['格子1+格子4']++;
    } else if (hitCells.length === 3) {
      if (!hitCells.includes(3)) cell1HitStats['格子1+格子2+格子3']++;
      else if (!hitCells.includes(2)) cell1HitStats['格子1+格子2+格子4']++;
      else cell1HitStats['格子1+格子3+格子4']++;
    } else {
      cell1HitStats['全部']++;
    }
  }
}

// 写入详细日志文件
const logFile = 'scripts/qixi_simulation_log.txt';
writeFileSync(logFile, logs.join('\n'));
console.log(`详细日志已写入: ${logFile}`);

// 输出统计结果
console.log('\n========== 统计结果 ==========');
console.log('\n=== 各格子中奖统计 ===');
for (let i = 0; i < 4; i++) {
  console.log(`格子${i + 1}: ${cellHitCount[i]}/${SIMULATION_COUNT} (${(cellHitCount[i] / SIMULATION_COUNT * 100).toFixed(2)}%)`);
}

console.log(`\n=== 至少一个中奖（保底率） ===`);
console.log(`${anyHitCount.value}/${SIMULATION_COUNT} (${(anyHitCount.value / SIMULATION_COUNT * 100).toFixed(2)}%)`);

console.log(`\n=== 中奖组合分布 ===`);
const sortedCombos = Object.entries(combinationCount).sort((a, b) => b[1] - a[1]);
for (const [combo, count] of sortedCombos) {
  console.log(`${combo}: ${count} (${(count / SIMULATION_COUNT * 100).toFixed(2)}%)`);
}

console.log(`\n=== 格子1中奖时的组合分布 ===`);
const cell1Total = Object.values(cell1HitStats).reduce((a, b) => a + b, 0);
console.log(`格子1总中奖次数: ${cell1Total}`);
for (const [combo, count] of Object.entries(cell1HitStats)) {
  if (count > 0) {
    console.log(`  ${combo}: ${count} (${(count / cell1Total * 100).toFixed(2)}%)`);
  }
}
