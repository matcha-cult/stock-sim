/**
 * 灵兽视图构建与 DB 查询共享模块
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：集中维护灵兽行数据、兽诀行数据与"灵兽实例 -> 展示 DTO"的组装逻辑。
 * 2. 不做什么：不处理 HTTP 参数，不决定灵兽是否允许操作。
 *
 * 输入 / 输出：
 * - 输入：character_beast / character_beast_technique 行、灵兽模板。
 * - 输出：灵兽展示 DTO、兽诀 DTO，以及可复用的灵兽行查询函数。
 *
 * 关键边界条件与坑点：
 * 1. 灵兽属性只允许由模板、等级、资质和已学兽诀被动共同决定，禁止追加隐藏加成。
 * 2. EXTRACT(EPOCH FROM ...) 获取时间戳，不用 Date.getTime()。
 */
import { query } from '../../../config/database.js';
import { getBeastDefinitionById, getBeastTemplateById, getBloodlineById, type BeastDefConfig, type BeastTemplateConfig } from '../beastConfigLoader.js';
import { calcBeastAttrs, type AttrOverride } from './beastRules.js';

/** 基础灵固定使用的幼兽模板 ID */
const BABY_TEMPLATE_ID = 'tpl-baby';

// ==================== 行类型 ====================

export interface BeastRow {
  id: number;
  character_id: number;
  beast_def_id: string;
  bloodline_id: string | null;
  nickname: string;
  description: string | null;
  avatar: string | null;
  level: number;
  progress_exp: number;
  template_id: string;
  base_attrs_override: AttrOverride;
  level_gains_override: AttrOverride;
  aptitude_bonus: number;
  cultivation_count: number;
  beast_tier: string;
  star_level: number;
  is_transformed: boolean;
  is_active: boolean;
  obtained_from: string;
  obtained_ref_id: string | null;
  custom_tag: string | null;
  created_at: string;
  updated_at: string;
}

export interface BeastTechniqueRow {
  id: number;
  beast_id: number;
  technique_id: string;
  current_layer: number;
  is_innate: boolean;
  learned_from_item_def_id: string | null;
  created_at: string;
  updated_at: string;
}

// ==================== DTO 类型 ====================

export interface BeastComputedAttrsDto {
  max_hp: number;
  max_mp: number;
  atk: number;
  magic_atk: number;
  def: number;
  magic_def: number;
  spd: number;
  accuracy: number;
  dodge: number;
  parry: number;
  crit_rate: number;
  crit_dmg: number;
  crit_dmg_reduce: number;
  anti_crit: number;
  dmg_bonus: number;
  heal_bonus: number;
  heal_reduce: number;
  life_steal: number;
  cdr: number;
  control_resist: number;
  metal_resist: number;
  wood_resist: number;
  water_resist: number;
  fire_resist: number;
  earth_resist: number;
  hp_regen: number;
  mp_regen: number;
}

export interface BeastDisplayDto {
  id: number;
  beastDefId: string;
  bloodlineId: string | null;
  bloodlineName: string | null;
  bloodlineRarity: string | null;
  transformForm: string | null;
  name: string;
  templateName: string;
  templateId: string;
  description: string | null;
  avatar: string | null;
  level: number;
  progressExp: number;
  aptitudeBonus: number;
  cultivationCount: number;
  beastTier: string;
  starLevel: number;
  isTransformed: boolean;
  isActive: boolean;
  customTag: string | null;
  element: string[];
  role: string;
  maxTechniqueSlots: number;
  innateTechniqueIds: string[];
}

export interface BeastDetailDto extends BeastDisplayDto {
  computedAttrs: BeastComputedAttrsDto;
  baseAttrsOverride: AttrOverride;
  levelGainsOverride: AttrOverride;
  templateBaseAttrs: Record<string, number>;
  templateLevelGains: Record<string, number>;
  techniques: BeastTechniqueDto[];
}

