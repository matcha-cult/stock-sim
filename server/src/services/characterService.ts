/**
 * 角色服务（精简版）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：角色查询、创建、灵石余额管理。
 * 2. 不做什么：不处理境界、地图、任务、成就、在线战斗等游戏功能。
 *
 * 输入 / 输出：
 * - 输入：用户ID、昵称、性别。
 * - 输出：角色基本信息，包含灵石余额。
 *
 * 数据流 / 状态流：
 * 认证服务 -> 本服务创建/查询角色 -> 数据库写入 -> 返回角色信息。
 *
 * 复用设计说明：
 * - 仅保留股市交易所需的角色属性，移除所有游戏功能依赖。
 * - 默认灵石通过环境变量 DEFAULT_REGISTRATION_SPIRIT_STONES 配置，未设置时回退 10000。
 *
 * 关键边界条件与坑点：
 * 1. 每个用户只能创建一个角色，创建前必须检查是否已存在。
 * 2. 昵称不能为空且长度有限制（最长50字符）。
 */
import { query } from '../config/database.js';
import { shopService } from './shop/shopService.js';
import {
  recordSpiritStones,
  type SpiritStonesLedgerBizType,
} from './ledgerService.js';

const DEFAULT_REGISTRATION_SPIRIT_STONES = parseInt(
  process.env.DEFAULT_REGISTRATION_SPIRIT_STONES ?? '10000',
  10,
);

export interface Character {
  id: number;
  user_id: number;
  nickname: string;
  gender: string;
  title: string | null;
  spirit_stones: bigint;
  silver: bigint;
  created_at: Date;
  updated_at: Date;
}

export interface CharacterResult {
  success: boolean;
  message: string;
  data?: {
    character: Character | null;
    hasCharacter: boolean;
  };
}

/**
 * 昵称校验。
 * 只做基本校验：非空、长度限制。
 */
const validateNickname = (nickname: string): { success: boolean; nickname: string; message?: string } => {
  const normalized = nickname.trim();
  if (!normalized) {
    return { success: false, nickname: '', message: '昵称不能为空' };
  }
  if (normalized.length > 50) {
    return { success: false, nickname: '', message: '昵称最长50字符' };
  }
  return { success: true, nickname: normalized };
};

/**
 * 检查用户是否有角色。
 */
export const checkCharacter = async (userId: number): Promise<CharacterResult> => {
  const result = await query(
    `SELECT c.id, c.user_id, c.nickname, c.gender, c.title, c.spirit_stones, c.silver, c.created_at, c.updated_at,
            (EXISTS (
              SELECT 1 FROM month_card_ownership m
              WHERE m.character_id = c.id AND m.status = 'active' AND m.expires_at > NOW()
            )) AS month_card_active
     FROM characters c WHERE c.user_id = $1`,
    [userId],
  );

  if (result.rows.length > 0) {
    const row = result.rows[0];
    return {
      success: true,
      message: '已有角色',
      data: {
        character: {
          id: Number(row.id),
          user_id: Number(row.user_id),
          nickname: String(row.nickname),
          gender: String(row.gender),
          title: row.title ? String(row.title) : null,
          spirit_stones: BigInt(row.spirit_stones ?? 0),
          silver: BigInt(row.silver ?? 0),
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
        hasCharacter: true,
      },
    };
  }

  return {
    success: true,
    message: '未创建角色',
    data: {
      character: null,
      hasCharacter: false,
    },
  };
};

/**
 * 创建角色。
 * 初始灵石通过环境变量 DEFAULT_REGISTRATION_SPIRIT_STONES 配置，未设置时回退 10000。
 */
export const createCharacter = async (
  userId: number,
  nickname: string,
  gender: 'male' | 'female'
): Promise<CharacterResult> => {
  // 检查是否已有角色
  const existCheck = await query('SELECT id FROM characters WHERE user_id = $1', [userId]);
  if (existCheck.rows.length > 0) {
    return { success: false, message: '已存在角色，无法重复创建' };
  }

  // 昵称校验
  const nicknameValidation = validateNickname(nickname);
  if (!nicknameValidation.success) {
    return { success: false, message: nicknameValidation.message! };
  }

  // 创建角色（灵石从环境变量读取）
  const insertSQL = `
    INSERT INTO characters (
      user_id, nickname, gender, title,
      spirit_stones, silver, updated_at
    ) VALUES (
      $1, $2, $3, '散修',
      $4, 0, CURRENT_TIMESTAMP
    ) RETURNING id, user_id, nickname, gender, title, spirit_stones, silver, created_at, updated_at
  `;

  const result = await query(insertSQL, [userId, nicknameValidation.nickname, gender, DEFAULT_REGISTRATION_SPIRIT_STONES]);
  const row = result.rows[0];

  const characterId = Number(row.id);

  // 为新角色创建初始店铺（黄级·书籍）— 临时屏蔽
  // await shopService.createInitialShopForCharacter(characterId);

  return {
    success: true,
    message: '角色创建成功',
    data: {
      character: {
        id: Number(row.id),
        user_id: Number(row.user_id),
        nickname: String(row.nickname),
        gender: String(row.gender),
        title: row.title ? String(row.title) : null,
        spirit_stones: BigInt(row.spirit_stones),
        silver: BigInt(row.silver),
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      hasCharacter: true,
    },
  };
};

/**
 * 获取角色信息。
 */
export const getCharacter = async (userId: number): Promise<CharacterResult> => {
  return checkCharacter(userId);
};

type LedgerMeta = {
  bizType: SpiritStonesLedgerBizType;
  bizId?: string;
  counterparty?: number;
  memo?: string;
};

/**
 * 更新角色灵石余额（供股市服务调用）。
 */
export const updateCharacterSpiritStones = async (
  characterId: number,
  delta: bigint,
  ledgerMeta?: LedgerMeta,
): Promise<{ success: boolean; message: string; newBalance?: bigint }> => {
  const result = await query(
    `
    UPDATE characters
    SET spirit_stones = spirit_stones + $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2 AND spirit_stones + $1 >= 0
    RETURNING spirit_stones
    `,
    [delta.toString(), characterId],
  );

  if (result.rowCount === 0) {
    return { success: false, message: '灵石不足或角色不存在' };
  }

  const newBalance = BigInt(result.rows[0].spirit_stones);
  if (ledgerMeta) {
    await recordSpiritStones({
      characterId,
      amount: delta,
      balanceAfter: newBalance,
      bizType: ledgerMeta.bizType,
      bizId: ledgerMeta.bizId,
      counterparty: ledgerMeta.counterparty,
      memo: ledgerMeta.memo,
    });
  }

  return {
    success: true,
    message: '灵石更新成功',
    newBalance,
  };
};