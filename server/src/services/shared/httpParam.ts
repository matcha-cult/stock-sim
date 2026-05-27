/**
 * 路由参数解析工具
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：统一 Express `params/query` 的单值提取、非空文本裁剪与有限数字解析，减少路由层重复模板代码。
 * 2. 做什么：把“数组只取首项”的约定收口到一个模块，避免不同路由各自处理导致规则漂移。
 * 3. 不做什么：不负责抛业务异常，不决定字段必填/选填策略，调用方仍需按接口语义自行校验。
 *
 * 输入/输出：
 * - 输入：Express `params/query` 的原始值，或经路由层透传的基础字符串/数字。
 * - 输出：规范化后的单值字符串、非空文本、正整数或有限数字。
 *
 * 数据流/状态流：
 * 路由层传入原始参数 -> 本模块做轻量归一化 -> 路由层基于结果决定是否抛出 `BusinessError` 或继续调用 service。
 *
 * 关键边界条件与坑点：
 * 1. `parseNonEmptyText` 会先 `trim()`，所以只包含空白字符的输入会被视为无效文本。
 * 2. `parseFiniteNumber` 只保证是有限数字，不额外限制正负和是否整数；需要范围约束时必须由调用方继续校验。
 */

export const getSingleParam = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
};

export const getSingleQueryValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : '';
  }
  return '';
};

export const parsePositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

export const parseNonEmptyText = (value: string | string[] | undefined | null): string | null => {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (typeof normalized !== 'string') return null;
  const trimmed = normalized.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const parseFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  const normalized = Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
  if (typeof normalized !== 'string') return undefined;
  if (!normalized.trim()) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};
