/**
 * 刮刮乐 Store。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理玩家当天 3 张票的状态——加载、刮格子、开奖。
 *    - 持有当天所有票列表 + 当前可刮票。
 *    - 刮格子后自动更新票列表。
 *    - 3 张全刮完后支持开奖。
 * 2. 不做什么：不做 UI 渲染、不决定中奖规则。
 *
 * 输入 / 输出：
 * - 输入：刷新请求、刮格子动作、开奖动作。
 * - 输出：tickets observable、currentTicket observable、loading 状态、操作结果。
 *
 * 数据流 / 状态流：
 * refreshTicket -> API 获取当天所有票 -> observable 更新 -> 组件读取；
 * scratchCell -> API -> 更新 observable -> 组件响应；
 * settle -> API -> 标记 settled -> 组件响应。
 *
 * 复用设计说明：
 * - 请求逻辑集中在本模块，组件层只做 UI 交互。
 * - 被 RootStore 持有，通过 RootStore 传递。
 * - 请求去重使用 RequestDedup（in-flight 守卫）。
 *
 * 关键边界条件与坑点：
 * 1. dedup.enter() 必须在设置 loading 之前；dedup.complete() 必须在 finally 中。
 * 2. scratchCell/settle 是用户主动 mutation，不去重，通过 isScratching/isSettling 防重。
 * 3. 操作成功后直接更新 observable，组件侧不重复维护状态。
 */

import { makeAutoObservable } from 'mobx';
import {
  getDayTickets,
  scratchCell,
  settleTickets,
  type DayTicketsDto,
  type ScratchTicketDto,
  type ScratchResultDto,
} from '../services/api/scratchGame';
import { RequestDedup } from './RequestDedup';

export class ScratchStore {
  private readonly dedup = new RequestDedup();

  // 当天所有票
  tickets: ScratchTicketDto[] = [];
  // 当前可刮的票（第一张 active 的票）
  currentTicket: ScratchTicketDto | null = null;
  // 聚合状态
  completedCount: number = 0;
  totalCount: number = 3;
  allSettled: boolean = false;

  ticketLoading: boolean = false;
  isScratching: boolean = false;
  isSettling: boolean = false;
  lastScratchResult: ScratchResultDto | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  // ========== 私有方法 ==========

  private applyDayTickets(data: DayTicketsDto): void {
    this.tickets = data.tickets;
    this.currentTicket = data.currentTicket;
    this.completedCount = data.completedCount;
    this.totalCount = data.totalCount;
    this.allSettled = data.allSettled;
  }

  // ========== 公开方法 ==========

  async refreshTicket(background = false): Promise<void> {
    if (!this.dedup.enter('scratchTicket', background)) return;

    if (!background) this.ticketLoading = true;
    const promise = (async () => {
      try {
        const response = await getDayTickets();
        if (response.success && response.data) {
          this.applyDayTickets(response.data);
        }
      } catch {
        // 静默失败
      } finally {
        if (!background) this.ticketLoading = false;
        this.dedup.complete('scratchTicket');
      }
    })();
    this.dedup.start('scratchTicket', promise);
    return promise;
  }

  async scratchCell(ticketNumber: number, cellIndex: number): Promise<{ success: boolean; message: string }> {
    this.isScratching = true;
    try {
      const response = await scratchCell(ticketNumber, cellIndex);
      if (response.success) {
        this.lastScratchResult = response.data;
        // 更新当前票
        this.tickets = this.tickets.map((t) =>
          t.ticketNumber === response.data.ticket.ticketNumber ? response.data.ticket : t,
        );
        this.currentTicket = this.tickets.find((t) => t.status === 'active') ?? null;
        this.completedCount = this.tickets.filter((t) => t.status === 'completed').length;
        return { success: true, message: '' };
      }
      return { success: false, message: response.message ?? '刮开失败' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '刮开失败';
      return { success: false, message };
    } finally {
      this.isScratching = false;
    }
  }

  async settle(): Promise<{ success: boolean; message: string }> {
    this.isSettling = true;
    try {
      const response = await settleTickets();
      if (response.success) {
        this.allSettled = true;
        this.tickets = response.data.tickets;
        return { success: true, message: '' };
      }
      return { success: false, message: response.message ?? '开奖失败' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '开奖失败';
      return { success: false, message };
    } finally {
      this.isSettling = false;
    }
  }

  reset(): void {
    this.tickets = [];
    this.currentTicket = null;
    this.completedCount = 0;
    this.totalCount = 3;
    this.allSettled = false;
    this.ticketLoading = false;
    this.isScratching = false;
    this.isSettling = false;
    this.lastScratchResult = null;
    this.dedup.reset();
  }
}