export interface BeastTechniqueDto {
  id: number;
  techniqueId: string;
  currentLayer: number;
  isInnate: boolean;
  learnedFromItemDefId: string | null;
}

// ==================== DB 查询 ====================

const BEAST_ROW_SELECT = `
  SELECT
    id, character_id, beast_def_id, bloodline_id, nickname, description, avatar,
    level::bigint AS level, progress_exp::bigint AS progress_exp,
    template_id, base_attrs_override, level_gains_override, aptitude_bonus,
    cultivation_count, beast_tier, star_level, is_transformed, is_active,
    obtained_from, obtained_ref_id, custom_tag,
    EXTRACT(EPOCH FROM created_at)::bigint AS created_at,
    EXTRACT(EPOCH FROM updated_at)::bigint AS updated_at
  FROM character_beast
`;

/**
 * 查询角色所有灵兽。
 */
export const loadBeastRows = async (characterId: number): Promise<BeastRow[]> => {
  const result = await query<BeastRow>(
    `${BEAST_ROW_SELECT} WHERE character_id = $1 ORDER BY id ASC`,
    [characterId],
  );
  return result.rows;
};

/**
 * 查询单只灵兽。
 */
export const loadSingleBeastRow = async (beastId: number): Promise<BeastRow | null> => {
  const result = await query<BeastRow>(
    `${BEAST_ROW_SELECT} WHERE id = $1`,
    [beastId],
  );
  return result.rows[0] ?? null;
};

/**
 * 批量查询灵兽（按 ID 列表）。
 */
export const loadBeastRowsByIds = async (beastIds: number[]): Promise<BeastRow[]> => {
  if (beastIds.length === 0) return [];
  const result = await query<BeastRow>(
    `${BEAST_ROW_SELECT} WHERE id = ANY($1) ORDER BY id ASC`,
    [beastIds],
  );
  return result.rows;
};

/**
 * 查询灵兽所有兽诀。
 */
export const loadBeastTechniqueRows = async (beastId: number): Promise<BeastTechniqueRow[]> => {
  const result = await query<BeastTechniqueRow>(
    `
    SELECT
      id, beast_id, technique_id, current_layer, is_innate, learned_from_item_def_id,
      EXTRACT(EPOCH FROM created_at)::bigint AS created_at,
      EXTRACT(EPOCH FROM updated_at)::bigint AS updated_at
    FROM character_beast_technique
    WHERE beast_id = $1
    ORDER BY id ASC
    `,
    [beastId],
  );
  return result.rows;
};

/**
 * 批量查询灵兽兽诀（按灵兽 ID 列表）。
 */
export const loadBeastTechniqueRowsByBeastIds = async (beastIds: number[]): Promise<BeastTechniqueRow[]> => {
  if (beastIds.length === 0) return [];
  const result = await query<BeastTechniqueRow>(
    `
    SELECT
      id, beast_id, technique_id, current_layer, is_innate, learned_from_item_def_id,
      EXTRACT(EPOCH FROM created_at)::bigint AS created_at,
      EXTRACT(EPOCH FROM updated_at)::bigint AS updated_at
    FROM character_beast_technique
    WHERE beast_id = ANY($1)
    ORDER BY beast_id, id ASC
    `,
    [beastIds],
  );
  return result.rows;
};

/**
 * 查询灵兽的技能策略。
 */
export const loadBeastSkillPolicyRows = async (beastId: number): Promise<{
  id: number;
  beast_id: number;
  skill_id: string;
  priority: number;
  enabled: boolean;
}[]> => {
  const result = await query<{
    id: number;
    beast_id: number;
    skill_id: string;
    priority: number;
    enabled: boolean;
  }>(
    `
    SELECT id, beast_id, skill_id, priority, enabled
    FROM character_beast_skill_policy
    WHERE beast_id = $1
    ORDER BY priority DESC, id ASC
    `,
    [beastId],
  );
  return result.rows;
};

