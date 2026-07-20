/**
 * 召唤结果预览面板组件
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示召唤结果（灵兽完整信息、所有战斗属性），提供确认/放弃按钮。
 * 2. 不做什么：不处理确认/放弃的后端逻辑（由父组件处理）。
 *
 * 数据流 / 状态流：
 * 父组件传入 SummonGenerateDto -> 展示完整灵兽信息 -> 用户点击确认/放弃 -> 触发 onConfirm/onDiscard。
 *
 * 复用设计说明：
 * - 使用 antd Card + Descriptions + Button 组合。
 * - 展示所有 26 项战斗属性，按类别分组。
 *
 * 关键边界条件与坑点：
 * 1. 确认/放弃后需要重置召唤状态（由父组件处理）。
 * 2. 按钮需要 loading 状态防止重复点击。
 */
import { Card, Descriptions, Button, Space, Typography, Flex, Tag } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import type { SummonGenerateDto } from '../../../services/api/beast.js';

const { Title, Text } = Typography;

interface SummonResultPanelProps {
  result: SummonGenerateDto;
  isConfirming: boolean;
  isDiscarding: boolean;
  onConfirm: () => void;
  onDiscard: () => void;
}

const SummonResultPanel = function SummonResultPanel({
  result,
  isConfirming,
  isDiscarding,
  onConfirm,
  onDiscard,
}: SummonResultPanelProps) {
  const attrs = result.computedAttrs;

  return (
    <Card
      size="small"
      title={
        <Flex justify="space-between" align="center">
          <Title level={5} style={{ margin: 2 }}>
            {result.name}（{result.bloodlineName}）已响应召唤
          </Title>
          <Text type="secondary">化形：{result.transformForm}</Text>
        </Flex>
      }
    >
      <Flex vertical gap="middle">
        {/* 基础信息 */}
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} bordered size="small" title="基础信息">
          <Descriptions.Item label="等级">
            {result.level}
          </Descriptions.Item>
          <Descriptions.Item label="血脉稀有度">
            <Tag>{result.bloodlineRarity}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="定位">
            <Tag>{result.role}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="元素">
            {result.element.map((e) => (
              <Tag key={e}>{e}</Tag>
            ))}
          </Descriptions.Item>
          <Descriptions.Item label="模板">
            {result.templateName}
          </Descriptions.Item>
          <Descriptions.Item label="最大兽诀槽位">
            {result.maxTechniqueSlots}
          </Descriptions.Item>
        </Descriptions>

        {/* 基础属性 */}
        <Descriptions column={{ xs: 2, sm: 3, md: 4 }} bordered size="small" title="基础属性">
          <Descriptions.Item label="最大生命">
            {attrs.max_hp.toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="最大法力">
            {attrs.max_mp.toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="攻击">
            {attrs.atk.toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="法攻">
            {attrs.magic_atk.toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="防御">
            {attrs.def.toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="法防">
            {attrs.magic_def.toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="速度">
            {attrs.spd.toLocaleString()}
          </Descriptions.Item>
        </Descriptions>

        {/* 战斗属性 */}
        <Descriptions column={{ xs: 2, sm: 3, md: 4 }} bordered size="small" title="战斗属性">
          <Descriptions.Item label="命中">
            {attrs.accuracy.toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="闪避">
            {attrs.dodge.toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="招架">
            {attrs.parry.toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="暴击率">
            {(attrs.crit_rate * 100).toFixed(1)}%
          </Descriptions.Item>
          <Descriptions.Item label="暴击伤害">
            {(attrs.crit_dmg * 100).toFixed(1)}%
          </Descriptions.Item>
          <Descriptions.Item label="暴击伤害减免">
            {(attrs.crit_dmg_reduce * 100).toFixed(1)}%
          </Descriptions.Item>
          <Descriptions.Item label="抗暴击">
            {(attrs.anti_crit * 100).toFixed(1)}%
          </Descriptions.Item>
        </Descriptions>

        {/* 增伤属性 */}
        <Descriptions column={{ xs: 2, sm: 3, md: 4 }} bordered size="small" title="增伤属性">
          <Descriptions.Item label="伤害加成">
            {(attrs.dmg_bonus * 100).toFixed(1)}%
          </Descriptions.Item>
          <Descriptions.Item label="治疗加成">
            {(attrs.heal_bonus * 100).toFixed(1)}%
          </Descriptions.Item>
          <Descriptions.Item label="治疗减免">
            {(attrs.heal_reduce * 100).toFixed(1)}%
          </Descriptions.Item>
          <Descriptions.Item label="生命偷取">
            {(attrs.life_steal * 100).toFixed(1)}%
          </Descriptions.Item>
          <Descriptions.Item label="冷却缩减">
            {(attrs.cdr * 100).toFixed(1)}%
          </Descriptions.Item>
          <Descriptions.Item label="控制抗性">
            {(attrs.control_resist * 100).toFixed(1)}%
          </Descriptions.Item>
        </Descriptions>

        {/* 元素抗性 */}
        <Descriptions column={{ xs: 2, sm: 3, md: 4 }} bordered size="small" title="元素抗性">
          <Descriptions.Item label="金系抗性">
            {(attrs.metal_resist * 100).toFixed(1)}%
          </Descriptions.Item>
          <Descriptions.Item label="木系抗性">
            {(attrs.wood_resist * 100).toFixed(1)}%
          </Descriptions.Item>
          <Descriptions.Item label="水系抗性">
            {(attrs.water_resist * 100).toFixed(1)}%
          </Descriptions.Item>
          <Descriptions.Item label="火系抗性">
            {(attrs.fire_resist * 100).toFixed(1)}%
          </Descriptions.Item>
          <Descriptions.Item label="土系抗性">
            {(attrs.earth_resist * 100).toFixed(1)}%
          </Descriptions.Item>
        </Descriptions>

        {/* 回复属性 */}
        <Descriptions column={{ xs: 2, sm: 3, md: 4 }} bordered size="small" title="回复属性">
          <Descriptions.Item label="生命回复">
            {attrs.hp_regen.toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="法力回复">
            {attrs.mp_regen.toLocaleString()}
          </Descriptions.Item>
        </Descriptions>

        <Space style={{ width: '100%', justifyContent: 'center' }}>
          <Button
            type="primary"
            size="large"
            icon={<CheckCircleOutlined />}
            loading={isConfirming}
            onClick={onConfirm}
          >
            签订契约
          </Button>
          <Button
            danger
            size="large"
            icon={<CloseCircleOutlined />}
            loading={isDiscarding}
            onClick={onDiscard}
          >
            遣返山海世界
          </Button>
        </Space>
      </Flex>
    </Card>
  );
};

export default SummonResultPanel;
