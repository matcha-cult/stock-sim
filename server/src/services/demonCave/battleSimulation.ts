/**
 * 锁妖窟自动战斗模拟系统（参考九州项目）
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：模拟完整战斗过程，返回战斗日志
 * 2. 不做什么：不处理战斗动画（前端负责）
 *
 * 战斗规则（与九州项目一致）：
 * 1. 回合制：按速度排序出手
 * 2. 伤害公式：damage = ATK × K / (DEF + K)，K = 1200
 * 3. 命中判定：命中 - 闪避，限制 20% ~ 100%
 * 4. 暴击判定：暴击 - 抗暴，最大 100%
 * 5. 招架判定：最大 60%，减伤 70%
 * 6. 五行克制：15% 增伤
 * 7. 五行抗性：最大 80% 减伤
 * 8. 最大回合数：100 回合，超过则失败
 *
 * 关键边界条件与坑点：
 * 1. 所有概率判定使用九州项目的随机算法
 * 2. 暴击伤害上限 3 倍（怪物）
 * 3. 防御减伤使用 diminishing returns，避免免疫伤害
 * 4. 所有数值计算使用高精度库（calculatorjs）避免浮点数误差
 */

import type { BeastDetailDto } from '../beast/shared/beastView.js';
import type { MonsterData } from './algorithm.js';
import { calc } from 'calculatorjs';

// ==================== 战斗常量（参考九州项目） ====================

const BATTLE_CONSTANTS = {
  MAX_ROUNDS: 100, // PVE 最大回合数

  MIN_HIT_RATE: 0.2,
  MAX_HIT_RATE: 1,
  MAX_PARRY_RATE: 0.6,
  PARRY_REDUCTION: 0.7, // 招架减伤 70%

  MAX_CRIT_RATE: 1,
  MONSTER_MAX_CRIT_DAMAGE_MULTIPLIER: 3,

  ELEMENT_COUNTER_BONUS: 0.15, // 五行克制增伤 15%
  MAX_ELEMENT_RESIST: 0.8, // 五行抗性上限 80%

  DEFENSE_DAMAGE_K: 1200, // 防御公式常量

  // 五行克制关系
  ELEMENT_COUNTER: {
    jin: 'mu', // 金克木
    mu: 'tu', // 木克土
    tu: 'shui', // 土克水
    shui: 'huo', // 水克火
    huo: 'jin', // 火克金
  } as Record<string, string>,
} as const;

// ==================== 战斗单位接口 ====================

interface CombatUnit {
  id: string;
  name: string;
  side: 'beast' | 'monster';
  qixue: number; // 气血（HP）
  maxQixue: number;
  wugong: number; // 物攻
  fagong: number; // 法攻
  wufang: number; // 物防
  fafang: number; // 法防
  sudu: number; // 速度
  mingzhong: number; // 命中
  shanbi: number; // 闪避
  zhaojia: number; // 招架
  baoji: number; // 暴击
  baoshang: number; // 暴伤
  jianbaoshang: number; // 减暴伤
  kangbao: number; // 抗暴
  zengshang: number; // 增伤
  element: string; // 五行属性
  // 五行抗性
  jin_kangxing: number;
  mu_kangxing: number;
  shui_kangxing: number;
  huo_kangxing: number;
  tu_kangxing: number;
}

// ==================== 战斗日志 ====================

export interface BattleLogEntry {
  round: number;
  attacker: string;
  defender: string;
  action: 'attack' | 'miss' | 'parry' | 'critical' | 'death';
  damage?: number;
  remainingHp?: number;
  isCrit?: boolean;
  isParry?: boolean;
  isElementBonus?: boolean;
  message: string;
}

export interface BattleResult {
  success: boolean;
  rounds: number;
  logs: BattleLogEntry[];
  reason: 'victory' | 'defeat' | 'timeout';
}

// ==================== 工具函数 ====================

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

/**
 * 概率判定（参考九州项目）
 */
const rollChance = (rate: number): boolean => {
  return Math.random() < rate;
};

// ==================== 单位创建 ====================

/**
 * 创建灵兽战斗单位
 */
