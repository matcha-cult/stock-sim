/**
 * 收租系统 — Shop Store。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理店铺概览、租金收取、装修调整、空间扩展的请求状态和响应数据。
 * 2. 不做什么：不做 UI 渲染、不直接操作表单状态。
 *
 * 输入 / 输出：
 * - 输入：刷新店铺、收取租金、装修、扩空间的请求触发。
 * - 输出：shops、config、loading 等 observable 状态。
 *
 * 数据流 / 状态流：
 * 组件触发 fetchShops -> API 请求 -> observable 更新 -> 组件通过 computed 读取 ViewModel。
 *
 * 复用设计说明：
 * - 替代组件内的 useState + useCallback 请求流，用 MobX observable 驱动。
 * - 请求逻辑集中在本模块，组件层只做 UI 交互 + 调用 Store 方法。
 * - 被 RootStore 持有，所有需要店铺数据的组件通过 RootStore 读取。
 *
 * 关键边界条件与坑点：
 * 1. 后台刷新使用静默配置，不弹自动错误 toast。
 * 2. 操作成功后需要联动刷新 AuthStore 中的角色灵石余额。
 * 3. 装修操作有 tick 冷却，需通过 isDecorating 字段判断。
 */

import { makeAutoObservable } from 'mobx';
import {
  getShopOverview,
  getShopConfig,
  collectShopRent,
  collectAllRent,
  adjustShopDecoration,
  expandShopSpace,
  claimInitialShop,
  purchaseShop,
  type ShopDto,
  type ShopOverviewDto,
  type ShopConfigDto,
} from '../services/api/shop';
import { SILENT_API_REQUEST_CONFIG } from '../services/api/requestConfig';
import type { RootStore } from './RootStore';

export class ShopStore {
  private rootStore: RootStore;

  shops: ShopDto[] = [];
  config: ShopConfigDto | null = null;
  totalPendingRent: number = 0;
  loading: boolean = false;
  configLoaded: boolean = false;

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this);
  }

  /**
   * 刷新店铺概览。
   */
  async fetchShops(background = false): Promise<void> {
    if (!background) this.loading = true;
    try {
      const response = await getShopOverview(
        background ? SILENT_API_REQUEST_CONFIG : undefined,
      );
      if (response.success && response.data) {
        this.shops = response.data.shops;
        this.totalPendingRent = response.data.totalPendingRent;
      } else if (!background) {
        this.shops = [];
        this.totalPendingRent = 0;
      }
    } catch {
      if (!background) {
        this.shops = [];
        this.totalPendingRent = 0;
      }
    } finally {
      if (!background) this.loading = false;
    }
  }

  /**
   * 加载店铺配置常量。
   */
  async fetchConfig(): Promise<void> {
    if (this.configLoaded) return;
    try {
      const response = await getShopConfig();
      if (response.success && response.data) {
        this.config = response.data;
        this.configLoaded = true;
      }
    } catch {
      // 配置加载失败不阻塞 UI，使用默认值
    }
  }

  /**
   * 收取指定店铺租金。
   */
  async collectRent(shopId: number): Promise<{ success: boolean; message: string }> {
    try {
      const response = await collectShopRent(shopId);
      if (response.success && response.data?.success) {
        await this.fetchShops();
        await this.rootStore.authStore.refreshCharacter();
        return { success: true, message: response.data.message };
      }
      return { success: false, message: response.message || response.data?.message || '收取失败' };
    } catch {
      return { success: false, message: '网络错误，请稍后重试' };
    }
  }

  /**
   * 一键收取全部租金。
   */
  async collectAllRent(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await collectAllRent();
      if (response.success && response.data?.success) {
        await this.fetchShops();
        await this.rootStore.authStore.refreshCharacter();
        return { success: true, message: response.data.message };
      }
      return { success: false, message: response.message || response.data?.message || '收取失败' };
    } catch {
      return { success: false, message: '网络错误，请稍后重试' };
    }
  }

  /**
   * 调整装修等级。
   */
  async adjustDecoration(shopId: number, targetTier: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await adjustShopDecoration(shopId, targetTier);
      if (response.success && response.data?.success) {
        await this.fetchShops();
        await this.rootStore.authStore.refreshCharacter();
        return { success: true, message: response.data.message };
      }
      return { success: false, message: response.message || response.data?.message || '装修失败' };
    } catch {
      return { success: false, message: '网络错误，请稍后重试' };
    }
  }

  /**
   * 空间阵法扩展。
   */
  async expandSpace(shopId: number): Promise<{ success: boolean; message: string }> {
    try {
      const response = await expandShopSpace(shopId);
      if (response.success && response.data?.success) {
        await this.fetchShops();
        await this.rootStore.authStore.refreshCharacter();
        return { success: true, message: response.data.message };
      }
      return { success: false, message: response.message || response.data?.message || '扩展失败' };
    } catch {
      return { success: false, message: '网络错误，请稍后重试' };
    }
  }

  /**
   * 免费领取初始店铺。
   */
  async claimInitialShop(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await claimInitialShop();
      if (response.success && response.data?.success) {
        await this.fetchShops();
        await this.rootStore.authStore.refreshCharacter();
        return { success: true, message: response.data.message };
      }
      return { success: false, message: response.message || response.data?.message || '领取失败' };
    } catch {
      return { success: false, message: '网络错误，请稍后重试' };
    }
  }

  /**
   * 购买新类型店铺。
   */
  async purchaseShop(shopType: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await purchaseShop(shopType);
      if (response.success && response.data?.success) {
        await this.fetchShops();
        await this.rootStore.authStore.refreshCharacter();
        return { success: true, message: response.data.message };
      }
      return { success: false, message: response.message || response.data?.message || '购买失败' };
    } catch {
      return { success: false, message: '网络错误，请稍后重试' };
    }
  }
}
