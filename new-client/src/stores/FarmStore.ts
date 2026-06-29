/**
 * 灵田系统 V3 — FarmStore。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理灵田概览、种子袋、灵材仓库、种子商店、种植/收获/出售等状态和请求。
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
 * 4. V3 新增 reclaimed 状态：未开垦玩家需显示开垦界面，不可种植。
 */

import { makeAutoObservable, runInAction, computed } from 'mobx';
import * as farmApi from '../services/api/farm';
import type {
  FarmInfoDto,
  FarmCellDto,
  SeedInventoryItem,
  HarvestInventoryItem,
  HarvestInventoryItemDto,
  FarmStaticConfigDto,
  SeedConfigDto,
  CropConfigDto,
  CropQuality,
  ActivityLogDto,
  PlantTemplateDto,
  CreateTemplateItemRequest,
  ApplyTemplateResult,
} from '../services/api/farm';
import { SILENT_API_REQUEST_CONFIG } from '../services/api/requestConfig';
import type { RootStore } from './RootStore';
import { RequestDedup } from './RequestDedup';

export class FarmStore {
  private rootStore: RootStore;
  private readonly dedup = new RequestDedup();

  // ── 静态配置（只加载一次）──
  staticConfig: FarmStaticConfigDto | null = null;
  staticConfigLoaded: boolean = false;

  // ── 概览（V3） ──
  /** 是否已开垦灵田 */
  reclaimed: boolean = false;
  farmInfo: FarmInfoDto | null = null;
  cells: FarmCellDto[] = [];
  seedBag: SeedInventoryItem[] = [];
  harvestBag: HarvestInventoryItem[] = [];
  /** 灵材仓库分页数据（服务端分页，独立于 overview） */
  harvestInventory: HarvestInventoryItemDto[] = [];
  harvestInventoryTotal: number = 0;
  harvestInventoryPage: number = 1;
  harvestInventoryPageSize: number = 20;
  harvestInventoryLoading: boolean = false;
  serverNow: number = 0;
  serverNowFetchedAt: number = 0;
  overviewLoaded: boolean = false;
  overviewLoading: boolean = false;
  overviewError: string | null = null;
  /** 开垦费用信息（未开垦时使用） */
  reclaimCost: {
    spiritStones: number;
    xiRang: number;
    xiRangPricePerUnit: number;
    totalSpiritStones: number;
  } | null = null;

  // ── 活动日志 ──
  activityLogs: ActivityLogDto[] = [];
  activityLogsTotal: number = 0;
  activityLogsPage: number = 1;
  activityLogsPageSize: number = 20;
  activityLogsLoading: boolean = false;

