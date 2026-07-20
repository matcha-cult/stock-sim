/**
 * 灵兽系统主服务
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：统一处理灵兽总览、详情预览、出战切换、经验灌注、赐名。
 * 2. 不做什么：不处理 HTTP 参数，不处理祭坛召唤/融合/洗髓/培育/品阶（各自有独立服务）。
 *
 * 输入 / 输出：
 * - 输入：characterId、beastId、经验预算等。
 * - 输出：统一 `{ success, message, data }` 结果。
 *
 * 数据流 / 状态流：
 * route -> beastService -> beastRules + beastView + SQL -> DTO。
 *
 * 关键边界条件与坑点：
 * 1) 升级必须在事务内锁定角色与灵兽行，避免经验双花。
 * 2) 灵兽属性只由模板 + 等级 + 资质 + 兽诀 + 品阶 + 化形决定。
 */
import { query, withTransaction } from '../../config/database.js';
import { getBeastDefinitionById, getBeastTemplateById, getBeastGrowthConfig, getEnabledBeastDefinitions } from './beastConfigLoader.js';
import {
  resolveBeastInjectPlan,
  type BeastInjectPlan,
} from './shared/beastRules.js';
import { resolveBeastLevelLimit } from './shared/beastLevelLimit.js';
import { resolveBeastTierLevelLimit } from './shared/beastTierLevelLimit.js';
import { setBeastActivation, loadActiveBeastId } from './shared/beastActivation.js';
import {
  loadBeastRows,
  loadBeastRowsByIds,
  loadSingleBeastRow,
  loadBeastTechniqueRows,
  loadBeastTechniqueRowsByBeastIds,
  buildBeastDisplay,
  buildBeastDetails,
  type BeastDisplayDto,
  type BeastDetailDto,
  type BeastRow,
} from './shared/beastView.js';
import {
  loadBeastSkillPolicy,
  saveBeastSkillPolicy,
  normalizeBeastSkillPolicySlots,
  type BeastSkillPolicySlotDto,
} from './shared/beastSkillPolicy.js';

// ==================== 结果类型 ====================

interface ServiceResult<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
}

// ==================== 总览 ====================

export interface BeastOverviewDto {
  beasts: BeastDisplayDto[];
  activeBeastId: number | null;
  maxBeastCount: number;
}

/**
 * 获取角色灵兽总览。
 */
export const getOverview = async (characterId: number): Promise<ServiceResult<BeastOverviewDto>> => {
  const [beastRows, activeBeastId] = await Promise.all([
    loadBeastRows(characterId),
    loadActiveBeastId(characterId),
  ]);

  const defs = getEnabledBeastDefinitions();
  const beasts: BeastDisplayDto[] = [];

  for (const row of beastRows) {
    const def = getBeastDefinitionById(row.beast_def_id);
    if (!def) continue;
    const template = getBeastTemplateById(row.template_id);
    if (!template) continue;
    beasts.push(buildBeastDisplay(row, def, template));
  }

  return {
    success: true,
    data: {
      beasts,
      activeBeastId,
      maxBeastCount: 20,
    },
  };
};

// ==================== 详情预览 ====================

/**
 * 获取单只灵兽详情。
 */
export const getPreview = async (beastId: number): Promise<ServiceResult<BeastDetailDto>> => {
  const row = await loadSingleBeastRow(beastId);
  if (!row) {
    return { success: false, message: '灵兽不存在' };
  }

  const def = getBeastDefinitionById(row.beast_def_id);
  if (!def) {
    return { success: false, message: '灵兽模板不存在' };
  }

  const template = getBeastTemplateById(row.template_id);
  if (!template) {
    return { success: false, message: '基础模板不存在' };
  }

  const techniqueRows = await loadBeastTechniqueRows(beastId);
  const detail = buildBeastDetails(row, def, template, techniqueRows);

  return { success: true, data: detail };
};

/**
 * 批量获取灵兽详情。
 */
