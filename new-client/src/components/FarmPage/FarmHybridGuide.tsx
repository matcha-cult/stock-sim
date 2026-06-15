/**
 * 灵田系统 V3 — 杂交指南组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示杂交规则和现有杂交配方表，分为两个 tab。
 * 2. 不做什么：不做杂交操作，只做信息展示。
 *
 * 数据流 / 状态流：
 * FarmStore.staticConfig.hybridRecipes + FarmStore.staticConfig.crops → 渲染。
 *
 * 复用设计说明：
 * - 杂交规则从设计文档提取，前端静态展示。
 * - 杂交配方表从后端 staticConfig.hybridRecipes 获取。
 * - 作物名称通过 cropId 从 staticConfig.crops 查找。
 *
 * 关键边界条件与坑点：
 * 1. 配方表可能为空（未加载或无配方）。
 * 2. requiredCrops 需要转换为作物名称，无元素的显示 "—"。
 */

import { useContext, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { Card, Typography, Table, Tag, Alert, Descriptions, Tabs } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RootStoreContext } from '../../stores/RootStore';
import type { HybridRecipeDto, CropConfigDto } from '../../services/api/farm';
import { ElementTag } from './ElementTag';

const { Title, Paragraph, Text } = Typography;

/** 杂交规则说明 */
const HybridRules = () => (
  <div>
    <Alert
      message="杂交触发条件"
      description="相邻格子（四方向）的非成熟作物参与杂交匹配。杂交种子发放要求收获时为金光变或优质品质。"
      type="info"
      showIcon
      style={{ marginBottom: 12 }}
    />

    <Title level={5}>触发时机</Title>
    <Paragraph>
      种植时立即触发。种下新作物时，检查四方向相邻格子（上下左右）中非成熟阶段的作物，若存在匹配配方，则判定杂交。
    </Paragraph>

    <Title level={5}>种子发放机制</Title>
    <Paragraph>
      杂交判定成功后，种子进入"待发放"状态。收获时满足金光变或优质品质任一条件，种子实际发放到种子袋。
    </Paragraph>
    <Alert
      message="提前铲除惩罚"
      description="如果萌芽阶段（stageIndex = 0）铲除作物，已判定的杂交会被撤销，不发放种子。"
      type="warning"
      showIcon
      style={{ marginBottom: 12 }}
    />

    <Title level={5}>三代限制</Title>
    <Paragraph>
      杂交产出的种子有代数追踪（G0=商店种子，G1=杂交产出，G2+=后代）。第 4 代及以上（G4+）的种子，除非金光变，否则枯萎时颗粒无收（不返还种子）。
    </Paragraph>

    <Descriptions bordered size="small" column={2}>
      <Descriptions.Item label="G0">商店购买 / 初始种子，无代数限制</Descriptions.Item>
      <Descriptions.Item label="G1">杂交直接产出</Descriptions.Item>
      <Descriptions.Item label="G2">G1 种植后收获产出</Descriptions.Item>
      <Descriptions.Item label="G3">G2 种植后收获产出</Descriptions.Item>
      <Descriptions.Item label="G4+" span={2}>
        <Text type="danger">除非金光变，否则枯萎时颗粒无收</Text>
      </Descriptions.Item>
    </Descriptions>
  </div>
);

/** 扩展的配方行类型（包含解析后的作物名称） */
type HybridRecipeRow = HybridRecipeDto & {
  baseCropName: string;
  requiredCropNames: string[];
};

/** 杂交配方表 */
const HybridRecipesTable = observer(function HybridRecipesTable() {
  const rootStore = useContext(RootStoreContext)!;
  const { farmStore } = rootStore;

  // 构建作物索引（cropId → cropConfig）
  const cropMap = useMemo(() => {
    const map = new Map<string, CropConfigDto>();
    if (farmStore.staticConfig) {
      for (const crop of farmStore.staticConfig.crops) {
        map.set(crop.cropId, crop);
      }
    }
    return map;
  }, [farmStore.staticConfig]);

  // 解析配方数据
  const recipes: HybridRecipeRow[] = useMemo(() => {
    if (!farmStore.staticConfig) return [];
    return farmStore.staticConfig.hybridRecipes.map((recipe) => {
      const baseCrop = cropMap.get(recipe.baseCropId);
      const requiredCropNames = recipe.requiredCrops
        .map((cropId) => cropMap.get(cropId)?.name ?? cropId);
      return {
        ...recipe,
        baseCropName: baseCrop?.name ?? recipe.baseCropId,
        requiredCropNames,
      };
    });
  }, [farmStore.staticConfig, cropMap]);

  const columns: ColumnsType<HybridRecipeRow> = [
    {
      title: '配方名称',
      dataIndex: 'name',
      key: 'name',
      width: 100,
    },
    {
      title: '基础作物',
      dataIndex: 'baseCropName',
      key: 'baseCropName',
      width: 100,
    },
    {
      title: '所需作物',
      dataIndex: 'requiredCropNames',
      key: 'requiredCropNames',
      width: 200,
      render: (names: string[]) => (
        <span>{names.join('、')}</span>
      ),
    },
    {
      title: '最少满足',
      dataIndex: 'minRequired',
      key: 'minRequired',
      width: 80,
      align: 'center',
      render: (minRequired: number | undefined, record) => {
        if (minRequired === undefined) return <Text>{record.requiredCropNames.length}</Text>;
        if (minRequired < record.requiredCropNames.length) {
          return <Text type="warning">{minRequired}/{record.requiredCropNames.length}</Text>;
        }
        return <Text>{minRequired}</Text>;
      },
    },
    {
      title: '产物',
      dataIndex: 'resultCropName',
      key: 'resultCropName',
      width: 100,
    },
  ];

  return (
    <Table
      dataSource={recipes}
      columns={columns}
      rowKey="recipeId"
      pagination={false}
      size="small"
    />
  );
});

/** 杂交指南主组件 */
const FarmHybridGuide = observer(function FarmHybridGuide() {
  return (
    <div>
      <Tabs
        defaultActiveKey="recipes"
        items={[
          {
            key: 'recipes',
            label: '杂交配方表',
            children: <HybridRecipesTable />,
          },
          {
            key: 'rules',
            label: '杂交规则',
            children: <HybridRules />,
          },
        ]}
      />
    </div>
  );
});

export default FarmHybridGuide;
