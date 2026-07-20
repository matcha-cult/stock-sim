/**
 * 怪物模板加载器（锁妖窟用）
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：从 data/seeds/demonCave/monster_templates.json 加载怪物模板定义，构建 Map 索引，提供同步 O(1) 查询。
 * 2. 不做什么：不做数据库同步、不做热更新、不持久化。
 *
 * 数据流 / 状态流：
 * 启动时异步加载 JSON → 校验 id 唯一性 → 构建 Map 索引 → 缓存到内存 → 业务模块同步读取。
 *
 * 复用设计说明：
 * - 与 itemConfigLoader / farmConfigLoader / beastConfigLoader 同模式。
 * - Map 索引 O(1) vs O(n) 查询。
 * - 启动即校验，不静默降级。
 *
 * 关键边界条件与坑点：
 * 1. 文件不存在 / JSON 格式错误时直接抛错，启动失败。
 * 2. 必须在应用启动时调用 initMonsterTemplateConfig()。
 * 3. id 必须全局唯一，重复时启动报错。
 */
import { readFile } from 'fs/promises';
import { join } from 'path';

// ==================== 类型定义 ====================

export interface MonsterTemplateBaseAttrs {
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

export interface MonsterTemplateConfig {
  id: string;
  name: string;
  role: '幼兽' | '平衡型' | '攻击型' | '防御型' | '辅助型';
  base_attrs: MonsterTemplateBaseAttrs;
  level_attr_gains: MonsterTemplateBaseAttrs;
}

// ==================== 内存缓存 ====================

let templateById: Map<string, MonsterTemplateConfig> | null = null;
let allTemplates: MonsterTemplateConfig[] | null = null;

const SEED_FILE = join(process.cwd(), 'data/seeds/demonCave/monster_templates.json');

// ==================== 初始化 ====================

export const initMonsterTemplateConfig = async (): Promise<void> => {
  const content = await readFile(SEED_FILE, 'utf-8');
  const data = JSON.parse(content) as { templates: MonsterTemplateConfig[] };

  if (!data.templates || !Array.isArray(data.templates)) {
    throw new Error(`[monsterTemplateLoader] 模板文件格式错误: ${SEED_FILE}`);
  }

  // 校验 id 唯一性
  const idSet = new Set<string>();
  for (const tpl of data.templates) {
    if (!tpl.id) {
      throw new Error(`[monsterTemplateLoader] 模板缺少 id 字段: ${JSON.stringify(tpl)}`);
    }
    if (idSet.has(tpl.id)) {
      throw new Error(`[monsterTemplateLoader] 模板 id 重复: ${tpl.id}`);
    }
    idSet.add(tpl.id);
  }

  // 构建 Map 索引
  templateById = new Map(data.templates.map((t) => [t.id, t]));
  allTemplates = data.templates;

  console.log(`[monsterTemplateLoader] 加载完成: ${allTemplates.length} 个模板定义`);
};

// ==================== 查询接口 ====================

const ensureLoaded = (): void => {
  if (!templateById || !allTemplates) {
    throw new Error('[monsterTemplateLoader] 未初始化，请先调用 initMonsterTemplateConfig()');
  }
};

export const getMonsterTemplateById = (id: string): MonsterTemplateConfig | null => {
  ensureLoaded();
  return templateById!.get(id) ?? null;
};

export const getAllMonsterTemplates = (): MonsterTemplateConfig[] => {
  ensureLoaded();
  return allTemplates!;
};