export const getBatchPreview = async (
  beastIds: number[],
  characterId: number,
): Promise<ServiceResult<BeastDetailDto[]>> => {
  if (beastIds.length === 0) {
    return { success: true, data: [] };
  }

  // 限制批量查询数量
  if (beastIds.length > 50) {
    return { success: false, message: '批量查询数量不能超过 50' };
  }

  const rows = await loadBeastRowsByIds(beastIds);
  if (rows.length === 0) {
    return { success: true, data: [] };
  }

  // 校验灵兽归属
  const invalidRow = rows.find((row) => row.character_id !== characterId);
  if (invalidRow) {
    return { success: false, message: '灵兽不属于当前角色' };
  }

  const defs = getEnabledBeastDefinitions();
  const details: BeastDetailDto[] = [];

  // 批量加载兽诀
  const beastIdsToLoad = rows.map((r) => r.id);
  const allTechniqueRows = await loadBeastTechniqueRowsByBeastIds(beastIdsToLoad);

  // 按 beast_id 分组兽诀
  const techniqueMap = new Map<number, typeof allTechniqueRows>();
  for (const techRow of allTechniqueRows) {
    if (!techniqueMap.has(techRow.beast_id)) {
      techniqueMap.set(techRow.beast_id, []);
    }
    techniqueMap.get(techRow.beast_id)!.push(techRow);
  }

  for (const row of rows) {
    const def = getBeastDefinitionById(row.beast_def_id);
    if (!def) continue;
    const template = getBeastTemplateById(row.template_id);
    if (!template) continue;

    const techniqueRows = techniqueMap.get(row.id) ?? [];
    const detail = buildBeastDetails(row, def, template, techniqueRows);
    details.push(detail);
  }

  return { success: true, data: details };
};

// ==================== 技能策略 ====================

export interface BeastSkillPolicyResultDto {
  slots: BeastSkillPolicySlotDto[];
}

/**
 * 查询技能策略。
 */
export const getSkillPolicy = async (
  characterId: number,
  beastId: number,
): Promise<ServiceResult<BeastSkillPolicyResultDto>> => {
  const row = await loadSingleBeastRow(beastId);
  if (!row || row.character_id !== characterId) {
    return { success: false, message: '灵兽不存在' };
  }

  const slots = await loadBeastSkillPolicy(beastId);
  return { success: true, data: { slots } };
};

/**
 * 更新技能策略。
 */
export const updateSkillPolicy = async (
  characterId: number,
  beastId: number,
  rawSlots: Array<{ skillId?: string; priority?: number; enabled?: boolean }>,
): Promise<ServiceResult<BeastSkillPolicyResultDto>> => {
  const row = await loadSingleBeastRow(beastId);
  if (!row || row.character_id !== characterId) {
    return { success: false, message: '灵兽不存在' };
  }

  const slots = normalizeBeastSkillPolicySlots(rawSlots);
  if (!slots) {
    return { success: false, message: '策略参数无效' };
  }

  await saveBeastSkillPolicy(beastId, slots);
  return { success: true, data: { slots } };
};

// ==================== 经验灌注 ====================

export interface BeastInjectExpResultDto {
  plan: BeastInjectPlan;
  beast: BeastDetailDto;
}

/**
 * 经验灌注：消耗角色经验提升灵兽等级。
 * 事务内锁定角色行和灵兽行，避免经验双花。
 */
export const injectExp = async (
  characterId: number,
  beastId: number,
  injectExpBudget: number,
): Promise<ServiceResult<BeastInjectExpResultDto>> => {
  if (injectExpBudget <= 0) {
    return { success: false, message: '灌注经验必须大于 0' };
  }

  return withTransaction(async () => {
    // 锁定角色行
    const charResult = await query<{ id: number; exp: number; realm: string }>(
      `SELECT c.id, c.exp::bigint AS exp, c.title AS realm
       FROM characters c
       WHERE c.id = $1
       FOR UPDATE`,
      [characterId],
    );
    const charRow = charResult.rows[0];
    if (!charRow) {
      return { success: false, message: '角色不存在' };
    }

    // 锁定灵兽行
    const beastResult = await query<BeastRow>(
      `SELECT id, character_id, beast_def_id, level::bigint AS level, progress_exp::bigint AS progress_exp,
              template_id, aptitude_bonus,
              cultivation_count, beast_tier, is_transformed, is_active,
              nickname, description, avatar, obtained_from, obtained_ref_id,
              EXTRACT(EPOCH FROM created_at)::bigint AS created_at,
              EXTRACT(EPOCH FROM updated_at)::bigint AS updated_at
       FROM character_beast
       WHERE id = $1 AND character_id = $2
       FOR UPDATE`,
      [beastId, characterId],
    );
    const beastRow = beastResult.rows[0];
    if (!beastRow) {
      return { success: false, message: '灵兽不存在' };
    }

    const def = getBeastDefinitionById(beastRow.beast_def_id);
    if (!def) {
      return { success: false, message: '灵兽模板不存在' };
    }

    const growthConfig = getBeastGrowthConfig();
    const realmMaxLevel = resolveBeastLevelLimit(charRow.realm);
    const tierMaxLevel = resolveBeastTierLevelLimit(beastRow.beast_tier);
    const maxLevel = Math.min(realmMaxLevel, tierMaxLevel);

    const plan = resolveBeastInjectPlan({
      beforeLevel: Number(beastRow.level),
      beforeProgressExp: Number(beastRow.progress_exp),
      characterExp: Number(charRow.exp),
      injectExpBudget,
      config: growthConfig,
      maxLevel,
    });

    if (plan.spentExp <= 0) {
      return { success: false, message: '经验不足或已达等级上限' };
    }

    // 扣除角色经验
    await query(
      'UPDATE characters SET exp = exp - $1, updated_at = NOW() WHERE id = $2',
      [plan.spentExp, characterId],
    );

    // 更新灵兽等级和经验
    await query(
      'UPDATE character_beast SET level = $1, progress_exp = $2, updated_at = NOW() WHERE id = $3',
      [plan.afterLevel, plan.afterProgressExp, beastId],
    );

    // 重新查询并构建详情
    const updatedRow = await loadSingleBeastRow(beastId);
    if (!updatedRow) {
      return { success: false, message: '灵兽数据异常' };
    }
    const template = getBeastTemplateById(updatedRow.template_id);
    if (!template) {
      return { success: false, message: '基础模板不存在' };
    }
    const techniqueRows = await loadBeastTechniqueRows(beastId);
    const beastDetail = buildBeastDetails(updatedRow, def, template, techniqueRows);

    return { success: true, data: { plan, beast: beastDetail } };
  });
};

