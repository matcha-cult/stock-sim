/**
 * 星级显示组件
 *
 * 作用：显示灵兽或怪物的星级
 * 数据流：接收 starLevel 属性 -> 渲染星级图标
 */

import { Tag } from 'antd';
import { StarFilled } from '@ant-design/icons';
import { getStarLevelConfig } from '../services/api/starLevel';

interface StarLevelDisplayProps {
  starLevel: number;
}

export default function StarLevelDisplay({ starLevel }: StarLevelDisplayProps) {
  if (starLevel === 0) {
    return null; // 0 星不显示
  }

  const config = getStarLevelConfig(starLevel);

  return (
    <Tag color={config.color} style={{ marginRight: 0 }}>
      <StarFilled style={{ marginRight: 4 }} />
      {config.name}
    </Tag>
  );
}
