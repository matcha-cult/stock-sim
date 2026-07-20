/**
 * 召唤配方展示弹窗组件
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示所有召唤配方信息（灵兽名称、描述）。
 * 2. 不做什么：不处理召唤逻辑。
 *
 * 数据流 / 状态流：
 * 父组件控制 open -> 打开时 fetchAltarRecipes -> 展示配方列表。
 *
 * 关键边界条件与坑点：
 * 1. 使用 RequestDedup 防止重复请求。
 */
import { useState, useEffect, useRef } from 'react';
import { Modal, Table, Typography, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { fetchAltarRecipes, type AltarRecipeDto } from '../../../services/api/beast.js';
import { RequestDedup } from '../../../stores/RequestDedup.js';

const { Text } = Typography;

// 稀有度颜色映射
const RARITY_COLOR_MAP: Record<string, string> = {
  SSR: 'gold',
  SR: 'purple',
};

interface RecipeViewerProps {
  open: boolean;
  onClose: () => void;
}

const RecipeViewer = function RecipeViewer({ open, onClose }: RecipeViewerProps) {
  const [recipes, setRecipes] = useState<AltarRecipeDto[]>([]);
  const [loading, setLoading] = useState(false);
  const dedupRef = useRef(new RequestDedup());

  useEffect(() => {
    if (!open) return;
    const dedup = dedupRef.current;
    if (!dedup.enter('altar-recipes')) return;

    const loadRecipes = async () => {
      setLoading(true);
      try {
        const promise = (async () => {
          const result = await fetchAltarRecipes();
          if (result.success && result.data) {
            setRecipes(result.data);
          }
        })();
        dedup.start('altar-recipes', promise);
        await promise;
      } catch {
        // 静默失败
      } finally {
        setLoading(false);
        dedup.complete('altar-recipes');
      }
    };
    loadRecipes();
  }, [open]);

  const columns: ColumnsType<AltarRecipeDto> = [
    {
      title: '稀有度',
      dataIndex: 'rarity',
      key: 'rarity',
      width: 60,
      render: (rarity: string) => (
        <Tag color={RARITY_COLOR_MAP[rarity] ?? 'default'}>{rarity}</Tag>
      ),
    },
    {
      title: '血脉',
      dataIndex: 'bloodlineName',
      key: 'bloodlineName',
      width: 100,
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '化形',
      dataIndex: 'transformForm',
      key: 'transformForm',
      width: 80,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
    },
  ];

  return (
    <Modal
      title="召唤配方"
      open={open}
      onCancel={onClose}
      footer={null}
      width={600}
    >
      <Table
        columns={columns}
        dataSource={recipes}
        rowKey="bloodlineName"
        loading={loading}
        size="small"
        pagination={false}
      />
    </Modal>
  );
};

export default RecipeViewer;
