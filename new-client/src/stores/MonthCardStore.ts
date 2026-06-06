/**
 * 月卡 Store。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理月卡状态——加载、领取每日奖励。
 *    - 持有月卡激活状态、到期时间、配置信息。
 *    - 领取每日奖励后更新 observable。
 * 2. 不做什么：不做 UI 渲染、不处理 GM 发放逻辑。
 *
 * 输入 / 输出：
 * - 输入：刷新请求、领取请求。
 * - 输出：status observable、loading 状态、操作结果。
 *
 * 数据流 / 状态流：
 * refreshStatus -> API 获取月卡状态 -> observable 更新 -> 组件读取；
 * claimDaily -> API -> 更新 observable -> 组件响应。
 *
 * 复用设计说明：
 * - 请求逻辑集中在本模块，组件层只做 UI 交互。
 * - 被 RootStore 持有，通过 RootStore 传递。
 * - 请求去重使用 RequestDedup（in-flight 守卫）。
 *
 * 关键边界条件与坑点：
 * 1. dedup.enter() 必须在设置 loading 之前；dedup.complete() 必须在 finally 中。
 * 2. claimDaily 是用户主动 mutation，不去重，通过 isClaiming 防重。
 * 3. 操作成功后直接更新 observable，组件侧不重复维护状态。
 */

import { makeAutoObservable } from 'mobx';
import {
  getMonthCardStatus,
  claimDailyReward,
  type MonthCardStatusDto,
  type MonthCardConfigDto,
} from '../services/api/monthCard';
import { RequestDedup } from './RequestDedup';

export class MonthCardStore {
  private readonly dedup = new RequestDedup();

  // 状态
  isActive: boolean = false;
  expiresAt: number | null = null;
  daysRemaining: number | null = null;
  todayClaimed: boolean = false;
  config: MonthCardConfigDto | null = null;

  loading: boolean = false;
  isClaiming: boolean = false;

  constructor() {
    makeAutoObservable(this);
  }

  // ========== 私有方法 ==========

  private applyStatus(data: MonthCardStatusDto): void {
    this.isActive = data.isActive;
    this.expiresAt = data.expiresAt;
    this.daysRemaining = data.daysRemaining;
    this.todayClaimed = data.todayClaimed;
    this.config = data.config;
  }

  // ========== 公开方法 ==========

  async refreshStatus(background = false): Promise<void> {
    if (!this.dedup.enter('monthCardStatus', background)) return;

    if (!background) this.loading = true;
    const promise = (async () => {
      try {
        const response = await getMonthCardStatus();
        if (response.success && response.data) {
          this.applyStatus(response.data);
        }
      } catch {
        // 静默失败
      } finally {
        if (!background) this.loading = false;
        this.dedup.complete('monthCardStatus');
      }
    })();
    this.dedup.start('monthCardStatus', promise);
    return promise;
  }

  async claimDaily(): Promise<{ success: boolean; message: string }> {
    this.isClaiming = true;
    try {
      const response = await claimDailyReward();
      if (response.success && response.data) {
        this.todayClaimed = true;
        return { success: true, message: '' };
      }
      return { success: false, message: response.message ?? '领取失败' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '领取失败';
      return { success: false, message };
    } finally {
      this.isClaiming = false;
    }
  }

  reset(): void {
    this.isActive = false;
    this.expiresAt = null;
    this.daysRemaining = null;
    this.todayClaimed = false;
    this.config = null;
    this.loading = false;
    this.isClaiming = false;
    this.dedup.reset();
  }
}
