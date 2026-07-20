/**
 * 灵兽技能策略管理（DB 操作）
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：查询、保存灵兽技能释放优先级配置。
 * 2. 不做什么：不处理战斗中的技能释放逻辑。
 *
 * 关键边界条件与坑点：
 * 1) 策略必须在事务内保存：先删旧策略，再批量插入新策略。
 * 2) 天生兽诀不可禁用。
 */
import { query } from '../../../config/database.js';

export interface BeastSkillPolicySlotDto {
  skillId: string;
  priority: number;
  enabled: boolean;
}

/**
 * 查询灵兽的技能策略。
 */
export const loadBeastSkillPolicy = async (beastId: number): Promise<BeastSkillPolicySlotDto[]> => {
  const result = await query<{ skill_id: string; priority: number; enabled: boolean }>(
    `
    SELECT skill_id, priority, enabled
    FROM character_beast_skill_policy
    WHERE beast_id = $1
    ORDER BY priority DESC, id ASC
    `,
    [beastId],
  );
  return result.rows.map((row: { skill_id: string; priority: number; enabled: boolean }) => ({
    skillId: row.skill_id,
    priority: row.priority,
    enabled: row.enabled,
  }));
};

/**
 * 保存灵兽的技能策略（全量替换）。
 * 在事务内先删后插。
 */
export const saveBeastSkillPolicy = async (
  beastId: number,
  slots: BeastSkillPolicySlotDto[],
): Promise<void> => {
  // 删除旧策略
  await query(
    'DELETE FROM character_beast_skill_policy WHERE beast_id = $1',
    [beastId],
  );

  // 批量插入新策略
  if (slots.length === 0) return;

  const values: (string | number | boolean)[] = [];
  const placeholders: string[] = [];
  for (let i = 0; i < slots.length; i++) {
    const offset = i * 4;
    values.push(beastId, slots[i].skillId, slots[i].priority, slots[i].enabled);
    placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
  }

  await query(
    `INSERT INTO character_beast_skill_policy (beast_id, skill_id, priority, enabled) VALUES ${placeholders.join(', ')}`,
    values,
  );
};

/**
 * 校验技能策略输入。
 */
export const normalizeBeastSkillPolicySlots = (
  raw: Array<{ skillId?: string; priority?: number; enabled?: boolean }>,
): BeastSkillPolicySlotDto[] | null => {
  if (!Array.isArray(raw)) return null;

  const slots: BeastSkillPolicySlotDto[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const skillId = typeof entry.skillId === 'string' ? entry.skillId.trim() : '';
    const priority = typeof entry.priority === 'number' ? Math.floor(entry.priority) : 0;
    if (!skillId || priority <= 0 || typeof entry.enabled !== 'boolean') return null;
    slots.push({ skillId, priority, enabled: entry.enabled });
  }
  return slots;
};
