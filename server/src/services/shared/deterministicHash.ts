/**
 * 确定性随机工具
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：基于种子生成确定性随机索引和选择
 * 2. 不做什么：不处理密码学安全的随机数
 *
 * 数据流 / 状态流：
 * 算法层调用 -> 基于种子生成确定性结果 -> 保证同一输入产出相同结果
 *
 * 关键边界条件与坑点：
 * 1. 使用简单哈希，不适合密码学场景
 * 2. 同一楼层的种子必须固定，保证怪物组合一致
 */

import crypto from 'crypto';

/**
 * 基于字符串种子生成 32 位整数哈希
 */
export const hashSeed = (seed: string): number => {
  const hash = crypto.createHash('md5').update(seed).digest('hex');
  return parseInt(hash.substring(0, 8), 16);
};

/**
 * 基于种子和索引生成确定性随机索引
 *
 * @param seed - 随机种子
 * @param max - 最大值（不包含）
 * @param salt - 盐值（用于区分同一序列的不同位置）
 * @returns 0 到 max-1 之间的整数
 */
export const pickDeterministicIndex = (seed: string, max: number, salt: number = 0): number => {
  if (max <= 0) return 0;
  const combinedSeed = `${seed}-${salt}`;
  const hash = hashSeed(combinedSeed);
  return hash % max;
};

/**
 * 从数组中确定性选择指定数量的元素（不重复）
 *
 * @param items - 候选数组
 * @param count - 选择数量
 * @param seed - 随机种子
 * @returns 选中的元素数组
 */
export const pickDeterministicItems = <T>(items: T[], count: number, seed: string): T[] => {
  if (items.length === 0 || count <= 0) return [];

  const actualCount = Math.min(count, items.length);
  const selected: T[] = [];
  const usedIndices = new Set<number>();

  for (let i = 0; i < actualCount; i++) {
    let index = pickDeterministicIndex(seed, items.length, i);

    // 避免重复选择
    while (usedIndices.has(index)) {
      index = (index + 1) % items.length;
    }

    usedIndices.add(index);
    selected.push(items[index]);
  }

  return selected;
};
