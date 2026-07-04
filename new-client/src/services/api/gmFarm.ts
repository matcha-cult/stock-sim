/**
 * GM 灵田查看接口封装。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：封装 GM 按角色 ID 或昵称查询指定玩家灵田总览、活动日志的 API。
 * 2. 不做什么：不处理业务逻辑、不管理状态。
 *
 * 数据流 / 状态流：
 * 组件调用 → 返回 ApiResponse → 组件更新本地状态。
 *
 * 复用设计说明：
 * - DTO 类型直接复用 services/api/farm.ts 中已定义的类型，避免重复定义。
 * - API 请求复用 core.ts 中统一的 axios 实例。
 * - 查询参数支持 characterId 或 nickname（二选一，characterId 优先）。
 *
 * 关键边界条件与坑点：
 * 1. nickname 走后端 ILIKE 模糊匹配（取 id 最小的一个），运维人员要精确查时建议使用角色 ID。
 */
import type { AxiosRequestConfig } from 'axios';
import api from './core.js';
import type {
  FarmOverviewDto,
  FarmStaticConfigDto,
  ActivityLogDto,
} from './farm.js';

/** GM 灵田查询参数（characterId 或 nickname 二选一） */
export interface GmFarmLookupParams {
  characterId?: number;
  nickname?: string;
}

/** GM 灵田总览响应 */
export interface GmFarmOverviewResponse {
  characterId: number;
  nickname: string;
  overview: FarmOverviewDto;
  staticConfig: FarmStaticConfigDto;
}

/** GM 灵田活动日志响应 */
export interface GmFarmLogResponse {
  characterId: number;
  nickname: string;
  logs: ActivityLogDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** GM 查询指定玩家的灵田总览 */
export const gmGetFarmOverview = (
  params: GmFarmLookupParams,
  config?: AxiosRequestConfig,
) => api.get<GmFarmOverviewResponse>('/api/gm/farm/overview', {
  params,
  ...config,
});

/** GM 查询指定玩家的灵田活动日志（分页） */
export const gmGetFarmLog = (
  params: GmFarmLookupParams,
  page: number = 1,
  pageSize: number = 20,
  config?: AxiosRequestConfig,
) => api.get<GmFarmLogResponse>('/api/gm/farm/log', {
  params: { ...params, page, pageSize },
  ...config,
});
