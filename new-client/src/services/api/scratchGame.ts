/**
 * 刮刮乐接口封装。
 *
 * 提供获取当天彩票列表、刮格子、开奖的 API 函数。
 */
import type { AxiosRequestConfig } from 'axios';
import api from './core';

export interface ScratchTicketDto {
  id: string;
  characterId: number;
  day: string;           // YYYY-MM-DD
  ticketNumber: number;  // 1/2/3
  gridSize: number;      // 格子总数
  scratchCount: number;  // 已刮格子数
  scratchedMask: number;
  status: string;        // active/completed
  settled: boolean;      // 是否已开奖
  createdAt: number;
  updatedAt: number;
}

export interface DayTicketsDto {
  tickets: ScratchTicketDto[];
  currentTicket: ScratchTicketDto | null;
  completedCount: number;
  totalCount: number;
  allSettled: boolean;
}

export interface ScratchResultDto {
  ticket: ScratchTicketDto;
  cellIndex: number;
  cellValue: number;
  ticketCompleted: boolean;
  allCompleted: boolean;
}

export interface SettleResultDto {
  settled: boolean;
  tickets: ScratchTicketDto[];
}

/**
 * 获取当天所有彩票 + 当前可刮的票。
 */
export const getDayTickets = (
  requestConfig?: AxiosRequestConfig,
): Promise<{ success: boolean; data: DayTicketsDto | null; message?: string }> => {
  return api.get('/api/scratch/tickets', requestConfig);
};

/**
 * 刮一个格子。
 */
export const scratchCell = (
  ticketNumber: number,
  cellIndex: number,
  requestConfig?: AxiosRequestConfig,
): Promise<{ success: boolean; data: ScratchResultDto; message?: string }> => {
  return api.post('/api/scratch/scratch', { ticketNumber, cellIndex }, requestConfig);
};

/**
 * 开奖（3 张全部刮完后可调用）。
 */
export const settleTickets = (
  requestConfig?: AxiosRequestConfig,
): Promise<{ success: boolean; data: SettleResultDto; message?: string }> => {
  return api.post('/api/scratch/settle', {}, requestConfig);
};
