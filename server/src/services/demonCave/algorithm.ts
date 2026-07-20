/**
 * 锁妖窟楼层算法（四层架构版）
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：基于楼层配置生成怪物组合，从模板计算属性，应用楼层配置的属性倍率
 * 2. 不做什么：不读写数据库、不处理战斗逻辑
 *
 * 数据流 / 状态流：
 * demonCaveService -> floorConfigLoader -> monsterConfigLoader -> monsterTemplateLoader -> 计算属性 -> 战斗输入
 *
 * 关键边界条件与坑点：
 * 1. 使用确定性随机（基于楼层号），保证同一楼层怪物组合固定
 * 2. 属性从模板计算：base_attrs + level_attr_gains × (level - 1)
 * 3. 最终属性 = 计算属性 × attr_multiplier（来自楼层配置）
 * 4. 所有属性计算使用高精度库 calculatorjs，避免浮点数误差
 */

import type { MonsterTemplateBaseAttrs } from './monsterTemplateLoader.js';
import { getMonsterTemplateById } from './monsterTemplateLoader.js';
import { getDemonCaveMonsterById } from './monsterConfigLoader.js';
import { getFloorConfig } from './floorConfigLoader.js';
import type { FloorMonsterConfig } from './floorConfigLoader.js';
import { getStarLevelMultiplier } from '../shared/starLevelLoader.js';
import { pickDeterministicItems, pickDeterministicIndex, hashSeed } from '../shared/deterministicHash.js';
import { calc } from 'calculatorjs';

// ==================== 类型定义 ====================

export type DemonCaveFloorKind = 'normal' | 'elite' | 'boss';

export interface MonsterData {
  id: string;
  defId: string;
  name: string;
  starLevel: number;
  level: number;
  element: string[];
  baseAttrs: MonsterTemplateBaseAttrs;
  skills: string[];
  passiveSkills: string[];
  experience: number;
  dropPoolIds: string[];
}

export interface ResolvedDemonCaveFloor {
  floor: number;
  kind: DemonCaveFloorKind;
  monsters: MonsterData[];
  preview: {
    floor: number;
    kind: DemonCaveFloorKind;
    monsterCount: number;
    monsterNames: string[];
  };
}

// ==================== 楼层类型判定 ====================

/**
 * 判断楼层类型
 */
export const getDemonCaveFloorKind = (floor: number): DemonCaveFloorKind => {
  if (floor % 10 === 0) return 'boss';
  if (floor % 5 === 0) return 'elite';
  return 'normal';
};

// ==================== 属性计算 ====================

/**
 * 从模板计算怪物属性
 *
 * 公式：base_attrs + level_attr_gains × (level - 1)
 * 使用高精度计算避免浮点数误差
 */
const calculateMonsterAttrsFromTemplate = (
  templateId: string,
  level: number,
): MonsterTemplateBaseAttrs => {
  const template = getMonsterTemplateById(templateId);
  if (!template) {
    throw new Error(`[algorithm] 模板不存在: ${templateId}`);
  }

  const levelGrowth = level - 1;
  const attrs: MonsterTemplateBaseAttrs = {} as MonsterTemplateBaseAttrs;

  // 遍历所有属性键，使用高精度计算最终值，并取整
  for (const key of Object.keys(template.base_attrs) as Array<keyof MonsterTemplateBaseAttrs>) {
    const baseValue = template.base_attrs[key];
    const gainPerLevel = template.level_attr_gains[key];
    // 使用高精度计算：baseValue + gainPerLevel × levelGrowth，然后取整
    attrs[key] = Math.floor(Number(calc(`${baseValue} + ${gainPerLevel} * ${levelGrowth}`)));
  }

  return attrs;
};

/**
 * 应用属性倍率
 *
 * 使用高精度计算避免浮点数误差
 */
const applyAttrMultiplier = (
  attrs: MonsterTemplateBaseAttrs,
  multiplier: number,
): MonsterTemplateBaseAttrs => {
  const result: MonsterTemplateBaseAttrs = {} as MonsterTemplateBaseAttrs;
  for (const key of Object.keys(attrs) as Array<keyof MonsterTemplateBaseAttrs>) {
    // 使用高精度计算：attrs[key] × multiplier，然后取整
    result[key] = Math.floor(Number(calc(`${attrs[key]} * ${multiplier}`)));
  }
  return result;
};

// ==================== 怪物选择 ====================

/**
 * 确定性有放回选择（允许重复）
 *
 * 从候选池中按种子选择 count 个元素，同一元素可被重复选中
 */
const pickDeterministicWithReplacement = <T>(
  items: T[],
  count: number,
  seed: string,
): T[] => {
  if (items.length === 0 || count <= 0) return [];
  const result: T[] = [];
  for (let i = 0; i < count; i++) {
    const index = pickDeterministicIndex(seed, items.length, i);
    result.push(items[index]);
  }
  return result;
};

// ==================== 楼层解析 ====================

/**
 * 解析指定楼层的怪物组合
 *
 * 从楼层配置读取怪物池，按 composition 规则选择怪物，从模板计算属性
 *
 * @param floor - 楼层号
 * @param beastCount - 我方灵兽数量（当前未使用，保留扩展）
 */
