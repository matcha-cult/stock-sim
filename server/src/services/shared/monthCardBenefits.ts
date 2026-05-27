/**
 * 月卡激活状态批量查询（Stub 实现）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供 `getMonthCardActiveMapByCharacterIds` 接口，返回角色是否激活月卡。
 * 2. 不做什么：不访问数据库，当前始终返回全 false。
 *
 * 复用设计说明：
 * - 当前目标项目无月卡功能，此 stub 用于满足排行服务对 `monthCardActive` 字段的类型需求。
 * - 后续实现月卡时替换为真实 SQL 查询 `month_card_ownership` 表。
 *
 * 关键边界条件与坑点：
 * 1. 输入空数组时直接返回空 Map，不走循环。
 * 2. 所有 key 都必须存在于 Map 中，即使值为 false，避免调用方 `get()` 返回 undefined。
 */

export const getMonthCardActiveMapByCharacterIds = async (
  characterIds: number[],
): Promise<Map<number, boolean>> => {
  const result = new Map<number, boolean>();
  for (const id of characterIds) {
    result.set(id, false);
  }
  return result;
};
