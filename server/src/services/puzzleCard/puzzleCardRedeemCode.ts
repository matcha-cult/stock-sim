/**
 * 常驻刮刮乐安保码（redeemCode）工具。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：为票据生成安保码（JWT signature 段），兑奖时验证合法性。
 * 2. 不做什么：不处理票据业务逻辑、不操作数据库。
 *
 * 数据流 / 状态流：
 * 购票时 generateRedeemCode(payload) → 取 signature 段 → 返回前端。
 * 兑奖时 verifyRedeemCode(payload, redeemCode) → 重签 → 比对。
 *
 * 复用设计说明：
 * - 复用项目已安装的 jsonwebtoken 库和 JWT_SECRET 环境变量。
 * - payload 字段顺序与 puzzle_card 表字段一一对应，确保重签一致性。
 *
 * 关键边界条件与坑点：
 * 1. JWT_SECRET 必须与 authService 使用同一个环境变量，否则签名不兼容。
 * 2. payload 中的 bigint 需转为 number 再 JSON 序列化（JWT 不支持 bigint）。
 * 3. redeemCode 不含 JWT 头/载荷段，仅 signature，前端无法还原票据内容。
 */
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'stock-sim-secret';

export interface RedeemCodePayload {
  characterId: number;
  ticketNumber: number;
  typeKey: string;
  gridRows: number;
  gridCols: number;
  pricePaid: number;
  ticketData: unknown;
  matchedLines: unknown;
  prizeType: string;
  prizeAmount: number;
}

/**
 * 生成安保码：对 payload 签 JWT，取三段式的最后一段（signature）。
 */
export const generateRedeemCode = (payload: RedeemCodePayload): string => {
  const token = jwt.sign(payload, JWT_SECRET, { noTimestamp: true });
  const parts = token.split('.');
  return parts[2];
};

/**
 * 验证安保码：用相同 payload 重签 JWT，比对 signature 段。
 * 同时验证原始 token 的签名合法性，防止 payload 被篡改后伪造 signature。
 */
export const verifyRedeemCode = (payload: RedeemCodePayload, redeemCode: string): boolean => {
  try {
    const token = jwt.sign(payload, JWT_SECRET, { noTimestamp: true });
    const parts = token.split('.');
    if (parts[2] !== redeemCode) return false;
    // 额外验证：确保生成的 token 本身合法（防御 hmac 比对短路等极端场景）
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
};
