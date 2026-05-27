/**
 * 角色ID查询工具（精简版）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：根据用户ID查询角色ID。
 * 2. 不做什么：不使用双层缓存，直接查询数据库。
 *
 * 输入 / 输出：
 * - 输入：用户ID。
 * - 输出：角色ID或 null。
 */
import { query } from '../../config/database.js';

const normalizeUserId = (userId: number): number | null => {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return null;
  return uid;
};

const normalizeCharacterId = (rawId: unknown): number | null => {
  const characterId = Number(rawId);
  if (!Number.isFinite(characterId) || characterId <= 0) return null;
  return characterId;
};

/**
 * 根据用户ID查询角色ID。
 */
export const getCharacterIdByUserId = async (userId: number): Promise<number | null> => {
  const uid = normalizeUserId(userId);
  if (!uid) return null;

  const result = await query('SELECT id FROM characters WHERE user_id = $1 LIMIT 1', [uid]);
  return normalizeCharacterId(result.rows?.[0]?.id);
};

/**
 * 直接查询角色ID（不加锁）。
 */
export const loadCharacterIdByUserIdDirect = async (userId: number): Promise<number | null> => {
  return getCharacterIdByUserId(userId);
};

/**
 * 加锁查询角色ID（FOR UPDATE）。
 */
export const getCharacterIdByUserIdForUpdate = async (userId: number): Promise<number | null> => {
  const uid = normalizeUserId(userId);
  if (!uid) return null;

  const result = await query('SELECT id FROM characters WHERE user_id = $1 LIMIT 1 FOR UPDATE', [uid]);
  return normalizeCharacterId(result.rows?.[0]?.id);
};

/**
 * 预热缓存（精简版无缓存，空实现）。
 */
export const primeCharacterIdByUserIdCache = async (
  _userId: number,
  _characterId: number,
): Promise<void> => {
  // 精简版无缓存，无需实现
};

/**
 * 清除缓存（精简版无缓存，空实现）。
 */
export const invalidateCharacterIdByUserIdCache = async (_userId: number): Promise<void> => {
  // 精简版无缓存，无需实现
};