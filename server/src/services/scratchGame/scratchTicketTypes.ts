/**
 * 刮刮乐共享类型。
 *
 * 作用：定义后端服务层、配置缓存、路由之间的公共类型，避免多处重复。
 */

// ========== 配置缓存类型 ==========

export interface TicketConfig {
  configKey: string;
  ticketNumber: number;
  gridSize: number;
  maxScratchCount: number;
  minVisibleCount: number;
  description: string;
}

export interface PrizeTier {
  tierKey: string;
  tierName: string;
  sumMin: number;
  sumMax: number;
  prizeAmount: number;
  sortOrder: number;
}

// ========== 线定义 ==========

export interface LineDef {
  key: string;       // "row_0", "col_1", "diag_0", "diag_1"
  name: string;      // "第 1 行", "第 2 列", "主对角线 ↘", "副对角线 ↙"
  indices: number[]; // 该线包含的格子索引
}

// ========== 开奖服务类型 ==========

/** 单张票的选线输入 */
export interface TicketSettleInput {
  ticketNumber: number;
  lineKey: string;
}

/** 单张票的开奖结果 */
export interface TicketSettleResult {
  ticketNumber: number;
  lineKey: string;
  lineName: string;
  lineSum: number;
  tierKey: string;
  tierName: string;
  prizeAmount: number;
}

/** 开奖总结果 */
export interface SettleResultDto {
  settled: boolean;
  totalPrize: number;
  tickets: TicketSettleResult[];
}

// ========== 线索引计算 ==========

/**
 * 根据格子总数构建可选线列表。
 * gridSize 必须是完全平方数（9/16/25）。
 */
export const buildLines = (gridSize: number): LineDef[] => {
  const N = Math.round(Math.sqrt(gridSize));
  if (N * N !== gridSize) throw new Error(`gridSize ${gridSize} 不是完全平方数`);

  const lines: LineDef[] = [];

  // 横向 N 条
  for (let r = 0; r < N; r++) {
    const indices = Array.from({ length: N }, (_, c) => r * N + c);
    lines.push({ key: `row_${r}`, name: `第 ${r + 1} 行`, indices });
  }

  // 纵向 N 条
  for (let c = 0; c < N; c++) {
    const indices = Array.from({ length: N }, (_, r) => r * N + c);
    lines.push({ key: `col_${c}`, name: `第 ${c + 1} 列`, indices });
  }

  // 对角线 2 条
  const diag0: number[] = [];
  const diag1: number[] = [];
  for (let i = 0; i < N; i++) {
    diag0.push(i * N + i);
    diag1.push(i * N + (N - 1 - i));
  }
  lines.push({ key: 'diag_0', name: '主对角线 ↘', indices: diag0 });
  lines.push({ key: 'diag_1', name: '副对角线 ↙', indices: diag1 });

  return lines;  // 总共 2N + 2 条
};

/** 生成 [1..n] 的随机排列（Fisher-Yates 洗牌）。 */
export const shuffleArray = (n: number): number[] => {
  const arr = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
