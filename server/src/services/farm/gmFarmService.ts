/**
 * GM 灵田查看服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：为 GM 提供按角色 ID 或昵称查询指定玩家灵田数据的能力（总览 + 活动日志）。
 * 2. 不做什么：不做任何写操作、不做权限分级（由路由 requireGm 保证）。
 *
 * 数据流 / 状态流：
 * GM 请求 → 本 service 解析角色（按 characterId 精确匹配，或按 nickname 模糊匹配）
 *         → 复用 farmService 公共方法 → 附加角色信息返回。
 *
 * 复用设计说明：
 * - 总览 / 静态配置 / 活动日志全部复用 farmService 的公共方法，
 *   避免在 GM 侧重复实现 buildCellDto / buildSeedInventoryDto / buildFarmInfoDto 等逻辑。
 * - 静态配置（种子目录 + 作物目录）一并返回，前端无需再次请求 /api/farm/config。
 *
 * 关键边界条件与坑点：
 * 1. 角色不存在时返回 null，由路由层返回 404，前端据此展示"角色不存在"。
 * 2. nickname 查询使用 ILIKE 模糊匹配，仅取 id 最小的一个结果，
 *    避免返回多结果导致前端难以渲染（运维人员需要精确数据时建议使用角色 ID）。
 * 3. 未开垦灵田的玩家（farm_profile 不存在）仍应返回基础结构（reclaimed=false），
 *    由 farmService.getFarmOverview 已处理，本层无需额外判断。
 */
import { query } from '../../config/database.js';
import * as farmService from './farmService.js';
import type { FarmOverviewDto, FarmStaticConfigDto } from './farmTypes.js';
import type { ActivityLogDto } from './farmService.js';

interface CharacterRow {
  id: number;
  nickname: string;
}

export interface GmFarmLookupParams {
  characterId?: number;
  nickname?: string;
}

export interface GmFarmOverviewResult {
  characterId: number;
  nickname: string;
  overview: FarmOverviewDto;
  staticConfig: FarmStaticConfigDto;
}

export interface GmFarmLogResult {
  characterId: number;
  nickname: string;
  logs: ActivityLogDto[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 根据 characterId 精确匹配，或 nickname ILIKE 模糊匹配（取 id 最小的一个）查找角色。
 * 都未提供或匹配不到时返回 null。
 */
async function resolveCharacter(params: GmFarmLookupParams): Promise<CharacterRow | null> {
  if (params.characterId != null && params.characterId > 0) {
    const result = await query<CharacterRow>(
      `SELECT id, nickname FROM characters WHERE id = $1`,
      [params.characterId],
    );
    return result.rows[0] ?? null;
  }

  const trimmed = params.nickname?.trim();
  if (trimmed) {
    const result = await query<CharacterRow>(
      `SELECT id, nickname FROM characters
       WHERE nickname ILIKE $1
       ORDER BY id
       LIMIT 1`,
      [`%${trimmed}%`],
    );
    return result.rows[0] ?? null;
  }

  return null;
}

/**
 * 查询指定角色的灵田总览（含静态配置）。
 * 角色不存在返回 null。
 */
export async function getGmFarmOverview(
  params: GmFarmLookupParams,
): Promise<GmFarmOverviewResult | null> {
  const character = await resolveCharacter(params);
  if (character == null) return null;

  const [overview, staticConfig] = await Promise.all([
    farmService.getFarmOverview(character.id),
    Promise.resolve(farmService.getFarmStaticConfig()),
  ]);

  return {
    characterId: character.id,
    nickname: character.nickname,
    overview,
    staticConfig,
  };
}

/**
 * 查询指定角色的灵田活动日志（分页）。
 * 角色不存在返回 null。
 */
export async function getGmFarmLog(
  params: GmFarmLookupParams,
  page: number,
  pageSize: number,
): Promise<GmFarmLogResult | null> {
  const character = await resolveCharacter(params);
  if (character == null) return null;

  const logResult = await farmService.getFarmLog(character.id, page, pageSize);

  return {
    characterId: character.id,
    nickname: character.nickname,
    logs: logResult.logs,
    total: logResult.total,
    page,
    pageSize,
  };
}
