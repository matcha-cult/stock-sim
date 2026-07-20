/**
 * 灵兽系统静态配置加载器
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：加载灵兽模板（beast_def.json）、基础模板（beast_base_templates.json）、血脉配置（beast_bloodlines.json）、成长参数（beast_growth.json）、祭坛配方（altar_recipes.json）。
 * 2. 不做什么：不加载兽诀定义（兽诀复用现有角色功法配置）。
 *
 * 输入 / 输出：
 * - 输入：5 个 JSON 配置文件。
 * - 输出：灵兽模板列表/索引、基础模板列表/索引、血脉列表/索引、成长参数、祭坛配方列表/索引。
 *
 * 数据流 / 状态流：
 * 启动时加载 -> 缓存到内存 -> 通过同步 getter 获取。
 *
 * 关键边界条件与坑点：
 * 1. 文件不存在时返回空默认值，不抛错。
 * 2. 配置缓存后不会自动刷新，需要重启服务。
 * 3. 各配置索引按 id 建立 Map，查询 O(1)。
 */
import { readFile } from 'fs/promises';
import { join } from 'path';

// ==================== 类型定义 ====================

/**
 * 灵兽基础属性配置。
 */
export interface BeastBaseAttrConfig {
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

/**
 * 基础模板配置（beast_base_templates.json 单条）。
 * 定义幼兽/各角色的基础属性和成长曲线。
 */
export interface BeastTemplateConfig {
  id: string;
  name: string;
  description?: string;
  role: string;
  base_aptitude_level: number;
  max_technique_slots: number;
  base_attrs: BeastBaseAttrConfig;
  level_attr_gains: BeastBaseAttrConfig;
}

/**
 * 灵兽基础灵配置（beast_def.json 单条）。
 * 基础灵只定义元素属性和培育参数，模板固定使用 tpl-baby。
 */
export interface BeastDefConfig {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  attribute_element: string[];
  cultivation_decay_rate: number;
  sort_weight: number;
  enabled: boolean;
}

/**
 * 血脉稀有度。
 */
export type BloodlineRarity = 'SSR' | 'SR';

/**
 * 血脉配置（beast_bloodlines.json 单条）。
 * 角色定位从 template_id 对应的模板中读取，血脉自身不定义 role。
 */
export interface BloodlineConfig {
  id: string;
  name: string;
  element: string | null;  // null 表示无属性
  rarity: BloodlineRarity;
  forced_template: string | null;  // 强制使用的基础模板ID（SSR为"tpl-balanced"，SR为null）
  description: string;
  weight: number;  // 召唤权重
}

/**
 * 灵兽成长参数配置（beast_growth.json）。
 */
export interface BeastGrowthConfig {
  exp_base_exp: number;
  exp_growth_rate: number;
  aptitude_base: number;
  aptitude_growth_rate: number;
}

/**
 * 祭坛配方偏好配置。
 * 支持三维匹配：元素、物品ID、物品特性。
 */
export interface AltarRecipePreference {
  elements: string[];  // 元素汉字（如 ["木"]）
  items: string[];     // 物品ID（如 ["qi_xing_lian"]）
  traits: string[];    // 物品特性（如 ["七星"]）
}

/**
 * 祭坛配方配置（altar_recipes.json 单条）。
 * 现在对应血脉而非灵兽。
 */
export interface AltarRecipeConfig {
  id: string;
  bloodline_id: string;  // 改为血脉ID
  preferred: AltarRecipePreference;
  disliked: AltarRecipePreference;
  required_rarity?: string | null;  // SSR配方必需：无属性祭品的最低稀有度
  description?: string;
  weight: number;
}

// ==================== 缓存变量 ====================

let cachedBeastTemplates: readonly BeastTemplateConfig[] | null = null;
let cachedBeastTemplateIndex: ReadonlyMap<string, BeastTemplateConfig> | null = null;
let cachedBeastDefinitions: readonly BeastDefConfig[] | null = null;
let cachedBeastDefIndex: ReadonlyMap<string, BeastDefConfig> | null = null;
let cachedBloodlines: readonly BloodlineConfig[] | null = null;
let cachedBloodlineIndex: ReadonlyMap<string, BloodlineConfig> | null = null;
let cachedBeastGrowth: BeastGrowthConfig | null = null;
let cachedAltarRecipes: readonly AltarRecipeConfig[] | null = null;

// ==================== 文件路径 ====================

const DATA_DIR = join(process.cwd(), 'data/seeds/beast');
const BEAST_TEMPLATES_PATH = join(DATA_DIR, 'beast_base_templates.json');
const BEAST_DEF_PATH = join(DATA_DIR, 'beast_def.json');
const BEAST_BLOODLINES_PATH = join(DATA_DIR, 'beast_bloodlines.json');
const BEAST_GROWTH_PATH = join(DATA_DIR, 'beast_growth.json');
const ALTAR_RECIPES_PATH = join(DATA_DIR, 'altar_recipes.json');

// ==================== 基础模板 ====================

async function loadBeastTemplates(): Promise<readonly BeastTemplateConfig[]> {
  if (cachedBeastTemplates !== null) {
    return cachedBeastTemplates;
  }

  try {
    const content = await readFile(BEAST_TEMPLATES_PATH, 'utf-8');
    const parsed = JSON.parse(content) as { templates: BeastTemplateConfig[] };
    cachedBeastTemplates = parsed.templates;
    return parsed.templates;
  } catch {
    cachedBeastTemplates = [];
    return [];
  }
}

function buildBeastTemplateIndex(templates: readonly BeastTemplateConfig[]): Map<string, BeastTemplateConfig> {
  const index = new Map<string, BeastTemplateConfig>();
  for (const tpl of templates) {
    index.set(tpl.id, tpl);
  }
  return index;
}

/**
 * 获取所有基础模板（同步）。
 */
export function getBeastTemplates(): readonly BeastTemplateConfig[] {
  if (cachedBeastTemplates === null) {
    throw new Error('Beast templates not loaded. Call initBeastConfig() first.');
  }
  return cachedBeastTemplates;
}

/**
 * 按 id 查询基础模板（同步，O(1)）。
 */
export function getBeastTemplateById(id: string): BeastTemplateConfig | undefined {
  if (cachedBeastTemplateIndex === null) {
    throw new Error('Beast templates not loaded. Call initBeastConfig() first.');
  }
  return cachedBeastTemplateIndex.get(id);
}

// ==================== 灵兽定义 ====================

async function loadBeastDefinitions(): Promise<readonly BeastDefConfig[]> {
  if (cachedBeastDefinitions !== null) {
    return cachedBeastDefinitions;
  }

  try {
    const content = await readFile(BEAST_DEF_PATH, 'utf-8');
    const parsed = JSON.parse(content) as { beasts: BeastDefConfig[] };
    cachedBeastDefinitions = parsed.beasts;
    return parsed.beasts;
  } catch {
    cachedBeastDefinitions = [];
    return [];
  }
}

function buildBeastDefIndex(defs: readonly BeastDefConfig[]): Map<string, BeastDefConfig> {
  const index = new Map<string, BeastDefConfig>();
  for (const def of defs) {
    index.set(def.id, def);
  }
  return index;
}

/**
 * 获取所有灵兽模板（同步）。
 */
export function getBeastDefinitions(): readonly BeastDefConfig[] {
  if (cachedBeastDefinitions === null) {
    throw new Error('Beast definitions not loaded. Call initBeastConfig() first.');
  }
  return cachedBeastDefinitions;
}

/**
 * 按 id 查询灵兽模板（同步，O(1)）。
 */
export function getBeastDefinitionById(id: string): BeastDefConfig | undefined {
  if (cachedBeastDefIndex === null) {
    throw new Error('Beast definitions not loaded. Call initBeastConfig() first.');
  }
  return cachedBeastDefIndex.get(id);
}

/**
 * 获取启用的灵兽模板列表。
 */
export function getEnabledBeastDefinitions(): readonly BeastDefConfig[] {
  return getBeastDefinitions().filter((d) => d.enabled);
}

/**
 * 按元素筛选启用的灵兽模板。
 * 检查灵兽的元素数组是否包含指定元素。
 */
export function getBeastDefinitionsByElement(element: string): readonly BeastDefConfig[] {
  return getEnabledBeastDefinitions().filter((d) => d.attribute_element.includes(element));
}

// ==================== 血脉配置 ====================

async function loadBloodlines(): Promise<readonly BloodlineConfig[]> {
  if (cachedBloodlines !== null) {
    return cachedBloodlines;
  }

  try {
    const content = await readFile(BEAST_BLOODLINES_PATH, 'utf-8');
    const parsed = JSON.parse(content) as { bloodlines: BloodlineConfig[] };
    cachedBloodlines = parsed.bloodlines;
    return parsed.bloodlines;
  } catch {
    cachedBloodlines = [];
    return [];
  }
}

function buildBloodlineIndex(bloodlines: readonly BloodlineConfig[]): Map<string, BloodlineConfig> {
  const index = new Map<string, BloodlineConfig>();
  for (const bl of bloodlines) {
    index.set(bl.id, bl);
  }
  return index;
}

/**
 * 获取所有血脉配置（同步）。
 */
export function getBloodlines(): readonly BloodlineConfig[] {
  if (cachedBloodlines === null) {
    throw new Error('Bloodlines not loaded. Call initBeastConfig() first.');
  }
  return cachedBloodlines;
}

/**
 * 按 id 查询血脉配置（同步，O(1)）。
 */
export function getBloodlineById(id: string): BloodlineConfig | undefined {
  if (cachedBloodlineIndex === null) {
    throw new Error('Bloodlines not loaded. Call initBeastConfig() first.');
  }
  return cachedBloodlineIndex.get(id);
}

/**
 * 按元素筛选血脉。
 * element 为 null 时返回无属性血脉。
 */
export function getBloodlinesByElement(element: string | null): readonly BloodlineConfig[] {
  return getBloodlines().filter((bl) => bl.element === element);
}

/**
 * 按稀有度筛选血脉。
 */
export function getBloodlinesByRarity(rarity: BloodlineRarity): readonly BloodlineConfig[] {
  return getBloodlines().filter((bl) => bl.rarity === rarity);
}

// ==================== 成长参数 ====================

async function loadBeastGrowth(): Promise<BeastGrowthConfig> {
  if (cachedBeastGrowth !== null) {
    return cachedBeastGrowth;
  }

  const defaultGrowth: BeastGrowthConfig = {
    exp_base_exp: 1000,
    exp_growth_rate: 1.15,
    aptitude_base: 100,
    aptitude_growth_rate: 1.1,
  };

  try {
    const content = await readFile(BEAST_GROWTH_PATH, 'utf-8');
    cachedBeastGrowth = JSON.parse(content) as BeastGrowthConfig;
    return cachedBeastGrowth;
  } catch {
    cachedBeastGrowth = defaultGrowth;
    return defaultGrowth;
  }
}

/**
 * 获取灵兽成长参数（同步）。
 */
export function getBeastGrowthConfig(): BeastGrowthConfig {
  if (cachedBeastGrowth === null) {
    throw new Error('Beast growth config not loaded. Call initBeastConfig() first.');
  }
  return cachedBeastGrowth;
}

// ==================== 祭坛配方 ====================

async function loadAltarRecipes(): Promise<readonly AltarRecipeConfig[]> {
  if (cachedAltarRecipes !== null) {
    return cachedAltarRecipes;
  }

  try {
    const content = await readFile(ALTAR_RECIPES_PATH, 'utf-8');
    const parsed = JSON.parse(content) as { recipes: AltarRecipeConfig[] };
    cachedAltarRecipes = parsed.recipes;
    return parsed.recipes;
  } catch {
    cachedAltarRecipes = [];
    return [];
  }
}

/**
 * 获取所有祭坛配方（同步）。
 */
export function getAltarRecipes(): readonly AltarRecipeConfig[] {
  if (cachedAltarRecipes === null) {
    throw new Error('Altar recipes not loaded. Call initBeastConfig() first.');
  }
  return cachedAltarRecipes;
}

// ==================== 初始化 ====================

/**
 * 初始化所有灵兽配置（异步加载）。
 * 应在服务启动时调用。
 */
export async function initBeastConfig(): Promise<void> {
  await Promise.all([
    loadBeastTemplates(),
    loadBeastDefinitions(),
    loadBloodlines(),
    loadBeastGrowth(),
    loadAltarRecipes(),
  ]);

  // 构建索引
  if (cachedBeastTemplates !== null && cachedBeastTemplateIndex === null) {
    cachedBeastTemplateIndex = buildBeastTemplateIndex(cachedBeastTemplates);
  }
  if (cachedBeastDefinitions !== null && cachedBeastDefIndex === null) {
    cachedBeastDefIndex = buildBeastDefIndex(cachedBeastDefinitions);
  }
  if (cachedBloodlines !== null && cachedBloodlineIndex === null) {
    cachedBloodlineIndex = buildBloodlineIndex(cachedBloodlines);
  }
}

/**
 * 清除所有缓存（用于测试）。
 */
export function clearBeastConfigCache(): void {
  cachedBeastTemplates = null;
  cachedBeastTemplateIndex = null;
  cachedBeastDefinitions = null;
  cachedBeastDefIndex = null;
  cachedBloodlines = null;
  cachedBloodlineIndex = null;
  cachedBeastGrowth = null;
  cachedAltarRecipes = null;
}
