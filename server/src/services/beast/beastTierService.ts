/**
 * 灵兽品阶提升与化形服务
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：处理品阶提升和化形——检查条件、消耗物品、更新状态。
 * 2. 不做什么：不处理 HTTP 参数。
 *
 * 关键边界条件与坑点：
 * 1) 升阶后 cultivation_count 重置为 0。
 * 2) 化形是地阶/天阶的前置条件，化形时更新 template_id 为血脉模板。
 * 3) 升阶丹不足时，支持自动购买（需开启 autoBuyPill 开关）。
 */
import { query, withTransaction } from '../../config/database.js';
import { getBeastDefinitionById, getBloodlineById } from './beastConfigLoader.js';
import {
  checkTierUpConditions,
  checkTransformConditions,
  TIER_UP_REQUIREMENTS,
  TRANSFORM_REQUIREMENT,
} from './shared/beastTierRules.js';
import { loadSingleBeastRow, type BeastRow } from './shared/beastView.js';
import { getItemQuantity, addItem, removeItem } from '../inventory/unifiedInventoryService.js';
import { consumeSpiritStones, addSpiritStones } from '../inventory/shared/consume.js';
import { getItemDefinition } from '../inventory/itemConfigLoader.js';

interface ServiceResult<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
}

// ==================== 查询片段 ====================

const BEAST_LOCK_SELECT = `
  SELECT id, character_id, beast_def_id, bloodline_id, level::bigint AS level, progress_exp::bigint AS progress_exp,
         template_id, aptitude_bonus,
         cultivation_count, beast_tier, is_transformed, is_active,
         nickname, description, avatar, obtained_from, obtained_ref_id,
         EXTRACT(EPOCH FROM created_at)::bigint AS created_at,
         EXTRACT(EPOCH FROM updated_at)::bigint AS updated_at
  FROM character_beast
`;

// ==================== 品阶提升 ====================

export interface TierUpResultDto {
  previousTier: string;
  newTier: string;
  cultivationCountReset: boolean;
  autoBoughtPill?: boolean;  // 是否自动购买了升阶丹
  pillCost?: number;         // 升阶丹购买花费
  spiritStonesCost?: number; // 升阶灵石花费
}

/**
 * 品阶提升。
 * @param autoBuyPill - 背包无升阶丹时是否自动购买
 */
export const tierUp = async (
  characterId: number,
  beastId: number,
  autoBuyPill: boolean = false,
): Promise<ServiceResult<TierUpResultDto>> => {
  return withTransaction(async () => {
    const beastResult = await query<BeastRow>(
      `${BEAST_LOCK_SELECT}
       WHERE id = $1 AND character_id = $2
       FOR UPDATE`,
      [beastId, characterId],
    );
    const beastRow = beastResult.rows[0];
    if (!beastRow) {
      return { success: false, message: '灵兽不存在' };
    }

    const check = checkTierUpConditions({
      level: Number(beastRow.level),
      beastTier: beastRow.beast_tier,
    });

    if (!check.canTierUp || !check.requirement || !check.nextTier) {
      return { success: false, message: check.failedReasons.join('；') };
    }

    const requirement = check.requirement;
    const pillItemKey = requirement.consumeItem;
    const pillCount = requirement.consumeItemCount;
    const spiritStonesCost = requirement.consumeSpiritStones;

    // 检查背包中的升阶丹数量
    const currentPillCount = await getItemQuantity(characterId, pillItemKey);
    let autoBoughtPill = false;
    let pillCost = 0;

    if (currentPillCount < pillCount) {
      // 升阶丹不足
      if (!autoBuyPill) {
        return { success: false, message: `升阶丹不足（需要 ${pillCount} 个，当前 ${currentPillCount} 个）` };
      }

      // 自动购买升阶丹
      const pillDef = getItemDefinition(pillItemKey);
      console.log('[tierUp] 获取升阶丹定义，pillItemKey:', pillItemKey, 'pillDef:', pillDef);
      if (!pillDef || !pillDef.buyable) {
        return { success: false, message: `升阶丹不可购买（itemKey: ${pillItemKey}, buyable: ${pillDef?.buyable}）` };
      }

      const buyCount = pillCount - currentPillCount;
      pillCost = pillDef.buyPrice * buyCount;

      // 扣除购买升阶丹的灵石
      const buyPillResult = await consumeSpiritStones(characterId, BigInt(pillCost), {
        bizType: 'tier_up_auto_buy_pill',
        bizId: String(beastId),
        memo: `升阶自动购买${pillDef.name}×${buyCount}`,
      });

      if (!buyPillResult.success) {
        return { success: false, message: `灵石不足，无法购买升阶丹（需要 ${pillCost.toLocaleString()} 灵石）` };
      }

      // 添加升阶丹到背包
      console.log('[tierUp] 添加升阶丹到背包，itemKey:', pillItemKey, 'quantity:', buyCount);
      const addPillResult = await addItem({
        characterId,
        itemKey: pillItemKey,
        quantity: buyCount,
        operationType: 'acquire',
        bizType: 'tier_up_auto_buy_pill',
        bizId: String(beastId),
        memo: `升阶自动购买${pillDef.name}`,
      });

      console.log('[tierUp] 添加升阶丹结果:', addPillResult);

      if (!addPillResult.success) {
        // 购买失败，回滚灵石
        await addSpiritStones(characterId, BigInt(pillCost), {
          bizType: 'tier_up_auto_buy_pill_refund',
          bizId: String(beastId),
          memo: `升阶自动购买${pillDef.name}失败退款`,
        });
        return { success: false, message: `购买升阶丹失败：${addPillResult.message ?? '未知错误'}` };
      }

      autoBoughtPill = true;
    }

    // 消耗升阶丹
    const removePillResult = await removeItem({
      characterId,
      itemKey: pillItemKey,
      quantity: pillCount,
      operationType: 'consume',
      bizType: 'tier_up',
      bizId: String(beastId),
      memo: `升阶消耗${pillItemKey}`,
    });

    if (!removePillResult.success) {
      return { success: false, message: '消耗升阶丹失败' };
    }

    // 消耗升阶灵石
    const consumeStonesResult = await consumeSpiritStones(characterId, BigInt(spiritStonesCost), {
      bizType: 'tier_up',
      bizId: String(beastId),
      memo: `升阶至${check.nextTier}消耗灵石`,
    });

    if (!consumeStonesResult.success) {
      return { success: false, message: `灵石不足（需要 ${spiritStonesCost.toLocaleString()} 灵石）` };
    }

    // 更新品阶，重置培育次数
    await query(
      `UPDATE character_beast
       SET beast_tier = $1, cultivation_count = 0, updated_at = NOW()
       WHERE id = $2`,
      [check.nextTier, beastId],
    );

    return {
      success: true,
      data: {
        previousTier: beastRow.beast_tier,
        newTier: check.nextTier,
        cultivationCountReset: true,
        autoBoughtPill,
        pillCost: autoBoughtPill ? pillCost : 0,
        spiritStonesCost,
      },
    };
  });
};

