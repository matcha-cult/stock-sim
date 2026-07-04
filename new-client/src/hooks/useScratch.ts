/**
 * 刮刮乐状态管理 Hook。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理刮刮乐核心状态——加载概览、刮格子、开奖、自动刷新。
 * 2. 不做什么：不处理 UI 交互（由组件负责）、不决定选线逻辑（由组件管理）。
 *
 * 输入 / 输出：
 * - 输入：无（自动获取当前角色）。
 * - 输出：概览数据、加载状态、操作方法。
 *
 * 数据流 / 状态流：
 * 组件挂载 -> 加载概览 -> 用户刮格子/开奖 -> 刷新概览。
 *
 * 复用设计说明：
 * - API 调用统一走 services/api/scratch.ts。
 * - 请求去重走 stores/RequestDedup，in-flight 守卫已覆盖 StrictMode 双 mount，
 *   不需要 mountedRef.current 守卫状态更新（否则双 mount 场景下 loading 永远卡在 true）。
 * - 被 ScratchCardPage 组件使用。
 *
 * 关键边界条件与坑点：
 * 1. dedup.enter() 必须在设置 loading 之前调用；dedup.complete() 必须在 finally 中。
 * 2. 刮格子/开奖失败时，axios 拦截器已自动弹 toast，组件不需重复处理。
 * 3. 开奖成功后自动切换到下一张票（nextTicketNumber）。
 * 4. 不使用 mountedRef 守卫状态更新——in-flight 守卫已经阻止了 StrictMode 下的重复请求，
 *    双重守卫会导致：mount1 的 cleanup 把 ref 设为 false → mount2 被 dedup 拦截 →
 *    mount1 的 finally 被 ref 阻断 → loading 永远卡在 true。
 */
import { useState, useCallback, useEffect } from 'react';
import type { ScratchOverviewDto, ScratchCellResultDto, ScratchSettleResultDto, ScratchConfigDto, ScratchConfigResponse } from '../services/api/scratch';
import { getScratchOverview, getScratchConfig, scratchCell as apiScratchCell, settleTicket as apiSettleTicket } from '../services/api/scratch';
import { RequestDedup } from '../stores/RequestDedup';

interface UseScratchReturn {
  overview: ScratchOverviewDto | null;
  config: ScratchConfigDto[] | null;
  loading: boolean;
  cellLoading: boolean;
  settleLoading: boolean;
  refreshOverview: (background?: boolean) => Promise<void>;
  scratchCell: (ticketNumber: number, cellIndex: number) => Promise<ScratchCellResultDto | null>;
  settleTicket: (ticketNumber: number, lineKey: string) => Promise<ScratchSettleResultDto | null>;
  advanceToNextTicket: () => void;
}

export const useScratch = (): UseScratchReturn => {
  const [overview, setOverview] = useState<ScratchOverviewDto | null>(null);
  const [config, setConfig] = useState<ScratchConfigDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [cellLoading, setCellLoading] = useState(false);
  const [settleLoading, setSettleLoading] = useState(false);
  const dedupRef = useState(() => new RequestDedup())[0];

  const refreshOverview = useCallback(async (background = false) => {
    // 1. in-flight 守卫（必须在设置 loading 之前）
    if (!dedupRef.enter('overview', background)) return;

    if (!background) setLoading(true);

    const promise = (async () => {
      try {
        const result = await getScratchOverview();
        if (result.success) {
          setOverview(result.data);
        }
      } finally {
        // 2. 清理 in-flight（必须在 finally 中）
        dedupRef.complete('overview');
        setLoading(false);
      }
    })();

    // 3. 注册 in-flight
    dedupRef.start('overview', promise);
    return promise;
  }, [dedupRef]);

  const handleScratchCell = useCallback(async (
    ticketNumber: number,
    cellIndex: number,
  ): Promise<ScratchCellResultDto | null> => {
    setCellLoading(true);
    try {
      const result = await apiScratchCell(ticketNumber, cellIndex);
      if (result.success) {
        setOverview(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            tickets: prev.tickets.map(t =>
              t.ticketNumber === result.data.ticket.ticketNumber ? result.data.ticket : t,
            ),
          };
        });
        return result.data;
      }
      return null;
    } finally {
      setCellLoading(false);
    }
  }, []);

  const handleSettleTicket = useCallback(async (
    ticketNumber: number,
    lineKey: string,
  ): Promise<ScratchSettleResultDto | null> => {
    setSettleLoading(true);
    try {
      const result = await apiSettleTicket(ticketNumber, lineKey);
      if (result.success) {
        // 用后端返回的 ticket 数据替换本地缓存中对应票
        setOverview(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            tickets: prev.tickets.map(t =>
              t.ticketNumber === ticketNumber ? result.data.ticket : t,
            ),
          };
        });
        return result.data;
      }
      return null;
    } finally {
      setSettleLoading(false);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    if (!dedupRef.enter('config')) return;

    const promise = (async () => {
      try {
        const result = await getScratchConfig();
        if (result.success) {
          const data: ScratchConfigResponse = result.data;
          setConfig(data.tickInfo);
        }
      } finally {
        dedupRef.complete('config');
      }
    })();

    dedupRef.start('config', promise);
    return promise;
  }, [dedupRef]);

  const advanceToNextTicket = useCallback(() => {
    void refreshOverview();
  }, [refreshOverview]);

  useEffect(() => {
    void refreshOverview();
    void loadConfig();
  }, [refreshOverview, loadConfig]);

  return {
    overview,
    config,
    loading,
    cellLoading,
    settleLoading,
    refreshOverview,
    scratchCell: handleScratchCell,
    settleTicket: handleSettleTicket,
    advanceToNextTicket,
  };
};