  // ── 种植模板 ──
  templates: PlantTemplateDto[] = [];
  templatesLoading: boolean = false;
  templatesLoaded: boolean = false;

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this, {
      shopSeeds: computed,
      seedBagWithConfig: computed,
      harvestBagWithConfig: computed,
    });
  }

  // ==================== 静态配置 ====================

  /** 加载静态配置（只调用一次）。使用 configLoaded 标志 + RequestDedup 双重守卫。 */
  async fetchStaticConfig(): Promise<void> {
    if (this.staticConfigLoaded) return;
    if (!this.dedup.enter('farm-config')) return;

    const promise = this.doFetchStaticConfig();
    this.dedup.start('farm-config', promise);
    return promise;
  }

  private async doFetchStaticConfig(): Promise<void> {
    try {
      const response = await farmApi.getFarmConfig();
      runInAction(() => {
        if (response.success && response.data) {
          this.staticConfig = response.data;
          this.staticConfigLoaded = true;
        }
      });
    } catch {
      // 配置加载失败不阻塞 UI
    } finally {
      this.dedup.complete('farm-config');
    }
  }

  // ==================== Computed ====================

  /** 种子商店（根据当前等阶过滤静态配置） */
  get shopSeeds(): SeedConfigDto[] {
    if (!this.staticConfig) return [];
    const farmTier = this.farmInfo?.farmTier ?? 1;
    return this.staticConfig.seeds
      .filter((s) => s.requiredTier <= farmTier && s.buyPrice > 0);
  }

  /** 种子袋（join 静态配置，用于 UI 展示） */
  get seedBagWithConfig(): Array<SeedInventoryItem & SeedConfigDto> {
    if (!this.staticConfig) return [];
    const seedMap = new Map(this.staticConfig.seeds.map((s) => [s.itemId, s]));
    return this.seedBag
      .map((item) => {
        const config = seedMap.get(item.itemId);
        if (!config) return null;
        return { ...item, ...config };
      })
      .filter((s): s is SeedInventoryItem & SeedConfigDto => s !== null)
      .sort((a, b) => a.requiredTier - b.requiredTier || a.buyPrice - b.buyPrice);
  }

  /** 灵材仓库（服务端分页，后端已 join 作物配置，直接返回） */
  get harvestBagWithConfig(): HarvestInventoryItemDto[] {
    return this.harvestInventory;
  }

  // ==================== 概览 ====================

  async fetchOverview(background = false): Promise<void> {
    if (!this.dedup.enter('farm-overview', background)) return;

    if (!background) {
      this.overviewLoading = true;
      this.overviewError = null;
    }

    // 同步构造 promise 并注册 in-flight，确保 StrictMode 双 mount 第二次被拦截
    const promise = this.doFetchOverview(background);
    this.dedup.start('farm-overview', promise);
    return promise;
  }

  private async doFetchOverview(background: boolean): Promise<void> {
    try {
      const response = await farmApi.getFarmOverview(
        background ? SILENT_API_REQUEST_CONFIG : undefined,
      );
      runInAction(() => {
        if (response.success && response.data) {
          this.reclaimed = response.data.reclaimed;
          this.farmInfo = response.data.farmInfo;
          this.cells = response.data.cells;
          this.seedBag = response.data.seedBag;
          this.harvestBag = response.data.harvestBag;
          this.serverNow = response.data.serverNow;
          this.serverNowFetchedAt = Date.now();
          this.reclaimCost = response.data.reclaimCost ?? null;
          this.overviewLoaded = true;
          this.overviewError = null;
        } else if (!background) {
          this.overviewError = response.message ?? '加载灵田数据失败';
        }
      });
    } catch (e: unknown) {
      runInAction(() => {
        if (!background) {
          this.overviewError = e instanceof Error ? e.message : '加载灵田数据失败';
        }
      });
    } finally {
      runInAction(() => {
        if (!background) {
          this.overviewLoading = false;
        }
      });
      this.dedup.complete('farm-overview');
    }
  }

  // ==================== 灵材仓库分页 ====================

  /** 获取灵材仓库分页数据 */
  async fetchHarvestInventory(page: number = 1): Promise<void> {
    const key = `farm-harvest-inv:${page}`;
    if (!this.dedup.enter(key)) return;

    this.harvestInventoryLoading = true;
    try {
      const response = await farmApi.getHarvestInventory(page, this.harvestInventoryPageSize);
      runInAction(() => {
        if (response.success && response.data) {
          this.harvestInventory = response.data.items;
          this.harvestInventoryTotal = response.data.total;
          this.harvestInventoryPage = response.data.page;
        }
      });
    } finally {
      runInAction(() => {
        this.harvestInventoryLoading = false;
      });
      this.dedup.complete(key);
    }
  }

  // ==================== 种子商店 ====================

  async buySeed(itemId: string, quantity: number): Promise<boolean> {
    if (!this.dedup.enter('farm-buy-seed')) return false;
    try {
      const response = await farmApi.buySeed(itemId, quantity);
      if (response.success && response.data?.success) {
        await this.fetchOverview(true);
        this.rootStore.authStore.refreshCharacter();
        return true;
      }
      return false;
    } finally {
      this.dedup.complete('farm-buy-seed');
    }
  }

  async sellSeed(itemId: string, quantity: number, mutationType: string | null): Promise<boolean> {
    if (!this.dedup.enter('farm-sell-seed')) return false;
    try {
      const response = await farmApi.sellSeed(itemId, quantity, mutationType);
      if (response.success && response.data?.success) {
        await this.fetchOverview(true);
        this.rootStore.authStore.refreshCharacter();
        return true;
      }
      return false;
    } finally {
      this.dedup.complete('farm-sell-seed');
    }
  }

  // ==================== 种植 & 收获 ====================

  async plant(row: number, col: number, seedId: number): Promise<farmApi.PlantResult | null> {
    if (!this.dedup.enter('farm-plant')) return null;
    try {
      const response = await farmApi.plantCrop(row, col, seedId);
      if (!response.success || !response.data) return null;
      if (response.data.success) {
        // 局部更新：用返回的格子数据替换 cells 中对应的格子
        if (response.data.cell) {
          const cellIndex = this.cells.findIndex((c) => c.row === row && c.col === col);
          if (cellIndex !== -1) {
            this.cells[cellIndex] = response.data.cell;
          }
        }
        // 更新种子袋：扣减使用的种子数量（通过 id 查找）
        const seedIndex = this.seedBag.findIndex((s) => s.id === seedId);
        if (seedIndex !== -1 && this.seedBag[seedIndex].quantity > 0) {
          this.seedBag[seedIndex].quantity -= 1;
          if (this.seedBag[seedIndex].quantity === 0) {
            this.seedBag.splice(seedIndex, 1);
          }
        }
      }
      // 透传 response.data（含 success + message），让调用方按 success 分支展示提示
      return response.data;
    } finally {
      this.dedup.complete('farm-plant');
    }
  }

  async harvest(row: number, col: number): Promise<farmApi.HarvestResult | null> {
    if (!this.dedup.enter('farm-harvest')) return null;
    try {
      const response = await farmApi.harvestCrop(row, col);
      if (!response.success || !response.data) return null;
      if (response.data.success) {
        await this.fetchOverview(true);
      }
      return response.data;
    } finally {
      this.dedup.complete('farm-harvest');
    }
  }

  /** 一键收获所有成熟作物 */
  async harvestAll(): Promise<number> {
    if (!this.dedup.enter('farm-harvest-all')) return 0;
    try {
      const response = await farmApi.harvestAll();
      if (response.success && response.data?.success) {
        await this.fetchOverview(true);
        return response.data.harvestedCount;
      }
      return 0;
    } finally {
      this.dedup.complete('farm-harvest-all');
    }
  }

  /** 铲除作物（萌芽阶段铲除会撤销已判定的杂交种子） */
  async remove(row: number, col: number): Promise<(farmApi.ActionResult & { hybridRevoked?: boolean }) | null> {
    if (!this.dedup.enter('farm-remove')) return null;
    try {
      const response = await farmApi.removeCrop(row, col);
      if (!response.success || !response.data) return null;
      if (response.data.success) {
        await this.fetchOverview(true);
      }
      return response.data;
    } finally {
      this.dedup.complete('farm-remove');
    }
  }

  /** 移植作物到另一个空格子（只能移植未成熟的作物） */
  async transplant(
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number,
  ): Promise<farmApi.TransplantResult | null> {
    if (!this.dedup.enter('farm-transplant')) return null;
    try {
      const response = await farmApi.transplantCrop(fromRow, fromCol, toRow, toCol);
      if (!response.success || !response.data) return null;
      if (response.data.success) {
        // 局部更新：用返回的格子数据替换 cells 中对应的格子
        if (response.data.fromCell) {
          const fromIndex = this.cells.findIndex((c) => c.row === fromRow && c.col === fromCol);
          if (fromIndex !== -1) {
            this.cells[fromIndex] = response.data.fromCell;
          }
        }
        if (response.data.toCell) {
          const toIndex = this.cells.findIndex((c) => c.row === toRow && c.col === toCol);
          if (toIndex !== -1) {
            this.cells[toIndex] = response.data.toCell;
          }
        }
      }
      return response.data;
    } finally {
      this.dedup.complete('farm-transplant');
    }
  }

  async sellHarvest(cropId: string, quality: CropQuality, tradeUnits: number): Promise<boolean> {
    if (!this.dedup.enter('farm-sell-harvest')) return false;
    try {
      const response = await farmApi.sellHarvest(cropId, quality, tradeUnits);
      if (response.success && response.data?.success) {
        await this.fetchHarvestInventory(this.harvestInventoryPage);
        this.rootStore.authStore.refreshCharacter();
        return true;
      }
      return false;
    } finally {
      this.dedup.complete('farm-sell-harvest');
    }
  }

  async sellAllHarvest(): Promise<number> {
    if (!this.dedup.enter('farm-sell-all-harvest')) return 0;
    try {
      const response = await farmApi.sellAllHarvest();
      if (response.success && response.data?.success) {
        await this.fetchHarvestInventory(1);
        this.rootStore.authStore.refreshCharacter();
        return response.data.totalEarn;
      }
      return 0;
    } finally {
      this.dedup.complete('farm-sell-all-harvest');
    }
  }

  // ==================== V3：开垦 / 扩展 / 突破 ====================

  /** 开垦灵田（首次 16 格） */
  async reclaimFarm(): Promise<boolean> {
    if (!this.dedup.enter('farm-reclaim')) return false;
    try {
      const response = await farmApi.reclaimFarm();
      if (response.success && response.data?.success) {
        await this.fetchOverview(true);
        this.rootStore.authStore.refreshCharacter();
        return true;
      }
      return false;
    } finally {
      this.dedup.complete('farm-reclaim');
    }
  }

  /** 扩展单个格子 */
  async expandCell(row: number, col: number): Promise<boolean> {
    if (!this.dedup.enter('farm-expand-cell')) return false;
    try {
      const response = await farmApi.expandCell(row, col);
      if (response.success && response.data?.success) {
        await this.fetchOverview(true);
        this.rootStore.authStore.refreshCharacter();
        return true;
      }
      return false;
    } finally {
      this.dedup.complete('farm-expand-cell');
    }
  }

  /** 等阶突破（黄→玄→地→天） */
  async upgradeTier(): Promise<boolean> {
    if (!this.dedup.enter('farm-upgrade-tier')) return false;
    try {
      const response = await farmApi.upgradeTier();
      if (response.success && response.data?.success) {
        await this.fetchOverview(true);
        this.rootStore.authStore.refreshCharacter();
        return true;
      }
      return false;
    } finally {
      this.dedup.complete('farm-upgrade-tier');
    }
  }

  // ==================== 活动日志 ====================

  /** 获取活动日志（分页） */
  async fetchLog(page: number = 1): Promise<void> {
    const key = `farm-log-${page}`;
    if (!this.dedup.enter(key)) return;
    this.activityLogsLoading = true;
    const promise = this.doFetchLog(page);
    this.dedup.start(key, promise);
    return promise;
  }

  private async doFetchLog(page: number): Promise<void> {
    try {
      const response = await farmApi.getFarmLog(page, this.activityLogsPageSize, SILENT_API_REQUEST_CONFIG);
      runInAction(() => {
        if (response.success && response.data) {
          this.activityLogs = response.data.logs;
          this.activityLogsTotal = response.data.total;
          this.activityLogsPage = page;
        }
      });
    } catch {
      // 静默失败
    } finally {
      runInAction(() => {
        this.activityLogsLoading = false;
      });
      this.dedup.complete(`farm-log-${page}`);
    }
  }

  // ==================== 种植模板 ====================

  /** 获取模板列表 */
  async fetchTemplates(): Promise<void> {
    if (!this.dedup.enter('farm-templates')) return;
    this.templatesLoading = true;
    const promise = this.doFetchTemplates();
    this.dedup.start('farm-templates', promise);
    return promise;
  }

  private async doFetchTemplates(): Promise<void> {
    try {
      const response = await farmApi.getPlantTemplates(SILENT_API_REQUEST_CONFIG);
      runInAction(() => {
        if (response.success && response.data) {
          this.templates = response.data.templates;
          this.templatesLoaded = true;
        }
      });
    } catch {
      // 静默失败
    } finally {
      runInAction(() => {
        this.templatesLoading = false;
      });
      this.dedup.complete('farm-templates');
    }
  }

  /** 创建模板 */
  async createTemplate(
    name: string,
    description: string | null,
    items: CreateTemplateItemRequest[],
  ): Promise<boolean> {
    if (!this.dedup.enter('farm-create-template')) return false;
    try {
      const response = await farmApi.createPlantTemplate(name, description, items);
      if (response.success && response.data?.success) {
        await this.fetchTemplates();
        return true;
      }
      return false;
    } finally {
      this.dedup.complete('farm-create-template');
    }
  }

  /** 删除模板 */
  async deleteTemplate(templateId: number): Promise<boolean> {
    if (!this.dedup.enter('farm-delete-template')) return false;
    try {
      const response = await farmApi.deletePlantTemplate(templateId);
      if (response.success && response.data?.success) {
        runInAction(() => {
          this.templates = this.templates.filter((t) => t.id !== templateId);
        });
        return true;
      }
      return false;
    } finally {
      this.dedup.complete('farm-delete-template');
    }
  }

  /** 更新模板 */
  async updateTemplate(
    templateId: number,
    name: string,
    description: string | null,
    items: CreateTemplateItemRequest[],
  ): Promise<boolean> {
    if (!this.dedup.enter('farm-update-template')) return false;
    try {
      const response = await farmApi.updatePlantTemplate(templateId, name, description, items);
      if (response.success && response.data?.success) {
        await this.fetchTemplates();
        return true;
      }
      return false;
    } finally {
      this.dedup.complete('farm-update-template');
    }
  }

  /** 应用模板种植（模板固定 4×4，从 (0,0) 开始） */
  async applyTemplate(
    templateId: number,
  ): Promise<ApplyTemplateResult | null> {
    if (!this.dedup.enter('farm-apply-template')) return null;
    try {
      const response = await farmApi.applyPlantTemplate(templateId, 0, 0);
      if (response.success && response.data) {
        if (response.data.success) {
          await this.fetchOverview(true);
          this.rootStore.authStore.refreshCharacter();
        }
        return response.data;
      }
      return null;
    } finally {
      this.dedup.complete('farm-apply-template');
    }
  }
}