// ==================== 化形 ====================

export interface TransformResultDto {
  transformed: boolean;
  previousTier: string;
}

/**
 * 化形。
 * 化形时更新 template_id 为血脉对应的角色模板。
 */
export const transform = async (
  characterId: number,
  beastId: number,
): Promise<ServiceResult<TransformResultDto>> => {
  return withTransaction(async () => {
    const beastResult = await query<BeastRow>(
      `${BEAST_LOCK_SELECT}
       WHERE id = $1 AND character_id = $2
       FOR UPDATE`,
      [beastId, characterId],
    );
    const beastRow = beastResult.rows[0];
    if (!beastRow) {
      return { success: false, message: '灵兽不存在' };
    }

    const check = checkTransformConditions({
      level: Number(beastRow.level),
      beastTier: beastRow.beast_tier,
      isTransformed: beastRow.is_transformed,
    });

    if (!check.canTransform) {
      return { success: false, message: check.failedReasons.join('；') };
    }

    // 获取血脉模板 ID
    const bloodline = beastRow.bloodline_id ? getBloodlineById(beastRow.bloodline_id) : null;
    if (!bloodline) {
      return { success: false, message: '血脉配置不存在，无法化形' };
    }

    // 设置化形状态，如果血脉有强制模板则更新 template_id
    const newTemplateId = bloodline.forced_template ?? beastRow.template_id;
    await query(
      `UPDATE character_beast
       SET is_transformed = TRUE, template_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [newTemplateId, beastId],
    );

    return {
      success: true,
      data: {
        transformed: true,
        previousTier: beastRow.beast_tier,
      },
    };
  });
};

// ==================== 条件检查（预览） ====================

/**
 * 检查品阶提升条件。
 */
export const checkTierUp = async (
  characterId: number,
  beastId: number,
): Promise<ServiceResult> => {
  const beastRow = await loadSingleBeastRow(beastId);
  if (!beastRow || beastRow.character_id !== characterId) {
    return { success: false, message: '灵兽不存在' };
  }

  const check = checkTierUpConditions({
    level: Number(beastRow.level),
    beastTier: beastRow.beast_tier,
  });

  return {
    success: true,
    data: {
      canTierUp: check.canTierUp,
      failedReasons: check.failedReasons,
      nextTier: check.nextTier,
      requirement: check.requirement,
    },
  };
};

/**
 * 检查化形条件。
 */
export const checkTransform = async (
  characterId: number,
  beastId: number,
): Promise<ServiceResult> => {
  const beastRow = await loadSingleBeastRow(beastId);
  if (!beastRow || beastRow.character_id !== characterId) {
    return { success: false, message: '灵兽不存在' };
  }

  const check = checkTransformConditions({
    level: Number(beastRow.level),
    beastTier: beastRow.beast_tier,
    isTransformed: beastRow.is_transformed,
  });

  return {
    success: true,
    data: {
      canTransform: check.canTransform,
      failedReasons: check.failedReasons,
      requirement: TRANSFORM_REQUIREMENT,
    },
  };
};