const createBeastUnit = (beast: BeastDetailDto): CombatUnit => {
  return {
    id: `beast_${beast.id}`,
    name: beast.name,
    side: 'beast',
    qixue: beast.computedAttrs.max_hp,
    maxQixue: beast.computedAttrs.max_hp,
    wugong: beast.computedAttrs.atk,
    fagong: beast.computedAttrs.magic_atk,
    wufang: beast.computedAttrs.def,
    fafang: beast.computedAttrs.magic_def,
    sudu: beast.computedAttrs.spd,
    mingzhong: beast.computedAttrs.accuracy * 100, // 百分比转绝对值
    shanbi: beast.computedAttrs.dodge * 100, // 百分比转绝对值
    zhaojia: beast.computedAttrs.parry * 100, // 百分比转绝对值
    baoji: beast.computedAttrs.crit_rate * 100, // 百分比转绝对值
    baoshang: beast.computedAttrs.crit_dmg,
    jianbaoshang: 0, // 灵兽暂无减暴伤
    kangbao: beast.computedAttrs.anti_crit * 100, // 百分比转绝对值
    zengshang: beast.computedAttrs.dmg_bonus,
    element: beast.element[0] || 'none',
    jin_kangxing: beast.computedAttrs.metal_resist,
    mu_kangxing: beast.computedAttrs.wood_resist,
    shui_kangxing: beast.computedAttrs.water_resist,
    huo_kangxing: beast.computedAttrs.fire_resist,
    tu_kangxing: beast.computedAttrs.earth_resist,
  };
};

/**
 * 创建怪物战斗单位
 */
const createMonsterUnit = (monster: MonsterData, index: number): CombatUnit => {
  return {
    id: `monster_${index}`,
    name: monster.name,
    side: 'monster',
    qixue: monster.baseAttrs.max_hp,
    maxQixue: monster.baseAttrs.max_hp,
    wugong: monster.baseAttrs.atk,
    fagong: monster.baseAttrs.magic_atk,
    wufang: monster.baseAttrs.def,
    fafang: monster.baseAttrs.magic_def,
    sudu: monster.baseAttrs.spd,
    mingzhong: monster.baseAttrs.accuracy,
    shanbi: monster.baseAttrs.dodge,
    zhaojia: monster.baseAttrs.parry,
    baoji: monster.baseAttrs.crit_rate,
    baoshang: monster.baseAttrs.crit_dmg,
    jianbaoshang: 0,
    kangbao: monster.baseAttrs.anti_crit,
    zengshang: monster.baseAttrs.dmg_bonus,
    element: monster.element[0] || 'none',
    jin_kangxing: monster.baseAttrs.metal_resist,
    mu_kangxing: monster.baseAttrs.wood_resist,
    shui_kangxing: monster.baseAttrs.water_resist,
    huo_kangxing: monster.baseAttrs.fire_resist,
    tu_kangxing: monster.baseAttrs.earth_resist,
  };
};

// ==================== 伤害计算（参考九州项目） ====================

/**
 * 计算防御减伤率
 *
 * 公式：减伤率 = 防御 / (防御 + K)
 * 最终伤害 = 原始伤害 × (1 - 减伤率)
 * 使用高精度计算避免浮点数误差
 */
const calculateDefenseReductionRate = (defense: number, ignoreRate = 0): number => {
  const safeDefense = Math.max(0, defense);
  const safeIgnoreRate = Math.max(0, Math.min(1, ignoreRate));
  // 使用高精度计算：effectiveDefense = safeDefense × (1 - safeIgnoreRate)
  const effectiveDefense = Number(calc(`${safeDefense} * (1 - ${safeIgnoreRate})`));
  // 使用高精度计算：denominator = effectiveDefense + K
  const denominator = Number(calc(`${effectiveDefense} + ${BATTLE_CONSTANTS.DEFENSE_DAMAGE_K}`));

  if (denominator <= 0) return 0;
  // 使用高精度计算：effectiveDefense / denominator
  return Number(calc(`${effectiveDefense} / ${denominator}`));
};

/**
 * 判断五行克制
 */