// ==================== 出战 / 收回 ====================

/**
 * 出战灵兽。
 */
export const activate = async (
  characterId: number,
  beastId: number,
): Promise<ServiceResult> => {
  const row = await loadSingleBeastRow(beastId);
  if (!row || row.character_id !== characterId) {
    return { success: false, message: '灵兽不存在' };
  }

  await setBeastActivation(characterId, beastId);
  return { success: true };
};

/**
 * 收回灵兽。
 */
export const dismiss = async (characterId: number): Promise<ServiceResult> => {
  await setBeastActivation(characterId, null);
  return { success: true };
};

// ==================== 放生（解除契约） ====================

/**
 * 放生灵兽（解除契约）。
 * 删除灵兽及其兽诀记录，如果放生的是出战灵兽则同时清除出战状态。
 */
export const release = async (
  characterId: number,
  beastId: number,
): Promise<ServiceResult> => {
  const row = await loadSingleBeastRow(beastId);
  if (!row || row.character_id !== characterId) {
    return { success: false, message: '灵兽不存在' };
  }

  const activeBeastId = await loadActiveBeastId(characterId);

  await withTransaction(async () => {
    // 删除兽诀
    await query(
      `DELETE FROM character_beast_technique WHERE beast_id = $1`,
      [beastId],
    );
    // 删除灵兽
    await query(
      `DELETE FROM character_beast WHERE id = $1 AND character_id = $2`,
      [beastId, characterId],
    );
    // 如果放生的是出战灵兽，清除出战状态
    if (activeBeastId === beastId) {
      await setBeastActivation(characterId, null);
    }
  });

  return { success: true };
};

// ==================== 赐名 ====================

/**
 * 灵兽赐名（消耗改名卡道具，暂不实现道具消耗逻辑）。
 */
export const renameWithCard = async (
  characterId: number,
  beastId: number,
  newName: string,
  newDescription?: string,
): Promise<ServiceResult> => {
  const trimmedName = newName.trim();
  if (trimmedName.length < 2 || trimmedName.length > 16) {
    return { success: false, message: '名称长度须在 2~16 个字符之间' };
  }

  const row = await loadSingleBeastRow(beastId);
  if (!row || row.character_id !== characterId) {
    return { success: false, message: '灵兽不存在' };
  }

  const desc = newDescription?.trim() ?? null;
  if (desc !== null && desc.length > 80) {
    return { success: false, message: '描述长度不能超过 80 个字符' };
  }

  await query(
    'UPDATE character_beast SET nickname = $1, description = $2, updated_at = NOW() WHERE id = $3',
    [trimmedName, desc, beastId],
  );

  return { success: true };
};

/**
 * 更新灵兽自定义标签。
 * @param characterId 角色 ID
 * @param beastId 灵兽 ID
 * @param customTag 标签（可选，空则清除）
 */
export const updateCustomTag = async (
  characterId: number,
  beastId: number,
  customTag: string | null,
): Promise<ServiceResult> => {
  // 校验标签值（仅允许三个选项或空）
  const VALID_TAGS = ['狗粮', '偏科', '全才'] as const;
  if (customTag !== null && !VALID_TAGS.includes(customTag as (typeof VALID_TAGS)[number])) {
    return { success: false, message: '无效的标签值' };
  }

  const row = await loadSingleBeastRow(beastId);
  if (!row || row.character_id !== characterId) {
    return { success: false, message: '灵兽不存在' };
  }

  await query(
    'UPDATE character_beast SET custom_tag = $1, updated_at = NOW() WHERE id = $2',
    [customTag, beastId],
  );

  return { success: true };
};
