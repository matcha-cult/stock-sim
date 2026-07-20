/**
 * 灵兽融合服务
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：5 只相同星级的灵兽合成为 1 只更高星级的灵兽（不限物种）
 * 2. 不做什么：不处理升级、不处理装备
 *
 * 融合规则：
 * - 需要 5 只相同 star_level 的灵兽（不限物种）
 * - 以阵眼灵兽（第一只）为准（保留其物种）
 * - 基础属性、成长属性取所有参与融合灵兽的最高值
 * - 星级 +1（最高 6 星）
 *
 * 数据流 / 状态流：
 * API 调用 -> 校验灵兽 -> 计算融合结果 -> 写入数据库 -> 返回新灵兽
 *
 * 关键边界条件与坑点：
 * 1. 必须确保 5 只灵兽都属于同一角色
 * 2. 融合后删除 4 只材料灵兽，保留阵眼灵兽并升级
 * 3. 星级最高 6 星，无法继续融合
 */

import { query, withTransaction } from '../../config/database.js';

// ==================== 类型定义 ====================

export interface FusionMaterial {
  beastId: number;
  characterId: number;
}

export interface FusionResult {
  success: boolean;
  message?: string;
  newBeastId?: number;
  newStarLevel?: number;
}

// ==================== 融合逻辑 ====================

/**
 * 执行灵兽融合
 *
 * @param materials - 5 只灵兽（第一只为阵眼）
 * @returns 融合结果
 */
