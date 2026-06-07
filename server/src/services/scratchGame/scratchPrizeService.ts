/**
 * 刮刮乐开奖服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：接收玩家对每张票的选线，计算线和值、查奖级、发奖金、写流水。
 * 2. 不做什么：不处理刮格子逻辑（由 scratchTicketService 负责）、不校验参数（由路由层负责）。
 *
 * 输入 / 输出：
 * - 输入：角色 ID + 每张票的选线 [{ ticketNumber, lineKey }]。
 * - 输出：SettleResultDto（每张票的线、和值、奖级、奖金 + 总计）。
 *
 * 数据流 / 状态流：
 * SELECT FOR UPDATE 锁定所有票 -> 校验状态 ->
 * 对每张票：读 grid_values -> 根据 lineKey 计算 lineSum ->
 * 查 ScratchPrizeConfigCache 匹配奖级 -> UPDATE settled + 奖金字段 ->
 * 如果 totalPrize > 0：角色灵石 += totalPrize, 写流水 -> 返回结果。
 *
 * 复用设计说明：
 * - buildLines 在 scratchTicketTypes.ts 中统一定义。
 * - 奖级查询走 ScratchPrizeConfigCache 内存缓存，不查 DB。
 * - 灵石更新和流水写入复用已有的角色/流水操作模式。
 *
 * 关键边界条件与坑点：
 * 1. 必须在事务内执行（调用方用 @Transactional 包裹）。
 * 2. lineKey 必须存在于 buildLines 结果中，否则抛错。
 * 3. 未中奖时 tierKey='none', tierName='未中奖', prizeAmount=0，仍需写 settled 标记。
 * 4. 奖金发放使用角色表的 spirit_stones 字段 += 操作。
 */
import { query } from '../../config/database.js';
import { Transactional } from '../../decorators/transactional.js';
import { scratchPrizeConfigCache } from './scratchPrizeConfigCache.js';
import {
  buildLines,
  type TicketSettleInput,
  type TicketSettleResult,
  type SettleResultDto,
} from './scratchTicketTypes.js';

const getUtcDay = (): string => new Date().toISOString().slice(0, 10);

class ScratchPrizeService {
  /**
   * 开奖：对当天所有票执行选线结算。
   * 前提：所有票 status == 'completed'，且均未 settled。
   */
  @Transactional
  async settle(
    characterId: number,
    lines: TicketSettleInput[],
  ): Promise<SettleResultDto> {
    const day = getUtcDay();

    // 1. 锁定当天所有票
    const lockResult = await query(
      `SELECT id, ticket_number, status, settled, config_key, grid_size, grid_values
       FROM scratch_ticket
       WHERE character_id = $1 AND day = $2
       ORDER BY ticket_number
       FOR UPDATE`,
      [characterId, day],
    );

    if (lockResult.rows.length === 0) {
      throw new Error('当天没有彩票');
    }

    const allTickets = lockResult.rows;
    const inputTicketNumbers = new Set(lines.map(l => l.ticketNumber));

    // 2. 校验：传入的票必须都存在
    const ticketsToSettle = lines.map((lineInput) => {
      const ticket = allTickets.find(
        (t) => Number(t.ticket_number) === lineInput.ticketNumber,
      );
      if (!ticket) {
        throw new Error(`票号 ${lineInput.ticketNumber} 不存在`);
      }
      return ticket;
    });

    // 3. 校验：传入的票必须全部 completed
    const allTargetCompleted = ticketsToSettle.every((r) => String(r.status) === 'completed');
    if (!allTargetCompleted) {
      throw new Error('选线的票尚未刮完，无法开奖');
    }

    // 4. 校验：传入的票不能有已 settled 的
    const anySettled = ticketsToSettle.some((r) => Boolean(r.settled));
    if (anySettled) {
      throw new Error('选线的票中已有已开奖的');
    }

    // 5. 对传入的每张票执行开奖计算
    const results: TicketSettleResult[] = [];

    for (const lineInput of lines) {
      const ticket = allTickets.find(
        (t) => Number(t.ticket_number) === lineInput.ticketNumber,
      );
      if (!ticket) {
        throw new Error(`票号 ${lineInput.ticketNumber} 不存在`);
      }

      const configKey = String(ticket.config_key);
      const gridSize = Number(ticket.grid_size);
      const gridValues: number[] = ticket.grid_values as number[];

      // 获取线定义
      const allLines = buildLines(gridSize);
      const lineDef = allLines.find(l => l.key === lineInput.lineKey);
      if (!lineDef) {
        throw new Error(`线 "${lineInput.lineKey}" 不存在，可选线: ${allLines.map(l => l.key).join(', ')}`);
      }

      // 计算线和值
      const lineSum = lineDef.indices.reduce((sum, idx) => sum + gridValues[idx], 0);

      // 查奖级
      const prize = scratchPrizeConfigCache.lookupPrize(configKey, lineSum);
      const tierKey = prize?.tierKey ?? 'none';
      const tierName = prize?.tierName ?? '未中奖';
      const prizeAmount = prize?.prizeAmount ?? 0;

      results.push({
        ticketNumber: lineInput.ticketNumber,
        lineKey: lineInput.lineKey,
        lineName: lineDef.name,
        lineSum,
        tierKey,
        tierName,
        prizeAmount,
      });

      // 更新票的开奖信息
      await query(
        `UPDATE scratch_ticket
         SET settled = true, selected_line = $1, line_sum = $2,
             prize_tier = $3, prize_amount = $4, status = 'settled', updated_at = now()
         WHERE id = $5`,
        [lineInput.lineKey, lineSum, tierKey, prizeAmount, String(ticket.id)],
      );
    }

    // 7. 计算总奖金
    const totalPrize = results.reduce((sum, r) => sum + r.prizeAmount, 0);

    // 8. 如果有奖金，更新角色灵石 + 写流水
    if (totalPrize > 0) {
      // 更新角色灵石
      await query(
        `UPDATE characters SET spirit_stones = spirit_stones + $1, updated_at = now() WHERE id = $2`,
        [totalPrize, characterId],
      );

      // 写入流水 memo
      const memoParts = results.map(r =>
        `第${r.ticketNumber}张(${r.lineKey},和值${r.lineSum},${r.tierName})`,
      );
      const memo = `刮刮乐开奖：${memoParts.join('+')}`;

      await query(
        `INSERT INTO character_ledger
          (character_id, biz_type, amount, memo, created_at)
         VALUES ($1, 'scratch_prize', $2, $3, now())`,
        [characterId, totalPrize, memo],
      );
    }

    return {
      settled: true,
      totalPrize,
      tickets: results,
    };
  }
}

export const scratchPrizeService = new ScratchPrizeService();
