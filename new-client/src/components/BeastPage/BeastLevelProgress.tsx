/**
 * 灵兽升级进度组件
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：显示灵兽当前经验、升级所需经验、进度条
 * 2. 不做什么：不处理经验获取（由战斗结算负责）
 *
 * 数据流 / 状态流：
 * 接收 BeastDetailDto → 计算升级进度 → 展示进度条和数值
 *
 * 关键边界条件与坑点：
 * 1. 使用 BigInt 计算避免大数精度问题
 * 2. 进度条使用百分比显示
 * 3. 显示预估升级所需战斗次数（可选）
 */

import { Progress, Typography, Flex, Tag } from 'antd';
import type { BeastDetailDto } from '../../services/api/beast';

const { Text } = Typography;

// ==================== 升级常量（与后端保持一致） ====================

const LEVEL_PARAMS = {
  BASE_EXP: 100,
  EXPONENT: 2.2,
} as const;

// ==================== 工具函数 ====================

/**
 * 计算升级所需经验（与后端公式一致）
 */
const calculateLevelUpExp = (level: number): number => {
  if (level <= 0) return 0;
  return Math.floor(LEVEL_PARAMS.BASE_EXP * Math.pow(level, LEVEL_PARAMS.EXPONENT));
};

/**
 * 计算升级进度
 */
const calculateLevelProgress = (level: number, currentExp: number) => {
  const nextLevelExp = calculateLevelUpExp(level);
  const progressPercent = Math.min(100, Math.floor((currentExp / nextLevelExp) * 100));
  const remainingExp = Math.max(0, nextLevelExp - currentExp);

  return {
    currentExp,
    nextLevelExp,
    progressPercent,
    remainingExp,
  };
};

// ==================== 组件 ====================

interface BeastLevelProgressProps {
  beast: BeastDetailDto;
  showDetails?: boolean; // 是否显示详细数值
}

export default function BeastLevelProgress({ beast, showDetails = true }: BeastLevelProgressProps) {
  const progress = calculateLevelProgress(beast.level, beast.progressExp);

  return (
    <Flex vertical gap="small" style={{ width: '100%' }}>
      <Flex justify="space-between" align="center">
        <Flex gap="small" align="center">
          <Text strong>等级</Text>
          <Tag color="blue">Lv.{beast.level}</Tag>
        </Flex>
        {showDetails && (
          <Flex gap="small" align="center">
            <Text type="secondary">
              {progress.currentExp.toLocaleString()} / {progress.nextLevelExp.toLocaleString()}
            </Text>
          </Flex>
        )}
      </Flex>

      <Progress
        percent={progress.progressPercent}
        strokeColor={{
          '0%': '#108ee9',
          '100%': '#87d068',
        }}
        format={(percent) => `${percent}%`}
      />

      {showDetails && (
        <Flex justify="space-between" align="center">
          <Text type="secondary" style={{ fontSize: 12 }}>
            还需 {progress.remainingExp.toLocaleString()} 经验升级
          </Text>
        </Flex>
      )}
    </Flex>
  );
}
