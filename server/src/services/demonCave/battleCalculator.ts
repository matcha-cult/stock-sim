/**
 * 锁妖窟战斗计算
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：根据灵兽和怪物属性计算战斗结果
 * 2. 不做什么：不处理战斗动画展示（前端负责）
 *
 * 战斗算法（简化版）：
 * 1. 计算灵兽总战力 = HP + ATK * 2 + DEF * 1.5
 * 2. 计算怪物总战力 = Σ(每只怪物的 HP + ATK * 2 + DEF * 1.5)
 * 3. 比较双方战力，灵兽战力 >= 怪物战力则胜利
 *
 * 关键边界条件与坑点：
 * 1. 当前为简化版算法，后续可扩展为回合制战斗
 * 2. 战力计算权重可调优
 */

import type { BeastDetailDto } from '../beast/shared/beastView.js';
import type { MonsterData } from './algorithm.js';

/**
 * 计算灵兽战力
 */
const calculateBeastPower = (beast: BeastDetailDto): number => {
  const { max_hp, atk, def } = beast.computedAttrs;
  return max_hp + atk * 2 + def * 1.5;
};

/**
 * 计算怪物战力
 */
const calculateMonsterPower = (monster: MonsterData): number => {
  const hp = monster.baseAttrs.max_hp || 0;
  const atk = monster.baseAttrs.atk || 0;
  const def = monster.baseAttrs.def || 0;
  return hp + atk * 2 + def * 1.5;
};

/**
 * 计算战斗结果
 *
 * @param beast - 灵兽详情
 * @param monsters - 怪物列表
 * @returns true 表示胜利，false 表示失败
 */
export const calculateBattleResult = (
  beast: BeastDetailDto,
  monsters: MonsterData[],
): boolean => {
  const beastPower = calculateBeastPower(beast);
  const monsterPower = monsters.reduce((sum, m) => sum + calculateMonsterPower(m), 0);

  return beastPower >= monsterPower;
};

/**
 * 获取战斗详情（用于前端展示）
 */
export const getBattleDetails = (
  beast: BeastDetailDto,
  monsters: MonsterData[],
): {
  beastPower: number;
  monsterPower: number;
  powerDiff: number;
  winRate: number;
} => {
  const beastPower = calculateBeastPower(beast);
  const monsterPower = monsters.reduce((sum, m) => sum + calculateMonsterPower(m), 0);
  const powerDiff = beastPower - monsterPower;
  const totalPower = beastPower + monsterPower;
  const winRate = totalPower > 0 ? (beastPower / totalPower) * 100 : 50;

  return {
    beastPower,
    monsterPower,
    powerDiff,
    winRate,
  };
};