export const fuseBeasts = async (materials: FusionMaterial[]): Promise<FusionResult> => {
  console.log('[fuseBeasts] 开始融合，materials:', materials);

  // 校验数量
  if (materials.length !== 5) {
    console.log('[fuseBeasts] 灵兽数量不为5:', materials.length);
    return { success: false, message: '融合需要 5 只灵兽' };
  }

  const characterId = materials[0].characterId;

  // 校验所有灵兽都属于同一角色
  const beastIds = materials.map((m) => m.beastId);
  console.log('[fuseBeasts] 查询灵兽，beastIds:', beastIds, 'characterId:', characterId);

  const beastsResult = await query<{
    id: number;
    character_id: number;
    beast_def_id: string;
    star_level: number;
    beast_tier: string;
    base_attrs_override: any;
    level_gains_override: any;
    is_active: boolean;
  }>(
    `SELECT id, character_id, beast_def_id, star_level, beast_tier, base_attrs_override, level_gains_override, is_active
     FROM character_beast WHERE id = ANY($1)`,
    [beastIds],
  );

  console.log('[fuseBeasts] 查询结果，rows数量:', beastsResult.rows.length);

  if (beastsResult.rows.length !== 5) {
    console.log('[fuseBeasts] 灵兽数量不足5:', beastsResult.rows.length);
    return { success: false, message: '部分灵兽不存在' };
  }

  // 按前端传入的顺序排序，确保第一个是阵眼
  const beastsInOrder = beastIds
    .map((id) => beastsResult.rows.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined);

  console.log('[fuseBeasts] 按输入顺序排序后的灵兽ids:', beastsInOrder.map((b) => b.id));

  // 校验所有灵兽都属于同一角色
  for (const beast of beastsInOrder) {
    if (beast.character_id !== characterId) {
      console.log('[fuseBeasts] 灵兽不属于当前角色，beast.character_id:', beast.character_id, 'characterId:', characterId);
      return { success: false, message: '灵兽不属于当前角色' };
    }
  }

  // 校验没有正在出战的灵兽
  const activeBeasts = beastsInOrder.filter((b) => b.is_active);
  if (activeBeasts.length > 0) {
    console.log('[fuseBeasts] 存在正在出战的灵兽，activeBeasts:', activeBeasts.map((b) => b.id));
    return { success: false, message: '不能融合正在出战的灵兽，请先收回' };
  }

  // 校验所有灵兽都是相同星级（不限物种）
  const starLevel = beastsInOrder[0].star_level;
  for (const beast of beastsInOrder) {
    if (beast.star_level !== starLevel) {
      console.log('[fuseBeasts] 灵兽星级不一致，starLevel:', starLevel, 'beast.star_level:', beast.star_level);
      return { success: false, message: `融合灵兽必须是相同星级（需要 5 只${starLevel}星灵兽）` };
    }
  }

  // 校验阵眼灵兽星级（第一个是阵眼）
  const anchorBeast = beastsInOrder[0];
  const currentStar = anchorBeast.star_level;

  // 融合升星上限：当前最高只能选择 3 星融合，融合后可达 4 星（5 星后有独特升星流程，待开发）
  const FUSION_MAX_STAR = 3;
  if (currentStar > FUSION_MAX_STAR) {
    console.log('[fuseBeasts] 超过融合升星上限，currentStar:', currentStar, 'FUSION_MAX_STAR:', FUSION_MAX_STAR);
    return { success: false, message: `融合升星上限为${FUSION_MAX_STAR + 1}星（需选择${FUSION_MAX_STAR}星灵兽融合），更高星级需通过其他方式提升` };
  }

  // 阵眼品阶校验：融合后星级与阵眼品阶必须匹配
  // 1→2星需玄级，2→3星需地级，3→4星需天阶
  const TIER_FOR_STAR: Record<number, { tier: string; name: string }> = {
    2: { tier: 'xuan', name: '玄阶' },
    3: { tier: 'di', name: '地阶' },
    4: { tier: 'tian', name: '天阶' },
  };
  const TIER_NAME_MAP: Record<string, string> = {
    huang: '黄阶',
    xuan: '玄阶',
    di: '地阶',
    tian: '天阶',
  };
  const newStarLevel = currentStar + 1;
  const tierRequirement = TIER_FOR_STAR[newStarLevel];
  if (tierRequirement && anchorBeast.beast_tier !== tierRequirement.tier) {
    console.log('[fuseBeasts] 阵眼品阶不符，anchorBeast.beast_tier:', anchorBeast.beast_tier, '要求:', tierRequirement.tier);
    const currentTierName = TIER_NAME_MAP[anchorBeast.beast_tier] || anchorBeast.beast_tier;
    return { success: false, message: `融合至${newStarLevel}星需阵眼为${tierRequirement.name}（当前${currentTierName}）` };
  }

  // 计算融合后的属性（取最高值）
  const mergedBaseAttrs = mergeAttributes(beastsInOrder.map((b) => b.base_attrs_override));
  const mergedLevelGains = mergeAttributes(beastsInOrder.map((b) => b.level_gains_override));
  console.log('[fuseBeasts] 合并属性完成，mergedBaseAttrs:', mergedBaseAttrs, 'mergedLevelGains:', mergedLevelGains);

  // 执行融合（事务）
  try {
    const result = await withTransaction(async () => {
      console.log('[fuseBeasts] 事务开始，更新阵眼灵兽，anchorBeast.id:', anchorBeast.id);

      // 更新阵眼灵兽
      await query(
        `UPDATE character_beast
         SET star_level = $1,
             base_attrs_override = $2,
             level_gains_override = $3
         WHERE id = $4`,
        [newStarLevel, JSON.stringify(mergedBaseAttrs), JSON.stringify(mergedLevelGains), anchorBeast.id],
      );

      console.log('[fuseBeasts] 阵眼灵兽更新成功');

      // 删除其他 4 只灵兽（按输入顺序，第 2-5 只是材料）
      const materialIds = beastsInOrder.slice(1).map((b) => b.id);
      console.log('[fuseBeasts] 删除材料灵兽，materialIds:', materialIds);

      await query(`DELETE FROM character_beast WHERE id = ANY($1)`, [materialIds]);

      console.log('[fuseBeasts] 材料灵兽删除成功');

      return {
        success: true,
        newBeastId: anchorBeast.id,
        newStarLevel,
      };
    });

    console.log('[fuseBeasts] 融合完成，result:', result);
    return result;
  } catch (error) {
    console.error('[fuseBeasts] 融合异常:', error);
    return { success: false, message: '融合失败' };
  }
};

/**
 * 合并属性（取最高值）
 */
const mergeAttributes = (attrsList: any[]): any => {
  if (attrsList.length === 0) return {};

  const result: any = {};

  // 遍历所有属性键
  const allKeys = new Set<string>();
  for (const attrs of attrsList) {
    if (attrs && typeof attrs === 'object') {
      for (const key of Object.keys(attrs)) {
        allKeys.add(key);
      }
    }
  }

  // 取每个属性的最高值
  for (const key of allKeys) {
    let maxValue = -Infinity;
    for (const attrs of attrsList) {
      if (attrs && typeof attrs === 'object' && key in attrs) {
        const value = Number(attrs[key]);
        if (!isNaN(value) && value > maxValue) {
          maxValue = value;
        }
      }
    }
    if (maxValue !== -Infinity) {
      result[key] = maxValue;
    }
  }

  return result;
};