// ==================== DTO 构建 ====================

/**
 * 构建灵兽展示 DTO。
 *
 * 模板解析：直接使用 row.template_id（创建时为 tpl-baby，化形时更新为血脉模板）。
 */
export const buildBeastDisplay = (row: BeastRow, def: BeastDefConfig, template: BeastTemplateConfig): BeastDisplayDto => {
  const bloodline = row.bloodline_id ? getBloodlineById(row.bloodline_id) : null;

  return {
    id: row.id,
    beastDefId: row.beast_def_id,
    bloodlineId: row.bloodline_id,
    bloodlineName: bloodline?.name ?? null,
    bloodlineRarity: bloodline?.rarity ?? null,
    transformForm: null,  // 已移除化形设定
    name: row.nickname,
    templateName: template.name,
    templateId: row.template_id,
    description: row.description,
    avatar: row.avatar ?? def.avatar ?? null,
    level: Number(row.level),
    progressExp: Number(row.progress_exp),
    aptitudeBonus: row.aptitude_bonus,
    cultivationCount: row.cultivation_count,
    beastTier: row.beast_tier,
    starLevel: row.star_level,
    isTransformed: row.is_transformed,
    isActive: row.is_active,
    customTag: row.custom_tag,
    element: def.attribute_element,
    role: template.role,
    maxTechniqueSlots: template.max_technique_slots,
    innateTechniqueIds: [],  // 血脉天赋在化形后解锁
  };
};

/**
 * 构建兽诀 DTO。
 */
export const buildBeastTechniqueDto = (row: BeastTechniqueRow): BeastTechniqueDto => ({
  id: row.id,
  techniqueId: row.technique_id,
  currentLayer: row.current_layer,
  isInnate: row.is_innate,
  learnedFromItemDefId: row.learned_from_item_def_id,
});

/**
 * 构建灵兽详情 DTO（含计算属性）。
 *
 * 模板解析：直接使用 row.template_id，化形时已更新为血脉模板。
 */
export const buildBeastDetails = (
  row: BeastRow,
  def: BeastDefConfig,
  template: BeastTemplateConfig,
  techniqueRows: BeastTechniqueRow[],
): BeastDetailDto => {
  const display = buildBeastDisplay(row, def, template);

  // 计算最终属性（暂不计算兽诀被动，需要兽诀静态配置）
  const computedAttrs = calcBeastAttrs({
    baseAttrs: template.base_attrs,
    level: Number(row.level),
    levelAttrGains: template.level_attr_gains,
    aptitudeBonus: row.aptitude_bonus,
    baseAttrsOverride: row.base_attrs_override,
    levelGainsOverride: row.level_gains_override,
    passiveAttrs: {},
    passiveTypes: new Map(),
    beastTier: row.beast_tier,
    starLevel: row.star_level,
    isTransformed: row.is_transformed,
    element: def.attribute_element,
  });

  return {
    ...display,
    computedAttrs: computedAttrs as unknown as BeastComputedAttrsDto,
    baseAttrsOverride: row.base_attrs_override,
    levelGainsOverride: row.level_gains_override,
    templateBaseAttrs: template.base_attrs as unknown as Record<string, number>,
    templateLevelGains: template.level_attr_gains as unknown as Record<string, number>,
    techniques: techniqueRows.map(buildBeastTechniqueDto),
  };
};

/**
 * 加载灵兽并构建详情 DTO（完整查询链路）。
 */
export const loadBeastDetailById = async (beastId: number): Promise<BeastDetailDto | null> => {
  const row = await loadSingleBeastRow(beastId);
  if (!row) return null;

  const def = getBeastDefinitionById(row.beast_def_id);
  if (!def) return null;

  const template = getBeastTemplateById(row.template_id);
  if (!template) return null;

  const techniqueRows = await loadBeastTechniqueRows(beastId);
  return buildBeastDetails(row, def, template, techniqueRows);
};
