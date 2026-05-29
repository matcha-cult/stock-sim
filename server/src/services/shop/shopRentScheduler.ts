/**
 * 收租系统周期调度器（独立于股市行情调度）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：按 SHOP_RENT_TICK_INTERVAL 独立周期触发 shopService.processRentTick。
 * 2. 不做什么：不参与股市行情 tick、不管理店铺业务逻辑。
 *
 * 输入 / 输出：
 * - 输入：启动/停止。
 * - 输出：定时触发 shopService.processRentTick，并记录日志。
 *
 * 数据流 / 状态流：
 * startupPipeline -> initializeShopRentScheduler -> setTimeout 到下一周期边界 -> processRentTick -> 重新安排下一轮。
 *
 * 复用设计说明：
 * - 调度生命周期和股市调度保持同一模式，启动、互斥、停止都在一个模块中收敛。
 * - 周期边界计算复用 shopRentTime，概览倒计时和后台触发不会各自计算。
 *
 * 关键边界条件与坑点：
 * 1. 不能使用固定 setInterval，否则执行耗时会让 tick 逐渐漂移。
 * 2. 停止后必须清理 timeout，避免 worker 角色优雅关闭时残留后台句柄。
 */
import { shopService } from './shopService.js';
import { getShopRentTickDelayMs } from './shopRentTime.js';

let timer: NodeJS.Timeout | null = null;
let initialized = false;
let inFlight = false;

const isSchedulerEnabled = (): boolean => {
  const env = process.env.SHOP_RENT_SCHEDULER_ENABLED;
  return env !== 'false' && env !== '0';
};

const clearScheduledTimer = (): void => {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
};

const scheduleNextRun = (now: Date = new Date()): void => {
  if (!isSchedulerEnabled()) return;
  clearScheduledTimer();
  timer = setTimeout(() => {
    void runScheduledRentTick();
  }, getShopRentTickDelayMs(now));
};

const runScheduledRentTick = async (): Promise<void> => {
  if (!initialized || inFlight) return;

  inFlight = true;
  try {
    const now = new Date();
    const rentResult = await shopService.processRentTick(now);
    console.log(`[ShopRentScheduler] 收租 tick 完成，处理 ${rentResult.processed} 间店铺`);
  } catch (error) {
    console.error('[ShopRentScheduler] 收租 tick 执行失败:', error);
  } finally {
    inFlight = false;
    if (initialized) {
      scheduleNextRun(new Date());
    }
  }
};

export const initializeShopRentScheduler = async (): Promise<boolean> => {
  if (initialized) return !isSchedulerEnabled();
  initialized = true;
  if (!isSchedulerEnabled()) return false;
  scheduleNextRun(new Date());
  return true;
};

export const stopShopRentScheduler = (): void => {
  initialized = false;
  inFlight = false;
  clearScheduledTimer();
};
