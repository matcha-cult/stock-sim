/**
 * 统一背包系统 — InventoryStore。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理背包物品列表、物品详情、筛选条件、物品操作等状态和请求。
 * 2. 不做什么：不做 UI 渲染、不做 SSE 连接管理。
 *
 * 数据流 / 状态流：
 * 组件触发 action → API 请求 → observable 更新 → 组件通过 observer 响应式刷新。
 *
 * 复用设计说明：
 * - 请求逻辑集中在本模块，组件只做 UI 交互。
 * - 请求去重使用 RequestDedup（in-flight 守卫，无 TTL）。
 * - 被 RootStore 持有，通过 root.authStore 联动灵石余额刷新。
 *
 * 关键边界条件与坑点：
 * 1. 操作成功后需联动刷新 AuthStore 中的角色灵石余额。
 * 2. dedup.enter() 必须在设置 loading 之前调用；dedup.complete() 必须在 finally 中调用。
 * 3. 切换 Tab 后的首次加载走正常防重流程。
 * 4. 分页查询使用服务端分页，避免一次性加载所有物品。
 */

import { makeAutoObservable, runInAction } from 'mobx';
import * as inventoryApi from '../services/api/inventory';
import type {
  InventoryItemDto,
  InventoryItemDetailDto,
  InventoryFilters,
} from '../services/api/inventory';
import { SILENT_API_REQUEST_CONFIG } from '../services/api/requestConfig';
import type { RootStore } from './RootStore';
import { RequestDedup } from './RequestDedup';

export class InventoryStore {
  private rootStore: RootStore;
  private readonly dedup = new RequestDedup();

  // ── 物品列表（分页） ──
  items: InventoryItemDto[] = [];
  total: number = 0;
  page: number = 1;
  pageSize: number = 200;
  loading: boolean = false;

  // ── 选中的物品 ──
  selectedItemId: number | null = null;
  selectedItem: InventoryItemDetailDto | null = null;
  selectedItemLoading: boolean = false;

  // ── 筛选条件 ──
  filters: InventoryFilters = {};

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this);
  }

  // ==================== 物品列表查询 ====================

  /**
   * 查询背包物品（分页）
   */
  async fetchItems(page: number = 1): Promise<void> {
    const key = `inventory-items:${page}`;
    if (!this.dedup.enter(key)) return;

    this.loading = true;
    try {
      const response = await inventoryApi.getInventoryItems(
        page,
        this.pageSize,
        this.filters,
        SILENT_API_REQUEST_CONFIG,
      );

      runInAction(() => {
        if (response.success && response.data) {
          this.items = response.data.items;
          this.total = response.data.total;
          this.page = response.data.page;
        }
      });
    } finally {
      runInAction(() => {
        this.loading = false;
      });
      this.dedup.complete(key);
    }
  }

  /**
   * 设置筛选条件并重新查询
   */
  setFilters(filters: Partial<InventoryFilters>): void {
    this.filters = { ...this.filters, ...filters };
    this.page = 1; // 重置到第一页
    this.fetchItems(1);
  }

  /**
   * 清除筛选条件
   */
  clearFilters(): void {
    this.filters = {};
    this.page = 1;
    this.fetchItems(1);
  }

  // ==================== 物品详情查询 ====================

  /**
   * 选中物品（查询详情）
   */
  async selectItem(itemId: number): Promise<void> {
    if (this.selectedItemId === itemId) return;

    this.selectedItemId = itemId;
    this.selectedItem = null;

    const key = `inventory-item-detail:${itemId}`;
    if (!this.dedup.enter(key)) return;

    this.selectedItemLoading = true;
    try {
      const response = await inventoryApi.getInventoryItemDetail(
        itemId,
        SILENT_API_REQUEST_CONFIG,
      );

      runInAction(() => {
        if (response.success && response.data) {
          this.selectedItem = response.data;
        }
      });
    } finally {
      runInAction(() => {
        this.selectedItemLoading = false;
      });
      this.dedup.complete(key);
    }
  }

  /**
   * 清除选中物品
   */
  clearSelection(): void {
    this.selectedItemId = null;
    this.selectedItem = null;
  }

  // ==================== 物品出售 ====================

  /**
   * 出售物品
   */
  async sellItem(itemId: number, quantity: number): Promise<boolean> {
    const key = `inventory-sell-item:${itemId}`;
    if (!this.dedup.enter(key)) return false;

    try {
      const response = await inventoryApi.sellInventoryItem(itemId, quantity);

      if (response.success && response.data?.success) {
        // 刷新角色灵石余额
        this.rootStore.authStore.refreshCharacter();

        // 刷新背包列表
        await this.fetchItems(this.page);

        // 如果选中了物品，刷新详情
        if (this.selectedItemId === itemId) {
          await this.selectItem(itemId);
        }

        return true;
      }

      return false;
    } finally {
      this.dedup.complete(key);
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 刷新当前页（操作后调用）
   */
  async refresh(): Promise<void> {
    await this.fetchItems(this.page);
  }
}
