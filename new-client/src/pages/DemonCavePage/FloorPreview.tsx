/**
 * 楼层预览组件
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示当前楼层的怪物组合信息
 * 2. 不做什么：不处理楼层生成逻辑（由后端算法处理）
 *
 * 数据流 / 状态流：
 * 接收 preview 数据 -> 展示楼层类型、怪物数量、属性倍率
 *
 * 关键边界条件与坑点：
 * 1. 怪物数量随楼层增长，但有上限（普通 5、精英 4、BOSS 3）
 * 2. 属性倍率决定怪物强度
 */

import { Card, Typography, Tag, Flex, Descriptions } from 'antd';
import {
  EnvironmentOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { DemonCaveFloorPreviewDto } from '../../services/api/demonCave';

const { Title, Text } = Typography;

interface FloorPreviewProps {
  preview: DemonCaveFloorPreviewDto;
}

export default function FloorPreview({ preview }: FloorPreviewProps) {
  const { floor, kind, monsterCount, monsterNames } = preview;

  const kindConfig = {
    normal: { label: '普通层', color: 'blue', icon: <EnvironmentOutlined /> },
    elite: { label: '精英层', color: 'purple', icon: <ThunderboltOutlined /> },
    boss: { label: 'BOSS层', color: 'red', icon: <ThunderboltOutlined /> },
  };

  const config = kindConfig[kind];

  return (
    <Card>
      <Flex vertical gap="middle">
        <Flex align="center" gap="small">
          <Title level={4} style={{ margin: 0 }}>
            楼层预览
          </Title>
          <Tag color={config.color} icon={config.icon}>
            {config.label}
          </Tag>
        </Flex>

        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} bordered size="small">
          <Descriptions.Item label="楼层">
            <Text strong>地下 {floor} 层</Text>
          </Descriptions.Item>

          <Descriptions.Item label="怪物数量">
            <Flex align="center" gap="small">
              <TeamOutlined />
              <Text strong>{monsterCount} 只</Text>
            </Flex>
          </Descriptions.Item>

          <Descriptions.Item label="怪物列表" span={kind === 'boss' || kind === 'elite' ? 3 : 2}>
            <Flex wrap gap="small">
              {monsterNames.map((name, index) => (
                <Tag key={index} color={kind === 'boss' ? 'red' : kind === 'elite' ? 'purple' : 'default'}>
                  {name}
                </Tag>
              ))}
            </Flex>
          </Descriptions.Item>
        </Descriptions>
      </Flex>
    </Card>
  );
}
