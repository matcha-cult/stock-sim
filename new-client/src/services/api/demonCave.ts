/**
 * 锁妖窟 API 服务
 */

import api from './core.js';
import type { BeastDetailDto } from './beast.js';

// ==================== 类型定义 ====================

export interface DemonCaveProgressDto {
  beastIds: number[];
  beastNames: string[];
  bestFloor: number;
  currentFloor: number;
  currentRunId: string | null;
  currentBattleId: string | null;
  lastSettledFloor: number;
  isIdling: boolean;
  idleFloor: number | null;
  idleStartedAt: string | null;
}

export interface DemonCaveFloorPreviewDto {
  floor: number;
  kind: 'normal' | 'elite' | 'boss';
  monsterCount: number;
  monsterNames: string[];
}

export interface DemonCaveOverviewDto {
  progress: DemonCaveProgressDto;
  beasts: BeastDetailDto[];
  floorPreview: DemonCaveFloorPreviewDto;
  isMaxFloorReached: boolean;
  ongoingBattle?: DemonCaveChallengeStartDto;
}

export interface MonsterDataDto {
  id: string;
  defId: string;
  name: string;
  starLevel: number;
  level: number;
  element: string[];
  baseAttrs: Record<string, number>;
  skills: string[];
  passiveSkills: string[];
}

export interface DemonCaveChallengeStartDto {
  runId: string;
  floor: number;
  kind: 'normal' | 'elite' | 'boss';
  beasts: BeastDetailDto[];
  monsters: MonsterDataDto[];
  battleResult: {
    success: boolean;
    rounds: number;
    reason: 'victory' | 'defeat' | 'timeout';
    experience: string;
    battleLogs: Array<{
      round: number;
      attacker: string;
      defender: string;
      action: string;
      damage?: number;
      remainingHp?: number;
      isCrit?: boolean;
      isParry?: boolean;
      isElementBonus?: boolean;
      message: string;
    }>;
  };
}

export interface DemonCaveChallengeSettleDto {
  success: boolean;
  bestFloor: number;
  currentFloor: number;
  battleDetails: {
    beastPower: number;
    monsterPower: number;
    powerDiff: number;
    winRate: number;
    rounds: number;
    reason: 'victory' | 'defeat' | 'timeout';
  };
  experienceReward?: string;
  totalExperience?: string;
}

// ==================== API 方法 ====================

/**
 * 获取锁妖窟概览
 */
export const getDemonCaveOverview = () => {
  return api.get<DemonCaveOverviewDto>('/api/demon-cave/overview');
};

/**
 * 预览指定楼层
 */
export const previewDemonCaveFloor = (floor: number) => {
  return api.get<DemonCaveFloorPreviewDto>(`/api/demon-cave/floor-preview?floor=${floor}`);
};

/**
 * 设置出战灵兽队伍
 */
export const setDemonCaveBeastTeam = (beastIds: number[]) => {
  return api.post<DemonCaveProgressDto>('/api/demon-cave/set-beast-team', { beastIds });
};

/**
 * 开始挑战指定层
 */
export const startDemonCaveChallenge = (floor?: number) => {
  return api.post<DemonCaveChallengeStartDto>('/api/demon-cave/challenge/start', { floor });
};

/**
 * 结算挑战（战斗结果由服务端计算）
 */
export const settleDemonCaveChallenge = (runId: string) => {
  return api.post<DemonCaveChallengeSettleDto>('/api/demon-cave/challenge/settle', { runId });
};

/**
 * 放弃当前挑战（清理 currentRunId）
 */
export const abandonDemonCaveChallenge = () => {
  return api.post<DemonCaveProgressDto>('/api/demon-cave/challenge/abandon', {});
};

/**
 * 开始挂机
 */
export const startDemonCaveIdle = (floor: number) => {
  return api.post<DemonCaveProgressDto>('/api/demon-cave/idle/start', { floor });
};

/**
 * 停止挂机
 */
export const stopDemonCaveIdle = () => {
  return api.post<{
    progress: DemonCaveProgressDto;
  }>('/api/demon-cave/idle/stop', {});
};

/**
 * 获取挂机战斗日志
 */
export interface IdleHistoryRecord {
  id: number;
  beastNames: string[];
  floor: number;
  status: 'active' | 'completed';
  idleStartedAt: string;
  idleEndedAt: string | null;
  durationSeconds: number | null;
  durationText: string;
  totalBattles: number | null;
  victoryCount: number;
  defeatCount: number;
  timeoutCount: number;
  totalExperience: string;
}

export const getIdleHistory = (limit: number = 20, offset: number = 0) => {
  return api.get<{ history: IdleHistoryRecord[]; total: number }>(
    `/api/demon-cave/idle/history?limit=${limit}&offset=${offset}`,
  );
};

/**
 * 战斗日志条目
 */
export interface BattleLogEntry {
  round: number;
  attacker: string;
  defender: string;
  action: string;
  damage?: number;
  remainingHp?: number;
  isCrit?: boolean;
  isParry?: boolean;
  isElementBonus?: boolean;
  message: string;
}

/**
 * 获取挂机战斗日志（不包含详细战斗日志）
 */
export interface IdleBattleLog {
  id: number;
  battleIndex: number;
  result: 'victory' | 'defeat' | 'timeout';
  rounds: number;
  experience: string;
}

export const getIdleBattleLogs = (historyId: number, limit: number = 20, offset: number = 0) => {
  return api.get<{ logs: IdleBattleLog[]; total: number; limit: number; offset: number }>(
    `/api/demon-cave/idle/battle-logs/${historyId}?limit=${limit}&offset=${offset}`,
  );
};

/**
 * 获取单场战斗的详细日志
 */
export interface IdleBattleLogDetail {
  battleIndex: number;
  result: 'victory' | 'defeat' | 'timeout';
  rounds: number;
  experience: string;
  battleLogs: BattleLogEntry[];
}

export const getIdleBattleLogDetail = (battleLogId: number) => {
  return api.get<IdleBattleLogDetail>(`/api/demon-cave/idle/battle-log/${battleLogId}`);
};

// ==================== 掉落记录 ====================

/**
 * 掉落记录（明细）
 */
export interface DropLog {
  id: string;
  historyId: number | null;
  sourceType: string;
  floor: number;
  itemKey: string;
  quantity: number;
  createdAt: number;
}

/**
 * 掉落记录汇总（按物品）
 */
export interface DropLogSummary {
  itemKey: string;
  totalQuantity: number;
  maxFloor: number;
}

/**
 * 获取指定挂机历史的掉落记录（按物品汇总）
 */
export const getDropLogsByHistoryId = (historyId: number) => {
  return api.get<DropLogSummary[]>(`/api/demon-cave/drop-logs/${historyId}`);
};

/**
 * 获取角色最近的掉落记录
 */
export const getRecentDropLogs = (limit: number = 20, offset: number = 0) => {
  return api.get<{ drops: DropLog[]; total: number }>(
    `/api/demon-cave/recent-drop-logs?limit=${limit}&offset=${offset}`,
  );
};
