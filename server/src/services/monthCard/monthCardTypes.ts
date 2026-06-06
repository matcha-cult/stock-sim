/**
 * 月卡共享类型定义。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：集中定义月卡系统所有 DTO 类型、接口请求/响应结构，避免在多个文件中重复定义。
 * 2. 不做什么：不包含业务逻辑、不持有数据库连接。
 *
 * 复用设计说明：
 * - 被 monthCardService、路由层、前端 API 层共同引用。
 * - 所有接口层 DTO 保持命名一致（XxxDto），便于前后端类型对齐。
 *
 * 关键边界条件与坑点：
 * 1. expiresAt 统一使用毫秒时间戳，前端可直接用 new Date(expiresAt)。
 * 2. configKey 固定为 "default"，二阶段扩展多档位时新增配置记录。
 */

// ========== 配置 ==========

export interface MonthCardConfigDto {
  configKey: string;
  durationDays: number;
  dailyRewardSpiritStones: number;
  scratchBonusBps: number;
  shopRentBonusBps: number;
  description: string;
}

// ========== 状态查询 ==========

export interface MonthCardStatusDto {
  isActive: boolean;
  expiresAt: number | null;
  daysRemaining: number | null;
  todayClaimed: boolean;
  config: MonthCardConfigDto | null;
}

// ========== GM 发放 ==========

export interface GrantResultDto {
  success: boolean;
  message: string;
  expiresAt: number | null;
  daysRemaining: number | null;
  isNewGrant: boolean;
}

// ========== GM 回收 ==========

export interface RevokeResultDto {
  success: boolean;
  message: string;
  wasActive: boolean;
}

// ========== 每日领取 ==========

export interface ClaimResultDto {
  success: boolean;
  message: string;
  rewardSpiritStones: number;
  balanceAfter: number;
}
