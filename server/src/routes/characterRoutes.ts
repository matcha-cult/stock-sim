/**
 * 角色路由（精简版）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：角色查询、角色创建、角色信息获取。
 * 2. 不做什么：不处理位置更新、自动施法、自动分解等游戏功能。
 *
 * 输入 / 输出：
 * - 输入：用户ID、昵称、性别。
 * - 输出：角色信息。
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { checkCharacter, createCharacter, getCharacter } from '../services/characterService.js';
import { sendResult } from '../middleware/response.js';

const router: RouterType = Router();

// 检查是否有角色
router.get('/check', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const result = await checkCharacter(userId);
  sendResult(res, result);
}));

// 创建角色
router.post('/create', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const { nickname, gender } = req.body as { nickname?: string; gender?: string };

  // 参数验证
  const normalizedNickname = nickname?.trim() ?? '';
  if (!normalizedNickname || !gender) {
    res.status(400).json({ success: false, message: '昵称和性别不能为空' });
    return;
  }

  if (!['male', 'female'].includes(gender)) {
    res.status(400).json({ success: false, message: '性别参数错误' });
    return;
  }

  const result = await createCharacter(userId, normalizedNickname, gender as 'male' | 'female');
  sendResult(res, result);
}));

// 获取角色信息
router.get('/info', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const result = await getCharacter(userId);
  sendResult(res, result);
}));

export default router;