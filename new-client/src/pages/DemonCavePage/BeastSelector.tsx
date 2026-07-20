/**
 * 灵兽队伍选择器组件
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供灵兽列表供用户选择出战灵兽队伍（1-4 只）
 * 2. 不做什么：不处理灵兽数据获取（由父组件负责）
 *
 * 数据流 / 状态流：
 * 接收 beasts 列表 -> 展示灵兽信息 -> 用户多选（最多 4 只）-> 回调 onSelectTeam
 *
 * 关键边界条件与坑点：
 * 1. 队伍数量限制：1-4 只
 * 2. 已选中的灵兽显示勾选状态
 * 3. 空列表时显示空状态提示
 */

import { useState, useEffect } from 'react';
import { Modal, List, Tag, Button, Typography, Flex, Checkbox, Badge } from 'antd';
import type { BeastDisplayDto } from '../../services/api/beast';

const { Text } = Typography;

/** 稀有度标签颜色 */
const RARITY_COLOR_MAP: Record<string, string> = {
  SSR: 'gold',
  SR: 'purple',
};

interface BeastSelectorProps {
  open: boolean;
  beasts: BeastDisplayDto[];
  selectedBeastIds: number[];
  onSelectTeam: (beastIds: number[]) => void;
  onCancel: () => void;
}

const MAX_TEAM_SIZE = 4;

export default function BeastSelector({
  open,
  beasts,
  selectedBeastIds,
  onSelectTeam,
  onCancel,
}: BeastSelectorProps) {
  const [tempSelectedIds, setTempSelectedIds] = useState<number[]>(selectedBeastIds);

  // 打开时重置为当前选中的队伍
  useEffect(() => {
    if (open) {
      setTempSelectedIds(selectedBeastIds);
    }
  }, [open, selectedBeastIds]);

  const handleToggle = (beastId: number) => {
    if (tempSelectedIds.includes(beastId)) {
      // 取消选择
      setTempSelectedIds(tempSelectedIds.filter((id) => id !== beastId));
    } else {
      // 添加选择（不超过最大数量）
      if (tempSelectedIds.length < MAX_TEAM_SIZE) {
        setTempSelectedIds([...tempSelectedIds, beastId]);
      }
    }
  };

  const handleConfirm = () => {
    if (tempSelectedIds.length === 0) {
      return;
    }
    onSelectTeam(tempSelectedIds);
  };

  const handleClear = () => {
    setTempSelectedIds([]);
  };

  return (
    <Modal
      title={
        <Flex align="center" gap="small">
          <Text>选择出战灵兽队伍</Text>
          <Badge
            count={`${tempSelectedIds.length}/${MAX_TEAM_SIZE}`}
            style={{ backgroundColor: tempSelectedIds.length > 0 ? '#1890ff' : '#d9d9d9' }}
          />
        </Flex>
      }
      open={open}
      onCancel={onCancel}
      footer={[
        <Button key="clear" onClick={handleClear} disabled={tempSelectedIds.length === 0}>
          清空
        </Button>,
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button
          key="confirm"
          type="primary"
          onClick={handleConfirm}
          disabled={tempSelectedIds.length === 0}
        >
          确认选择
        </Button>,
      ]}
      width={600}
    >
      <Flex vertical gap="middle">
        <Text type="secondary">选择 1-4 只灵兽组成出战队伍</Text>

        <List
          dataSource={beasts}
          renderItem={(beast) => {
            const isSelected = tempSelectedIds.includes(beast.id);
            const isDisabled = !isSelected && tempSelectedIds.length >= MAX_TEAM_SIZE;

            return (
              <List.Item
                style={{
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  opacity: isDisabled ? 0.5 : 1,
                }}
                onClick={() => !isDisabled && handleToggle(beast.id)}
              >
                <List.Item.Meta
                  avatar={
                    <Checkbox
                      checked={isSelected}
                      disabled={isDisabled}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => handleToggle(beast.id)}
                    />
                  }
                  title={
                    <Flex wrap gap="small">
                      <Text strong>{beast.name}</Text>
                      <Tag color="blue">Lv.{beast.level}</Tag>
                      <Tag color={beast.bloodlineRarity ? RARITY_COLOR_MAP[beast.bloodlineRarity] : undefined}>
                        {beast.bloodlineRarity && `${beast.bloodlineRarity} `}{beast.bloodlineName || '普通'}
                      </Tag>
                      {beast.isTransformed && <Tag color="purple">已化形</Tag>}
                      {isSelected && <Tag color="green">出战中</Tag>}
                    </Flex>
                  }
                  description={
                    <Flex wrap gap="middle">
                      <Text type="secondary">品阶：{beast.beastTier}</Text>
                      <Text type="secondary">定位：{beast.role}</Text>
                      {beast.element && beast.element.length > 0 && (
                        <Text type="secondary">属性：{beast.element.join('、')}</Text>
                      )}
                    </Flex>
                  }
                />
              </List.Item>
            );
          }}
          locale={{ emptyText: '暂无灵兽' }}
        />
      </Flex>
    </Modal>
  );
}
