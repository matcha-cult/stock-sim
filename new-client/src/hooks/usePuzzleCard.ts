/**
 * 常驻刮刮乐状态管理 Hook。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理购票、批量购票、兑奖、历史查询等核心状态。
 * 2. 不做什么：不处理 UI 动画（由组件负责）、不决定玩法规则（后端决定）、
 *    不在 mount 时恢复活跃票据（批量购买已自动兑奖，单张购票仅在当前会话内有效）。
 *
 * 数据流 / 状态流：
 * 购票/批量购票 → 展示结果 → 用户兑奖（单张）或刷新历史 → 历史列表。
 *
 * 复用设计说明：
 * - API 调用统一走 services/api/puzzleCard.ts。
 * - 请求去重走 RequestDedup，in-flight 守卫覆盖 StrictMode 双 mount。
 *
 * 关键边界条件与坑点：
 * 1. dedup.enter() 必须在设置 loading 之前调用；dedup.complete() 必须在 finally 中。
 * 2. 购票失败由 axios 拦截器自动弹 toast，组件不需重复处理。
 */
import { useState, useCallback } from 'react';
import type { PuzzleTicketDto, HistoryResultDto, RedeemResultDto, BatchPurchaseResultDto } from '../services/api/puzzleCard';
import { purchaseTicket, batchPurchaseTicket, redeemTicket, getRedeemHistory } from '../services/api/puzzleCard';
import { RequestDedup } from '../stores/RequestDedup';

interface UsePuzzleCardReturn {
  activeTicket: PuzzleTicketDto | null;
  batchResult: BatchPurchaseResultDto | null;
  history: HistoryResultDto | null;
  purchasing: boolean;
  batchPurchasing: boolean;
  redeeming: boolean;
  loadingHistory: boolean;
  purchase: (typeKey: string) => Promise<PuzzleTicketDto | null>;
  batchPurchase: (typeKey: string) => Promise<BatchPurchaseResultDto | null>;
  redeem: () => Promise<RedeemResultDto | null>;
  redeemFromHistory: (ticketId: number, redeemCode: string) => Promise<RedeemResultDto | null>;
  refreshHistory: (page?: number) => Promise<void>;
  clearActive: () => void;
  clearBatchResult: () => void;
}

export const usePuzzleCard = (): UsePuzzleCardReturn => {
  const [activeTicket, setActiveTicket] = useState<PuzzleTicketDto | null>(null);
  const [batchResult, setBatchResult] = useState<BatchPurchaseResultDto | null>(null);
  const [history, setHistory] = useState<HistoryResultDto | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [batchPurchasing, setBatchPurchasing] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const dedupRef = useState(() => new RequestDedup())[0];

  const purchase = useCallback(async (typeKey: string): Promise<PuzzleTicketDto | null> => {
    if (!dedupRef.enter('purchase')) return null;
    setPurchasing(true);
    try {
      const res = await purchaseTicket(typeKey);
      if (res.success) {
        setActiveTicket(res.data);
        return res.data;
      }
      return null;
    } finally {
      dedupRef.complete('purchase');
      setPurchasing(false);
    }
  }, [dedupRef]);

  const batchPurchase = useCallback(async (typeKey: string): Promise<BatchPurchaseResultDto | null> => {
    if (!dedupRef.enter('batch-purchase')) return null;
    setBatchPurchasing(true);
    try {
      const res = await batchPurchaseTicket(typeKey);
      if (res.success) {
        setBatchResult(res.data);
        return res.data;
      }
      return null;
    } finally {
      dedupRef.complete('batch-purchase');
      setBatchPurchasing(false);
    }
  }, [dedupRef]);

  const redeem = useCallback(async (): Promise<RedeemResultDto | null> => {
    if (!activeTicket) return null;
    if (!dedupRef.enter('redeem')) return null;
    setRedeeming(true);
    try {
      const res = await redeemTicket(Number(activeTicket.id), activeTicket.redeemCode);
      if (res.success) {
        setActiveTicket(null);
        return res.data;
      }
      return null;
    } finally {
      dedupRef.complete('redeem');
      setRedeeming(false);
    }
  }, [activeTicket, dedupRef]);

  const refreshHistory = useCallback(async (page: number = 1): Promise<void> => {
    if (!dedupRef.enter('history')) return;
    setLoadingHistory(true);
    try {
      const res = await getRedeemHistory(page);
      if (res.success) setHistory(res.data);
    } finally {
      dedupRef.complete('history');
      setLoadingHistory(false);
    }
  }, [dedupRef]);

  const redeemFromHistory = useCallback(async (ticketId: number, redeemCode: string): Promise<RedeemResultDto | null> => {
    if (!dedupRef.enter('redeem-history')) return null;
    setRedeeming(true);
    try {
      const res = await redeemTicket(ticketId, redeemCode);
      if (res.success) {
        if (history) void refreshHistory(history.page);
        return res.data;
      }
      return null;
    } finally {
      dedupRef.complete('redeem-history');
      setRedeeming(false);
    }
  }, [dedupRef, history, refreshHistory]);

  const clearActive = useCallback(() => {
    setActiveTicket(null);
  }, []);

  const clearBatchResult = useCallback(() => {
    setBatchResult(null);
  }, []);

  return {
    activeTicket,
    batchResult,
    history,
    purchasing,
    batchPurchasing,
    redeeming,
    loadingHistory,
    purchase,
    batchPurchase,
    redeem,
    redeemFromHistory,
    refreshHistory,
    clearActive,
    clearBatchResult,
  };
};
