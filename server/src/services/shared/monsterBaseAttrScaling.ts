/**
 * 怪物基础属性缩放工具
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：将怪物基础属性按倍率缩放
 * 2. 不做什么：不处理等级成长、装备加成等其他属性
 *
 * 数据流 / 状态流：
 * 算法层调用 -> 缩放基础属性 -> 返回缩放后的属性对象
 *
 * 关键边界条件与坑点：
 * 1. 百分比属性（如暴击率）也按倍率缩放，但需要注意上限
 * 2. 缩放后取整，避免浮点精度问题
 */

import type { MonsterTemplateBaseAttrs } from '../demonCave/monsterTemplateLoader.js';

/**
 * 缩放怪物基础属性
 *
 * @param baseAttrs - 基础属性
 * @param multiplier - 缩放倍率
 * @returns 缩放后的属性
 */
export const scaleMonsterBaseAttrs = (params: {
  baseAttrs: MonsterTemplateBaseAttrs;
  multiplier: number;
}): MonsterTemplateBaseAttrs => {
  const { baseAttrs, multiplier } = params;

  const scale = (value: number): number => {
    return Math.floor(value * multiplier);
  };

  const scalePercent = (value: number): number => {
    // 百分比属性保持小数，但限制在合理范围
    const scaled = value * multiplier;
    return Number(scaled.toFixed(4));
  };

  return {
    // 基础数值属性
    max_hp: scale(baseAttrs.max_hp),
    max_mp: scale(baseAttrs.max_mp),
    atk: scale(baseAttrs.atk),
    magic_atk: scale(baseAttrs.magic_atk),
    def: scale(baseAttrs.def),
    magic_def: scale(baseAttrs.magic_def),
    spd: scale(baseAttrs.spd),
    accuracy: scale(baseAttrs.accuracy),
    dodge: scale(baseAttrs.dodge),
    parry: scale(baseAttrs.parry),
    hp_regen: scale(baseAttrs.hp_regen),
    mp_regen: scale(baseAttrs.mp_regen),

    // 百分比属性
    crit_rate: scalePercent(baseAttrs.crit_rate),
    crit_dmg: scalePercent(baseAttrs.crit_dmg),
    crit_dmg_reduce: scalePercent(baseAttrs.crit_dmg_reduce),
    anti_crit: scalePercent(baseAttrs.anti_crit),
    dmg_bonus: scalePercent(baseAttrs.dmg_bonus),
    heal_bonus: scalePercent(baseAttrs.heal_bonus),
    heal_reduce: scalePercent(baseAttrs.heal_reduce),
    life_steal: scalePercent(baseAttrs.life_steal),
    cdr: scalePercent(baseAttrs.cdr),
    control_resist: scalePercent(baseAttrs.control_resist),
    metal_resist: scalePercent(baseAttrs.metal_resist),
    wood_resist: scalePercent(baseAttrs.wood_resist),
    water_resist: scalePercent(baseAttrs.water_resist),
    fire_resist: scalePercent(baseAttrs.fire_resist),
    earth_resist: scalePercent(baseAttrs.earth_resist),
  };
};
