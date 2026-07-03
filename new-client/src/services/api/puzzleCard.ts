/**
 * 常驻刮刮乐 API 服务。
 *
 * 作用：提供购票、兑奖、兑奖历史、活跃票据的 API 调用。
 */
import api from './core';

// ========== 类型定义 ==========

export interface MatchedLineDto {
  tierKey: string;
  tierName: string;
  prizeType: string;
  prizeAmount: number;
}

export interface PuzzleTicketDto {
  id: string;
  typeKey: string;
  ticketNumber: number;
  gridRows: number;
  gridCols: number;
  pricePaid: number;
  ticketData: { grid: number[] };
  matchedLines: MatchedLineDto[];
  prizeType: string;
  prizeAmount: number;
  redeemCode: string;
  redeemedAt: number | null;
  createdAt: number;
}

export interface RedeemResultDto {
  id: string;
  prizeType: string;
  prizeAmount: number;
  redeemedAt: number;
}

export interface HistoryItemDto {
  id: string;
  typeKey: string;
  typeName: string;
  ticketNumber: number;
  pricePaid: number;
  ticketData: { grid: number[] };
  matchedLines: MatchedLineDto[];
  prizeType: string;
  prizeAmount: number;
  redeemCode: string | null;
  redeemedAt: number | null;
  createdAt: number;
}

export interface HistoryResultDto {
  items: HistoryItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BatchPurchaseResultDto {
  tickets: PuzzleTicketDto[];
  totalCost: number;
  totalPrize: number;
  netProfit: number;
}

export interface PuzzleCardTypeDto {
  typeKey: string;
  name: string;
  description: string;
  gridRows: number;
  gridCols: number;
  numbersPerCell: number;
  price: number;
  ruleType: string;
  dailyLimit: number;
  rules?: string[];
}

// ========== API 函数 ==========

export const purchaseTicket = (
  typeKey: string,
): Promise<{ data: PuzzleTicketDto; success: boolean }> => {
  return api.post<PuzzleTicketDto>('/api/puzzle-card/purchase', { typeKey });
};

export const batchPurchaseTicket = (
  typeKey: string,
): Promise<{ data: BatchPurchaseResultDto; success: boolean }> => {
  return api.post<BatchPurchaseResultDto>('/api/puzzle-card/batch-purchase', { typeKey });
};

export const redeemTicket = (
  ticketId: number,
  redeemCode: string,
): Promise<{ data: RedeemResultDto; success: boolean }> => {
  return api.post<RedeemResultDto>('/api/puzzle-card/redeem', { ticketId, redeemCode });
};

export const getRedeemHistory = (
  page: number,
): Promise<{ data: HistoryResultDto; success: boolean }> => {
  return api.get<HistoryResultDto>('/api/puzzle-card/history', { params: { page } });
};

export const getActiveTicket = (): Promise<{ data: PuzzleTicketDto | null; success: boolean }> => {
  return api.get<PuzzleTicketDto | null>('/api/puzzle-card/active');
};

// ========== 内存常量（类型配置） ==========
// 与后端 puzzleCardTypes.ts 保持一致，仅用于前端展示。

export interface PuzzlePrizeTierDto {
  tierKey: string;
  tierName: string;
  prizeAmount: number;
}

export const PUZZLE_CARD_TYPES: PuzzleCardTypeDto[] = [
  {
    typeKey: 'QIXI',
    name: '七喜',
    description: '4格各含2个数字(1~6)，每格两数之和为7即该格中奖，按格子序号分档兑奖',
    gridRows: 2,
    gridCols: 2,
    numbersPerCell: 2,
    price: 50_000,
    ruleType: 'CELL_SUM_MATCH',
    dailyLimit: 777,
    rules: [
      '每个格子生成2个数字（1~6）',
      '格子内两数之和 = 7 则该格中奖',
      '格子1中奖：500万灵石',
      '格子2中奖：1亿灵石',
      '格子3中奖：10万灵石',
      '格子4中奖：5万灵石',
      '多格中奖奖金累加',
      '可单张购买或批量购买20张',
      '每日限购与中奖率惩罚起点777票',
      '购票限制：5秒内最多购买2次',
      '兑奖限制：5秒内最多兑奖2次',
    ],
  },
];

export const QIXI_PRIZE_TIERS: Record<number, PuzzlePrizeTierDto> = {
  0: { tierKey: 'cell_0', tierName: '格子1中奖', prizeAmount: 5_000_000 },
  1: { tierKey: 'cell_1', tierName: '格子2中奖', prizeAmount: 100_000_000 },
  2: { tierKey: 'cell_2', tierName: '格子3中奖', prizeAmount: 100_000 },
  3: { tierKey: 'cell_3', tierName: '格子4中奖', prizeAmount: 50_000 },
};