const isElementCounter = (attackElement: string, defendElement: string): boolean => {
  if (!attackElement || !defendElement || attackElement === 'none' || defendElement === 'none') {
    return false;
  }
  return BATTLE_CONSTANTS.ELEMENT_COUNTER[attackElement] === defendElement;
};

/**
 * 获取五行抗性
 */
const getElementResistance = (unit: CombatUnit, element: string): number => {
  if (!element || element === 'none') return 0;

  const resistanceMap: Record<string, keyof CombatUnit> = {
    jin: 'jin_kangxing',
    mu: 'mu_kangxing',
    shui: 'shui_kangxing',
    huo: 'huo_kangxing',
    tu: 'tu_kangxing',
  };

  const key = resistanceMap[element];
  return key ? (unit[key] as number) || 0 : 0;
};

/**
 * 计算伤害（参考九州项目）
 * 使用高精度计算避免浮点数误差
 */
const calculateDamage = (
  attacker: CombatUnit,
  defender: CombatUnit,
): { damage: number; isMiss: boolean; isParry: boolean; isCrit: boolean; isElementBonus: boolean } => {
  const result = {
    damage: 0,
    isMiss: false,
    isParry: false,
    isCrit: false,
    isElementBonus: false,
  };

  // 基础伤害（使用物攻）
  let damage = Math.max(0, attacker.wugong);
  if (damage <= 0) return result;

  // 1. 命中判定
  const hitRate = clamp(
    Number(calc(`${attacker.mingzhong} - ${defender.shanbi}`)),
    BATTLE_CONSTANTS.MIN_HIT_RATE,
    BATTLE_CONSTANTS.MAX_HIT_RATE,
  );

  if (!rollChance(hitRate)) {
    result.isMiss = true;
    return result;
  }

  // 2. 防御减伤
  const reductionRate = calculateDefenseReductionRate(defender.wufang);
  // 使用高精度计算：damage × (1 - reductionRate)
  damage = Number(calc(`${damage} * (1 - ${reductionRate})`));

  // 3. 招架判定
  const parryRate = Math.min(defender.zhaojia, BATTLE_CONSTANTS.MAX_PARRY_RATE);
  if (rollChance(parryRate)) {
    result.isParry = true;
    // 使用高精度计算：damage × PARRY_REDUCTION
    damage = Number(calc(`${damage} * ${BATTLE_CONSTANTS.PARRY_REDUCTION}`));
  }

  // 4. 暴击判定
  const critRate = clamp(
    Number(calc(`${attacker.baoji} - ${defender.kangbao}`)),
    0,
    BATTLE_CONSTANTS.MAX_CRIT_RATE,
  );

  if (rollChance(critRate)) {
    result.isCrit = true;
    // 暴击伤害 = 暴伤 - 减暴伤，怪物上限 3 倍
    const critDamageMultiplier = Math.max(
      1,
      Number(calc(`${Math.min(attacker.baoshang, BATTLE_CONSTANTS.MONSTER_MAX_CRIT_DAMAGE_MULTIPLIER)} - ${defender.jianbaoshang}`)),
    );
    // 使用高精度计算：damage × critDamageMultiplier
    damage = Number(calc(`${damage} * ${critDamageMultiplier}`));
  }

  // 5. 增伤加成
  // 使用高精度计算：damage × (1 + zengshang)
  damage = Number(calc(`${damage} * (1 + ${attacker.zengshang})`));

  // 6. 五行克制
  if (isElementCounter(attacker.element, defender.element)) {
    result.isElementBonus = true;
    // 使用高精度计算：damage × (1 + ELEMENT_COUNTER_BONUS)
    damage = Number(calc(`${damage} * (1 + ${BATTLE_CONSTANTS.ELEMENT_COUNTER_BONUS})`));
  }

  // 7. 五行抗性
  const resistance = getElementResistance(defender, attacker.element);
  const cappedResistance = Math.min(resistance, BATTLE_CONSTANTS.MAX_ELEMENT_RESIST);
  // 使用高精度计算：damage × (1 - cappedResistance)
  damage = Number(calc(`${damage} * (1 - ${cappedResistance})`));

  // 最终伤害取整，最低 1 点
  result.damage = Math.floor(Math.max(1, damage));

  return result;
};

