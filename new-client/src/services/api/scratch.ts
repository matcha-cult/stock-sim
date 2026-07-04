/**
 * 刮刮乐 API 服务。
 *
 * 作用：提供刮刮乐概览、刮格子、开奖的 API 调用。
 */
import api from './core';

// ========== 类型定义 ==========

export interface ScratchTicketDto {
  id: string;
  characterId: number;
  day: string;
  ticketNumber: number;
  configKey: string;       // "3x3"/"4x4"/"5x5"
  gridSize: number;
  scratchCount: number;
  maxScratchCount: number;
  scratchedMask: number;   // 位标记，用于前端判断哪些格子已刮
  revealedValues: number[];
  settled: boolean;
  selectedLine: string | null;
  lineSum: number | null;
  prizeTier: string | null;
  prizeTierName: string | null;
  prizeAmount: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ScratchOverviewDto {
  tickets: ScratchTicketDto[];
  settledCount: number;
  totalCount: number;
  currentTicketNumber: number | null;
  allSettled: boolean;
}

export interface ScratchCellResultDto {
  ticket: ScratchTicketDto;
  cellIndex: number;
  cellValue: number;
  scratchCount: number;
  maxScratchCount: number;
}

export interface ScratchSettleResultDto {
  settled: boolean;
  prize: number;
  lineSum: number;
  tierKey: string;
  tierName: string;
  nextTicketNumber: number | null;
  ticket: ScratchTicketDto;
}

export interface PrizeTierDto {
  tierKey: string;
  tierName: string;
  sumMin: number;
  sumMax: number;
  prizeAmount: number;
  sortOrder: number;
}

export interface LineDto {
  key: string;
  name: string;
  indices: number[];
}

export interface ScratchConfigDto {
  ticketNumber: number;
  configKey: string;
  description: string;
  gridSize: number;
  maxScratchCount: number;
  minVisibleCount: number;
  prizeTiers: PrizeTierDto[];
  lines: LineDto[];
}

export interface ScratchConfigResponse {
  tickInfo: ScratchConfigDto[];
}

// ========== API 函数 ==========

export const getScratchOverview = (): Promise<{ data: ScratchOverviewDto; success: boolean }> => {
  return api.get<ScratchOverviewDto>('/api/scratch/overview');
};

export const scratchCell = (
  ticketNumber: number,
  cellIndex: number,
): Promise<{ data: ScratchCellResultDto; success: boolean }> => {
  return api.post<ScratchCellResultDto>('/api/scratch/scratch', { ticketNumber, cellIndex });
};

export const settleTicket = (
  ticketNumber: number,
  lineKey: string,
): Promise<{ data: ScratchSettleResultDto; success: boolean }> => {
  return api.post<ScratchSettleResultDto>('/api/scratch/settle', { ticketNumber, lineKey });
};

export const getScratchConfig = (): Promise<{ data: ScratchConfigResponse; success: boolean }> => {
  return api.get<ScratchConfigResponse>('/api/scratch/config');
};
