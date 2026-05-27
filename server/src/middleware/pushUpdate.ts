/**
 * 角色数据推送工具（精简版）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：预留推送接口，供未来 WebSocket 集成使用。
 * 2. 不做什么：精简版不实现实际推送，空实现。
 *
 * 输入 / 输出：
 * - 输入：用户ID。
 * - 输出：空（不执行任何操作）。
 */

/**
 * 安全推送角色更新（精简版空实现）。
 */
export const safePushCharacterUpdate = async (_userId: number): Promise<void> => {
  // 精简版不实现推送，空实现
};

/**
 * 预留推送调度接口。
 */
export const scheduleSafeCharacterUpdate = (_userId: number): void => {
  // 精简版不实现推送，空实现
};