export const resolveDemonCaveFloor = (floor: number, beastCount: number = 1): ResolvedDemonCaveFloor => {
  const normalizedFloor = Math.max(1, Math.floor(floor));
  const kind = getDemonCaveFloorKind(normalizedFloor);
  const seed = `demon-cave-${normalizedFloor}`;

  // 获取楼层配置
  const floorConfig = getFloorConfig(normalizedFloor);
  if (!floorConfig) {
    throw new Error(`[algorithm] 第 ${normalizedFloor} 层配置不存在`);
  }

  const { monster_pool, composition } = floorConfig;

  // 按 rarity 分组
  const normalPool = monster_pool.filter((m) => m.rarity === 'normal');
  const elitePool = monster_pool.filter((m) => m.rarity === 'elite');
  const bossPool = monster_pool.filter((m) => m.rarity === 'boss');

  let selectedConfigs: FloorMonsterConfig[];

  if (kind === 'boss') {
    // BOSS 层：保底 BOSS + 精英 + 普通
    const boss = bossPool.length > 0 ? pickDeterministicItems(bossPool, 1, `${seed}-boss`) : [];
    const elite = elitePool.length > 0 ? pickDeterministicItems(elitePool, 1, `${seed}-elite`) : [];
    const remaining = composition.count - boss.length - elite.length;
    const normal = normalPool.length > 0 ? pickDeterministicWithReplacement(normalPool, remaining, `${seed}-normal`) : [];
    selectedConfigs = [...boss, ...elite, ...normal];
  } else if (kind === 'elite') {
    // 精英层：保底精英 + 普通
    const elite = elitePool.length > 0 ? pickDeterministicItems(elitePool, 1, `${seed}-elite`) : [];
    const remaining = composition.count - elite.length;
    const normal = normalPool.length > 0 ? pickDeterministicWithReplacement(normalPool, remaining, `${seed}-normal`) : [];
    selectedConfigs = [...elite, ...normal];
  } else {
    // 普通层：从普通池中随机选择
    selectedConfigs = pickDeterministicWithReplacement(normalPool, composition.count, `${seed}-fill`);
  }

  // 处理保底规则
  if (composition.guarantee) {
    for (const guarantee of composition.guarantee) {
      const guaranteeMonster = monster_pool.find((m) => m.monster_id === guarantee.monster_id);
      if (guaranteeMonster) {
        // 检查是否已经选中
        const existingCount = selectedConfigs.filter((m) => m.monster_id === guarantee.monster_id).length;
        const needed = guarantee.count - existingCount;
        if (needed > 0) {
          for (let i = 0; i < needed; i++) {
            selectedConfigs.push(guaranteeMonster);
          }
        }
      }
    }
  }

  // 构建战斗用怪物数据
  // 为重复名字的怪物添加序号（唯一的不加序号）
  const nameCountMap = new Map<string, number>();
  for (const config of selectedConfigs) {
    const monsterDef = getDemonCaveMonsterById(config.monster_id);
    if (monsterDef) {
      const displayName = config.title || monsterDef.name;
      nameCountMap.set(displayName, (nameCountMap.get(displayName) || 0) + 1);
    }
  }

  const nameCurrentIndex = new Map<string, number>();
  const monsters: MonsterData[] = selectedConfigs.map((config, index) => {
    const monsterDef = getDemonCaveMonsterById(config.monster_id);
    if (!monsterDef) {
      throw new Error(`[algorithm] 怪物不存在: ${config.monster_id}`);
    }

    // 从模板计算基础属性
    const templateAttrs = calculateMonsterAttrsFromTemplate(monsterDef.template_id, config.level);

    // 应用属性倍率（楼层倍率 × 星级倍率）
    const starMultiplier = getStarLevelMultiplier(config.star_level);
    const finalMultiplier = config.attr_multiplier * starMultiplier;
    const scaledAttrs = applyAttrMultiplier(templateAttrs, finalMultiplier);

    // 确定显示名称
    const displayName = config.title || monsterDef.name;
    const totalCount = nameCountMap.get(displayName) || 1;
    let finalName = displayName;
    if (totalCount > 1) {
      const currentIndex = (nameCurrentIndex.get(displayName) || 0) + 1;
      nameCurrentIndex.set(displayName, currentIndex);
      finalName = `${displayName}${currentIndex}`;
    }

    return {
      id: `${config.monster_id}-${index}`,
      defId: config.monster_id,
      name: finalName,
      starLevel: config.star_level,
      level: config.level,
      element: monsterDef.element,
      baseAttrs: scaledAttrs,
      skills: [], // TODO: 从配置加载技能
      passiveSkills: [],
      experience: config.experience,
      dropPoolIds: config.drop_pool_ids,
    };
  });

  return {
    floor: normalizedFloor,
    kind,
    monsters,
    preview: {
      floor: normalizedFloor,
      kind,
      monsterCount: selectedConfigs.length,
      monsterNames: [...new Set(selectedConfigs.map((config) => {
        const monsterDef = getDemonCaveMonsterById(config.monster_id);
        return config.title || (monsterDef?.name ?? '');
      }))],
    },
  };
};
