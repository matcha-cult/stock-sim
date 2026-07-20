/**
 * 统一背包系统 — API 封装。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：封装背包相关 HTTP 请求，定义 DTO 类型。
 * 2. 不做什么：不处理业务逻辑、不管理状态。
 *
 * 数据流 / 状态流：
 * Store 调用 API → 返回 { success, data } → Store 更新 observable。
 *
 * 复用设计说明：
 * - DTO 类型与后端 unifiedInventoryService.ts 保持一致，避免重复定义。
 * - 提供分页查询、详情查询、物品出售等接口。
 *
 * 关键边界条件与坑点：
 * 1. 分页查询使用服务端分页，避免一次性加载所有物品。
 * 2. 物品出售需要校验物品是否可出售（sellable）。
 */
import type { AxiosRequestConfig } from 'axios';
import api from './core.js';

// ==================== DTO 类型定义 ====================

/** 背包物品 DTO（列表用） */
export interface InventoryItemDto {
  id: number;
  characterId: number;
  itemKey: string;
  itemName: string;
  category: string;
  quantity: number;
  mutationType: string | null;
  generation: number | null;
  quality: string | null;
  durability: number | null;
  level: number | null;
  customAttributes: Record<string, any> | null;
  icon: string | null;
  rarity: string | null;
  maxStack: number;
  createdAt: number;
  updatedAt: number;
}

/** 背包物品详情 DTO（详情用） */
export interface InventoryItemDetailDto extends InventoryItemDto {
  subcategory: string | null;
  description: string | null;
  sellable: boolean;
  sellPrice: number;
  buyable: boolean;
  buyPrice: number;
  attributes: Record<string, any>;
}

/** 背包物品分页结果 */
export interface InventoryPageResult {
  items: InventoryItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** 物品筛选条件 */
export interface InventoryFilters {
  category?: string;
  subcategory?: string;
  quality?: string;
  rarity?: string;
  keyword?: string;
  sort?: string;
}

/** 出售物品请求参数 */
export interface SellItemParams {
  quantity: number;
}

/** 出售物品响应 */
export interface SellItemResult {
  success: boolean;
  message: string;
  totalEarn: number;
}

// ==================== API 接口 ====================

/**
 * 查询背包物品（分页）
 *
 * @param page 页码（从 1 开始）
 * @param pageSize 每页数量（最大 100）
 * @param filters 筛选条件
 * @param config Axios 配置
 */
export const getInventoryItems = (
  page: number = 1,
  pageSize: number = 20,
  filters?: InventoryFilters,
  config?: AxiosRequestConfig,
) =>
  api.get<InventoryPageResult>('/api/inventory/items', {
    params: {
      page,
      pageSize,
      ...filters,
    },
    ...config,
  });

/**
 * 查询物品详情
 *
 * @param itemId 物品 ID
 * @param config Axios 配置
 */
export const getInventoryItemDetail = (
  itemId: number,
  config?: AxiosRequestConfig,
) =>
  api.get<InventoryItemDetailDto>(`/api/inventory/items/${itemId}`, config);

/**
 * 出售物品
 *
 * @param itemId 物品 ID
 * @param quantity 出售数量
 * @param config Axios 配置
 */
export const sellInventoryItem = (
  itemId: number,
  quantity: number,
  config?: AxiosRequestConfig,
) =>
  api.post<SellItemResult>(`/api/inventory/items/${itemId}/sell`, {
    quantity,
  }, config);