// ==================== 战斗模拟 ====================

/**
 * 模拟完整战斗（多灵兽 vs 多怪物）
 *
 * @param beasts - 灵兽详情列表（1-4 只）
 * @param monsters - 怪物列表
 * @returns 战斗结果（胜负、回合数、日志）
 */
export const simulateBattle = (
  beasts: BeastDetailDto[],
  monsters: MonsterData[],
): BattleResult => {
  // 创建战斗单位
  const beastUnits = beasts.map((b) => createBeastUnit(b));
  const monsterUnits = monsters.map((m, i) => createMonsterUnit(m, i));

  const logs: BattleLogEntry[] = [];
  let round = 0;

  // 战斗循环
  while (round < BATTLE_CONSTANTS.MAX_ROUNDS) {
    round++;

    // 检查战斗是否结束
    const aliveBeasts = beastUnits.filter((u) => u.qixue > 0);
    const aliveMonsters = monsterUnits.filter((u) => u.qixue > 0);

    if (aliveBeasts.length === 0) {
      return {
        success: false,
        rounds: round - 1,
        logs,
        reason: 'defeat',
      };
    }

    if (aliveMonsters.length === 0) {
      return {
        success: true,
        rounds: round - 1,
        logs,
        reason: 'victory',
      };
    }

    // 收集所有存活单位，按速度排序
    const allUnits = [...beastUnits, ...monsterUnits]
      .filter((u) => u.qixue > 0)
      .sort((a, b) => b.sudu - a.sudu);

    // 每个单位行动
    for (const unit of allUnits) {
      if (unit.qixue <= 0) continue;

      // 选择目标：灵兽打怪物，怪物打灵兽
      const targets = (unit.side === 'beast' ? monsterUnits : beastUnits).filter(
        (u) => u.qixue > 0,
      );

      if (targets.length === 0) break;

      // 随机选择目标
      const target = targets[Math.floor(Math.random() * targets.length)];

      // 计算伤害
      const damageResult = calculateDamage(unit, target);

      // 闪避
      if (damageResult.isMiss) {
        logs.push({
          round,
          attacker: unit.name,
          defender: target.name,
          action: 'miss',
          message: `${unit.name} 攻击 ${target.name}，但被闪避了！`,
        });
        continue;
      }

      // 应用伤害（确保 HP 为整数）
      target.qixue = Math.max(0, Math.floor(target.qixue - damageResult.damage));

      // 生成日志
      let action: BattleLogEntry['action'] = 'attack';
      if (damageResult.isCrit) action = 'critical';
      else if (damageResult.isParry) action = 'parry';

      let message = '';
      if (damageResult.isCrit) {
        message = `${unit.name} 对 ${target.name} 造成暴击！伤害：${damageResult.damage}`;
      } else if (damageResult.isParry) {
        message = `${unit.name} 攻击 ${target.name}，被招架！伤害：${damageResult.damage}`;
      } else {
        message = `${unit.name} 攻击 ${target.name}，造成 ${damageResult.damage} 点伤害`;
      }

      if (damageResult.isElementBonus) {
        message += '（五行克制）';
      }

      message += `（剩余 HP：${target.qixue}）`;

      logs.push({
        round,
        attacker: unit.name,
        defender: target.name,
        action,
        damage: damageResult.damage,
        remainingHp: target.qixue,
        isCrit: damageResult.isCrit,
        isParry: damageResult.isParry,
        isElementBonus: damageResult.isElementBonus,
        message,
      });

      // 检查目标是否死亡
      if (target.qixue <= 0) {
        logs.push({
          round,
          attacker: target.name,
          defender: target.name,
          action: 'death',
          message: `${target.name} 被击败！`,
        });
      }
    }
  }

  // 超过最大回合数
  return {
    success: false,
    rounds: BATTLE_CONSTANTS.MAX_ROUNDS,
    logs,
    reason: 'timeout',
  };
};
