/**
 * 锁妖窟战斗页面
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示灵兽 vs 怪物的战斗场景，自动计算战斗结果
 * 2. 不做什么：不实现完整战斗动画（后续扩展）
 *
 * 数据流 / 状态流：
 * 挑战开始 -> 传入战斗数据 -> 展示双方信息 -> 点击开战 -> 服务端计算结果 -> 展示结果
 *
 * 关键边界条件与坑点：
 * 1. 战斗结果由服务端计算，客户端无法操控
 * 2. 展示战力对比和胜率，帮助用户理解结果
 */

import { useState } from 'react';
import {
  Card,
  Button,
  Space,
  Typography,
  Tag,
  Row,
  Col,
  Flex,
  Descriptions,
  Divider,
  Alert,
  message,
  Progress,
} from 'antd';
import {
  ThunderboltOutlined,
  RollbackOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import {
  settleDemonCaveChallenge,
  abandonDemonCaveChallenge,
  type DemonCaveChallengeStartDto,
  type DemonCaveChallengeSettleDto,
} from '../../services/api/demonCave';

const { Title, Text } = Typography;

interface DemonCaveBattlePageProps {
  battleData: DemonCaveChallengeStartDto;
  onBack: () => void;
  onSettle: () => void;
}

export default function DemonCaveBattlePage({
  battleData,
  onBack,
  onSettle,
}: DemonCaveBattlePageProps) {
  const [settling, setSettling] = useState(false);
  const [battleResult, setBattleResult] = useState<DemonCaveChallengeSettleDto | null>(null);
  const [abandoning, setAbandoning] = useState(false);

  const handleBattle = async () => {
    setSettling(true);
    try {
      const res = await settleDemonCaveChallenge(battleData.runId);
      if (res.success) {
        setBattleResult(res.data);
        if (res.data.success) {
          message.success(`战斗胜利！已解锁第 ${res.data.currentFloor} 层`);
        } else {
          message.warning('战斗失败，灵兽实力不足');
        }
      } else {
        message.error(res.message || '结算失败');
      }
    } catch (error) {
      message.error('战斗失败');
    } finally {
      setSettling(false);
    }
  };

  const handleBack = async () => {
    setAbandoning(true);
    try {
      await abandonDemonCaveChallenge();
      onBack();
    } catch (error) {
      message.error('放弃挑战失败');
    } finally {
      setAbandoning(false);
    }
  };

  const { floor, kind, beasts, monsters } = battleData;

  const kindLabel = {
    normal: '普通层',
    elite: '精英层',
    boss: 'BOSS层',
  }[kind];

  const kindColor = {
    normal: 'blue',
    elite: 'purple',
    boss: 'red',
  }[kind];

  return (
    <Flex vertical gap="large" style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* 标题 */}
      <Flex justify="center">
        <Space size="middle">
          <Title level={2} style={{ margin: 0 }}>
            地下 {floor} 层
          </Title>
          <Tag color={kindColor} style={{ fontSize: 16, padding: '4px 12px' }}>
            {kindLabel}
          </Tag>
        </Space>
      </Flex>

      {/* 战斗场景 */}
      <Row gutter={[24, 24]}>
        {/* 灵兽方 */}
        <Col xs={24} md={12}>
          <Card
            title={
              <Flex align="center" gap="small">
                <Text strong style={{ fontSize: 16 }}>
                  灵兽
                </Text>
                <Tag color="blue">{beasts.length} 只</Tag>
              </Flex>
            }
            styles={{ body: { background: 'var(--ant-color-primary-1)' } }}
          >
            <Flex vertical gap="middle">
              {beasts.map((beast) => (
                <Card key={beast.id} size="small" type="inner">
                  <Flex vertical gap="small">
                    <Flex align="center" gap="small">
                      <Text strong style={{ fontSize: 16 }}>
                        {beast.name}
                      </Text>
                      <Tag color="blue">Lv.{beast.level}</Tag>
                      {beast.bloodlineName && <Tag>{beast.bloodlineName}</Tag>}
                    </Flex>

                    <Flex align="center" gap="small">
                      <Text type="secondary">属性：</Text>
                      <Space wrap size={[4, 4]}>
                        {beast.element.map((el: string) => (
                          <Tag key={el} color="cyan">
                            {el}
                          </Tag>
                        ))}
                      </Space>
                    </Flex>

                    <Flex gap="large">
                      <Text type="secondary">
                        HP: <Text strong>{beast.computedAttrs.max_hp}</Text>
                      </Text>
                      <Text type="secondary">
                        ATK: <Text strong>{beast.computedAttrs.atk}</Text>
                      </Text>
                      <Text type="secondary">
                        DEF: <Text strong>{beast.computedAttrs.def}</Text>
                      </Text>
                    </Flex>
                  </Flex>
                </Card>
              ))}
            </Flex>
          </Card>
        </Col>

        {/* 怪物方 */}
        <Col xs={24} md={12}>
          <Card
            title={
              <Flex align="center" gap="small">
                <Text strong style={{ fontSize: 16 }}>
                  怪物
                </Text>
                <Tag color="red">{monsters.length} 只</Tag>
              </Flex>
            }
            styles={{ body: { background: 'var(--ant-color-error-1)' } }}
          >
            <Flex vertical gap="middle">
              {monsters.map((monster) => (
                <Card key={monster.id} size="small" type="inner">
                  <Flex vertical gap="small">
                    <Flex align="center" gap="small">
                      <Text strong>{monster.name}</Text>
                      <Tag color="red">Lv.{monster.level}</Tag>
                    </Flex>

                    <Flex align="center" gap="small">
                      <Text type="secondary">属性：</Text>
                      <Space wrap size={[4, 4]}>
                        {monster.element.map((el) => (
                          <Tag key={el} color="orange" style={{ fontSize: 11 }}>
                            {el}
                          </Tag>
                        ))}
                      </Space>
                    </Flex>

                    <Flex gap="large">
                      <Text type="secondary">
                        HP: <Text strong>{monster.baseAttrs.max_hp}</Text>
                      </Text>
                      <Text type="secondary">
                        ATK: <Text strong>{monster.baseAttrs.atk}</Text>
                      </Text>
                      <Text type="secondary">
                        DEF: <Text strong>{monster.baseAttrs.def}</Text>
                      </Text>
                    </Flex>
                  </Flex>
                </Card>
              ))}
            </Flex>
          </Card>
        </Col>
      </Row>

      {/* 战斗结果 */}
      {battleResult && (
        <Alert
          type={battleResult.success ? 'success' : 'error'}
          showIcon
          icon={battleResult.success ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
          message={
            <Flex vertical gap="small">
              <Text strong style={{ fontSize: 16 }}>
                {battleResult.success ? '战斗胜利！' : '战斗失败'}
                {battleResult.battleDetails.reason === 'timeout' && '（超过最大回合数）'}
              </Text>
              <Flex gap="large">
                <Text>
                  灵兽战力：<Text strong>{battleResult.battleDetails.beastPower.toFixed(0)}</Text>
                </Text>
                <Text>
                  怪物战力：<Text strong>{battleResult.battleDetails.monsterPower.toFixed(0)}</Text>
                </Text>
                <Text>
                  战力差：<Text strong type={battleResult.battleDetails.powerDiff >= 0 ? 'success' : 'danger'}>
                    {battleResult.battleDetails.powerDiff >= 0 ? '+' : ''}
                    {battleResult.battleDetails.powerDiff.toFixed(0)}
                  </Text>
                </Text>
              </Flex>
              <Flex align="center" gap="small">
                <Text>胜率：</Text>
                <Progress
                  percent={battleResult.battleDetails.winRate}
                  size="small"
                  style={{ width: 200 }}
                  strokeColor={battleResult.battleDetails.winRate >= 50 ? '#52c41a' : '#ff4d4f'}
                />
              </Flex>
              <Text>
                战斗回合：<Text strong>{battleResult.battleDetails.rounds}</Text>
              </Text>
              {battleResult.success && battleResult.experienceReward && (
                <Flex align="center" gap="small">
                  <Text type="success">获得经验：</Text>
                  <Text strong style={{ color: '#52c41a', fontSize: 16 }}>
                    +{battleResult.experienceReward}
                  </Text>
                  {battleResult.totalExperience && (
                    <Text type="secondary">
                      （总计：{battleResult.totalExperience}）
                    </Text>
                  )}
                </Flex>
              )}
            </Flex>
          }
        />
      )}

      <Divider />

      {/* 操作按钮 */}
      <Flex justify="center" gap="large">
        {!battleResult ? (
          <>
            <Button size="large" icon={<RollbackOutlined />} onClick={handleBack} loading={abandoning} disabled={settling}>
              撤退
            </Button>
            <Button
              type="primary"
              size="large"
              icon={<ThunderboltOutlined />}
              loading={settling}
              onClick={handleBattle}
            >
              开始战斗
            </Button>
          </>
        ) : (
          <Button type="primary" size="large" onClick={onSettle}>
            返回
          </Button>
        )}
      </Flex>
    </Flex>
  );
}
