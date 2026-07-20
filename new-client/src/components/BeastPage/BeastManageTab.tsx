/**
 * 灵兽管理 Tab — 灵兽列表 + 详情 + 出战/收回。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示角色所有灵兽列表，点击查看详情（属性、资质、兽诀）。
 * 2. 不做什么：不做召唤、培育、升阶（由其他二级 Tab 负责）。
 *
 * 数据流 / 状态流：
 * mount → fetchOverview → 展示列表 → 点击 → fetchPreview → 展示详情。
 *
 * 关键边界条件与坑点：
 * 1. 无灵兽时展示空状态。
 * 2. 加载失败展示错误 + 重试按钮。
 * 3. 使用 RequestDedup 防止 React StrictMode double-mount 导致重复请求。
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Spin, Button, Result, Card, Row, Col, Tag, Typography, Space, Flex, Divider, Modal, message, Descriptions, Switch, Alert, Select } from 'antd';
import { DeleteOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { fetchBeastOverview, fetchBeastPreview, releaseBeast, checkTierUp, tierUpBeast, updateBeastCustomTag, type BeastDetailDto, type BeastOverviewDto, type TierUpCheckDto } from '../../services/api/beast';
import { RequestDedup } from '../../stores/RequestDedup';
import BeastLevelProgress from './BeastLevelProgress';
import StarLevelDisplay from '../StarLevelDisplay';

const { Text, Paragraph } = Typography;

/** 品阶标签颜色 */
const TIER_COLOR_MAP: Record<string, string> = {
  huang: 'default',
  xuan: 'blue',
  di: 'purple',
  tian: 'gold',
};

/** 品阶中文名 */
const TIER_NAME_MAP: Record<string, string> = {
  huang: '黄阶',
  xuan: '玄阶',
  di: '地阶',
  tian: '天阶',
};

/** 稀有度标签颜色 */
const RARITY_COLOR_MAP: Record<string, string> = {
  SSR: 'gold',
  SR: 'purple',
};

/** 元素颜色（使用汉字） */
const ELEMENT_COLOR_MAP: Record<string, string> = {
  '金': 'gold',
  '木': 'green',
  '水': 'cyan',
  '火': 'red',
  '土': 'orange',
};

const BeastManageTab = observer(function BeastManageTab() {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<BeastOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedBeast, setSelectedBeast] = useState<BeastDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [tierUpCheck, setTierUpCheck] = useState<TierUpCheckDto | null>(null);
  const [tierUpLoading, setTierUpLoading] = useState(false);
  const [autoBuyPill, setAutoBuyPill] = useState(false);
  const dedupRef = useRef(new RequestDedup());

  const loadOverview = useCallback(async () => {
    const dedup = dedupRef.current;
    if (!dedup.enter('beast-overview')) return;
    setLoading(true);
    setError(null);
    try {
      const promise = (async () => {
        const result = await fetchBeastOverview();
        if (result.success && result.data) {
          setOverview(result.data as unknown as BeastOverviewDto);
        } else {
          setError('加载灵兽列表失败');
        }
      })();
      dedup.start('beast-overview', promise);
      await promise;
    } catch (e) {
      setError('网络错误');
    } finally {
      setLoading(false);
      dedup.complete('beast-overview');
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const loadDetail = useCallback(async (beastId: number) => {
    const dedup = dedupRef.current;
    const key = `beast-detail:${beastId}`;
    if (!dedup.enter(key)) return;
    setDetailLoading(true);
    setTierUpCheck(null);
    try {
      const promise = (async () => {
        const [beastResult, tierUpResult] = await Promise.all([
          fetchBeastPreview(beastId),
          checkTierUp(beastId),
        ]);
        if (beastResult.success && beastResult.data) {
          setSelectedBeast(beastResult.data as unknown as BeastDetailDto);
        }
        if (tierUpResult.success && tierUpResult.data) {
          setTierUpCheck(tierUpResult.data as unknown as TierUpCheckDto);
        }
      })();
      dedup.start(key, promise);
      await promise;
    } catch {
      // 静默失败
    } finally {
      setDetailLoading(false);
      dedup.complete(key);
    }
  }, []);

  // 升阶
  const handleTierUp = useCallback(async () => {
    if (!selectedBeast) return;
    setTierUpLoading(true);
    try {
      const result = await tierUpBeast(selectedBeast.id, autoBuyPill);
      if (result.success) {
        message.success(`升阶成功！${result.data?.autoBoughtPill ? '已自动购买升阶丹。' : ''}`);
        // 刷新详情
        loadDetail(selectedBeast.id);
        // 刷新列表
        loadOverview();
      } else {
        Modal.error({
          title: '升阶失败',
          content: result.message ?? '升阶失败',
        });
      }
    } catch {
      Modal.error({
        title: '升阶失败',
        content: '升阶失败',
      });
    } finally {
      setTierUpLoading(false);
    }
  }, [selectedBeast, autoBuyPill, loadDetail, loadOverview]);

  // 更新自定义标签
  const handleCustomTagChange = useCallback(async (customTag: string | undefined) => {
    if (!selectedBeast) return;
    try {
      const result = await updateBeastCustomTag(selectedBeast.id, customTag || null);
      if (result.success) {
        message.success('标签已更新');
        loadDetail(selectedBeast.id);
      } else {
        message.error(result.message || '更新失败');
      }
    } catch {
      message.error('更新失败');
    }
  }, [selectedBeast, loadDetail]);

  // 放生（解除契约）
  const handleRelease = useCallback((beastId: number, beastName: string) => {
    Modal.confirm({
      title: '解除契约',
      content: `确定要解除「${beastName}」的契约吗？此操作不可撤销，灵兽将永久消失。`,
      okText: '确认解除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setReleasing(true);
        try {
          const result = await releaseBeast(beastId);
          if (result.success) {
            message.success('灵兽已回归山海世界');
            setSelectedBeast(null);
            // 刷新列表
            loadOverview();
          } else {
            message.error(result.message ?? '解除契约失败');
          }
        } catch {
          message.error('解除契约失败');
        } finally {
          setReleasing(false);
        }
      },
    });
  }, [loadOverview]);

  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: 300 }}>
        <Spin size="large" />
      </Flex>
    );
  }

  if (error) {
    return (
      <Result
        status="error"
        title="加载失败"
        subTitle={error}
        extra={
          <Button type="primary" onClick={loadOverview}>
            重试
          </Button>
        }
      />
    );
  }

  if (!overview || overview.beasts.length === 0) {
    return (
      <Result
        status="info"
        title="暂无灵兽"
        subTitle="前往祭坛召唤你的第一只灵兽吧！"
      />
    );
  }

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={10}>
        <Card title="灵兽列表" size="small">
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            {overview.beasts.map((beast) => (
              <Card
                key={beast.id}
                size="small"
                hoverable
                onClick={() => loadDetail(beast.id)}
                style={{
                  borderColor: selectedBeast?.id === beast.id ? '#1677ff' : undefined,
                  cursor: 'pointer',
                }}
              >
                <Flex justify="space-between" align="center">
                  <Space>
                    <StarLevelDisplay starLevel={beast.starLevel} />
                    <Tag color={TIER_COLOR_MAP[beast.beastTier]}>
                      {TIER_NAME_MAP[beast.beastTier]}
                    </Tag>
                    <Text strong>{beast.name}</Text>
                    <Text type="secondary">Lv.{beast.level}</Text>
                  </Space>
                  <Space size={4}>
                    {beast.bloodlineName && (
                      <Tag color={beast.bloodlineRarity ? RARITY_COLOR_MAP[beast.bloodlineRarity] : undefined}>
                        {beast.bloodlineRarity && `${beast.bloodlineRarity} `}{beast.bloodlineName}
                      </Tag>
                    )}
                    {beast.element.length === 0 ? (
                      <Tag>无</Tag>
                    ) : (
                      beast.element.map((el) => (
                        <Tag key={el} color={ELEMENT_COLOR_MAP[el]}>
                          {el}
                        </Tag>
                      ))
                    )}
                    {beast.isTransformed && <Tag color="magenta">已化形</Tag>}
                    {beast.isActive && <Tag color="green">出战中</Tag>}
                  </Space>
                </Flex>
              </Card>
            ))}
          </Space>
        </Card>
      </Col>

      <Col xs={24} lg={14}>
        {detailLoading ? (
          <Flex justify="center" align="center" style={{ minHeight: 200 }}>
            <Spin />
          </Flex>
        ) : selectedBeast ? (
          <Card
            size="small"
            title={
              <Flex justify="space-between" align="center" wrap="wrap" gap={8}>
                <Space size={4}>
                  <StarLevelDisplay starLevel={selectedBeast.starLevel} />
                  <Tag color={TIER_COLOR_MAP[selectedBeast.beastTier]}>
                    {TIER_NAME_MAP[selectedBeast.beastTier]}
                  </Tag>
                  <Tag>{selectedBeast.role}</Tag>
                  <Text strong>Lv{selectedBeast.level}</Text>
                </Space>
                <Space size={4}>
                  <Text type="secondary">培育{selectedBeast.cultivationCount}次</Text>
                  {selectedBeast.bloodlineName && (
                    <Tag color={selectedBeast.bloodlineRarity ? RARITY_COLOR_MAP[selectedBeast.bloodlineRarity] : undefined}>
                      {selectedBeast.bloodlineRarity && `${selectedBeast.bloodlineRarity} `}{selectedBeast.bloodlineName}血脉
                    </Tag>
                  )}
                  {selectedBeast.element.length > 0 && (
                    <Tag color={ELEMENT_COLOR_MAP[selectedBeast.element[0]]}>
                      {selectedBeast.element[0]}
                    </Tag>
                  )}
                </Space>
              </Flex>
            }
          >
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              {selectedBeast.isTransformed && (
                <Flex gap={8} align="center">
                  <Tag color="magenta">已化形</Tag>
                  {selectedBeast.transformForm && (
                    <Text type="secondary">化形：{selectedBeast.transformForm}</Text>
                  )}
                </Flex>
              )}

              {/* 自定义标签 */}
              <Flex gap={8} align="center">
                <Text type="secondary">标签：</Text>
                <Select
                  value={selectedBeast.customTag || undefined}
                  onChange={handleCustomTagChange}
                  placeholder="添加标签"
                  allowClear
                  style={{ width: 120 }}
                  options={[
                    { value: '狗粮', label: '狗粮' },
                    { value: '偏科', label: '偏科' },
                    { value: '全才', label: '全才' },
                  ]}
                />
              </Flex>

              {selectedBeast.description && (
                <Paragraph type="secondary" italic>
                  {selectedBeast.description}
                </Paragraph>
              )}

              <Divider style={{ margin: '8px 0' }}>升级进度</Divider>

              <BeastLevelProgress beast={selectedBeast} />

              <Divider style={{ margin: '8px 0' }}>战斗属性</Divider>

              <Descriptions column={{ xs: 2, sm: 3, md: 4 }} bordered size="small" title="基础属性">
                <Descriptions.Item label="最大生命">
                  {selectedBeast.computedAttrs.max_hp.toLocaleString()}
                </Descriptions.Item>
                <Descriptions.Item label="最大法力">
                  {selectedBeast.computedAttrs.max_mp.toLocaleString()}
                </Descriptions.Item>
                <Descriptions.Item label="攻击">
                  {selectedBeast.computedAttrs.atk.toLocaleString()}
                </Descriptions.Item>
                <Descriptions.Item label="法攻">
                  {selectedBeast.computedAttrs.magic_atk.toLocaleString()}
                </Descriptions.Item>
                <Descriptions.Item label="防御">
                  {selectedBeast.computedAttrs.def.toLocaleString()}
                </Descriptions.Item>
                <Descriptions.Item label="法防">
                  {selectedBeast.computedAttrs.magic_def.toLocaleString()}
                </Descriptions.Item>
                <Descriptions.Item label="速度">
                  {selectedBeast.computedAttrs.spd.toLocaleString()}
                </Descriptions.Item>
              </Descriptions>

              <Descriptions column={{ xs: 2, sm: 3, md: 4 }} bordered size="small" title="战斗属性" style={{ marginTop: 16 }}>
                <Descriptions.Item label="命中">
                  {selectedBeast.computedAttrs.accuracy.toLocaleString()}
                </Descriptions.Item>
                <Descriptions.Item label="闪避">
                  {selectedBeast.computedAttrs.dodge.toLocaleString()}
                </Descriptions.Item>
                <Descriptions.Item label="招架">
                  {selectedBeast.computedAttrs.parry.toLocaleString()}
                </Descriptions.Item>
                <Descriptions.Item label="暴击率">
                  {(selectedBeast.computedAttrs.crit_rate * 100).toFixed(1)}%
                </Descriptions.Item>
                <Descriptions.Item label="暴击伤害">
                  {(selectedBeast.computedAttrs.crit_dmg * 100).toFixed(1)}%
                </Descriptions.Item>
                <Descriptions.Item label="暴击伤害减免">
                  {(selectedBeast.computedAttrs.crit_dmg_reduce * 100).toFixed(1)}%
                </Descriptions.Item>
                <Descriptions.Item label="抗暴击">
                  {(selectedBeast.computedAttrs.anti_crit * 100).toFixed(1)}%
                </Descriptions.Item>
              </Descriptions>

              <Descriptions column={{ xs: 2, sm: 3, md: 4 }} bordered size="small" title="增伤属性" style={{ marginTop: 16 }}>
                <Descriptions.Item label="伤害加成">
                  {(selectedBeast.computedAttrs.dmg_bonus * 100).toFixed(1)}%
                </Descriptions.Item>
                <Descriptions.Item label="治疗加成">
                  {(selectedBeast.computedAttrs.heal_bonus * 100).toFixed(1)}%
                </Descriptions.Item>
                <Descriptions.Item label="治疗减免">
                  {(selectedBeast.computedAttrs.heal_reduce * 100).toFixed(1)}%
                </Descriptions.Item>
                <Descriptions.Item label="生命偷取">
                  {(selectedBeast.computedAttrs.life_steal * 100).toFixed(1)}%
                </Descriptions.Item>
                <Descriptions.Item label="冷却缩减">
                  {(selectedBeast.computedAttrs.cdr * 100).toFixed(1)}%
                </Descriptions.Item>
                <Descriptions.Item label="控制抗性">
                  {(selectedBeast.computedAttrs.control_resist * 100).toFixed(1)}%
                </Descriptions.Item>
              </Descriptions>

              <Descriptions column={{ xs: 2, sm: 3, md: 4 }} bordered size="small" title="元素抗性" style={{ marginTop: 16 }}>
                <Descriptions.Item label="金系抗性">
                  {(selectedBeast.computedAttrs.metal_resist * 100).toFixed(1)}%
                </Descriptions.Item>
                <Descriptions.Item label="木系抗性">
                  {(selectedBeast.computedAttrs.wood_resist * 100).toFixed(1)}%
                </Descriptions.Item>
                <Descriptions.Item label="水系抗性">
                  {(selectedBeast.computedAttrs.water_resist * 100).toFixed(1)}%
                </Descriptions.Item>
                <Descriptions.Item label="火系抗性">
                  {(selectedBeast.computedAttrs.fire_resist * 100).toFixed(1)}%
                </Descriptions.Item>
                <Descriptions.Item label="土系抗性">
                  {(selectedBeast.computedAttrs.earth_resist * 100).toFixed(1)}%
                </Descriptions.Item>
              </Descriptions>

              <Descriptions column={{ xs: 2, sm: 3, md: 4 }} bordered size="small" title="回复属性" style={{ marginTop: 16 }}>
                <Descriptions.Item label="生命回复">
                  {selectedBeast.computedAttrs.hp_regen.toLocaleString()}
                </Descriptions.Item>
                <Descriptions.Item label="法力回复">
                  {selectedBeast.computedAttrs.mp_regen.toLocaleString()}
                </Descriptions.Item>
              </Descriptions>

              {selectedBeast.techniques.length > 0 && (
                <>
                  <Divider style={{ margin: '8px 0' }}>兽诀</Divider>
                  <Space wrap>
                    {selectedBeast.techniques.map((tech) => (
                      <Tag key={tech.id} color={tech.isInnate ? 'gold' : 'default'}>
                        {tech.techniqueId} (层{tech.currentLayer})
                        {tech.isInnate && ' [天生]'}
                      </Tag>
                    ))}
                  </Space>
                </>
              )}

              <Divider style={{ margin: '8px 0' }}>培育</Divider>
              <Card size="small" style={{ background: 'rgba(0,0,0,0.02)' }}>
                <Text type="secondary">灵兽培育功能开发中，可通过培育物品提升资质。</Text>
              </Card>

              <Divider style={{ margin: '8px 0' }}>品阶突破</Divider>
              <Card size="small">
                {tierUpCheck ? (
                  <Space direction="vertical" style={{ width: '100%' }} size="small">
                    {tierUpCheck.nextTier ? (
                      <>
                        <Flex justify="space-between" align="center">
                          <Space>
                            <Text>当前：</Text>
                            <Tag color={TIER_COLOR_MAP[selectedBeast.beastTier]}>
                              {TIER_NAME_MAP[selectedBeast.beastTier]}
                            </Tag>
                            <ArrowUpOutlined />
                            <Text>目标：</Text>
                            <Tag color={TIER_COLOR_MAP[tierUpCheck.nextTier]}>
                              {TIER_NAME_MAP[tierUpCheck.nextTier]}
                            </Tag>
                          </Space>
                        </Flex>

                        {tierUpCheck.requirement && (
                          <Descriptions column={1} size="small" bordered>
                            <Descriptions.Item label="等级要求">
                              ≥ {tierUpCheck.requirement.minLevel} 级
                              {selectedBeast.level >= tierUpCheck.requirement.minLevel ? (
                                <Tag color="success" style={{ marginLeft: 8 }}>✓</Tag>
                              ) : (
                                <Tag color="error" style={{ marginLeft: 8 }}>✗</Tag>
                              )}
                            </Descriptions.Item>
                            <Descriptions.Item label="消耗升阶丹">
                              {tierUpCheck.requirement.consumeItemCount} 个
                            </Descriptions.Item>
                            <Descriptions.Item label="消耗灵石">
                              {tierUpCheck.requirement.consumeSpiritStones.toLocaleString()}
                            </Descriptions.Item>
                          </Descriptions>
                        )}

                        {tierUpCheck.failedReasons.length > 0 && (
                          <Alert
                            type="warning"
                            showIcon
                            message="未满足条件"
                            description={tierUpCheck.failedReasons.join('；')}
                          />
                        )}

                        <Flex gap={8} align="center">
                          <Switch
                            checked={autoBuyPill}
                            onChange={setAutoBuyPill}
                            size="small"
                          />
                          <Text type="secondary">背包不足时自动购买升阶丹（5000万/个）</Text>
                        </Flex>

                        <Button
                          type="primary"
                          icon={<ArrowUpOutlined />}
                          loading={tierUpLoading}
                          disabled={!tierUpCheck.canTierUp}
                          onClick={handleTierUp}
                          block
                        >
                          升阶至{TIER_NAME_MAP[tierUpCheck.nextTier]}
                        </Button>
                      </>
                    ) : (
                      <Alert type="info" showIcon message="已达最高品阶" />
                    )}
                  </Space>
                ) : (
                  <Text type="secondary">加载中...</Text>
                )}
              </Card>

              <Divider style={{ margin: '8px 0' }}>契约管理</Divider>
              <Flex justify="flex-end">
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  loading={releasing}
                  onClick={() => handleRelease(selectedBeast.id, selectedBeast.name)}
                >
                  解除契约
                </Button>
              </Flex>
            </Space>
          </Card>
        ) : (
          <Card size="small">
            <Flex justify="center" align="center" style={{ minHeight: 200 }}>
              <Text type="secondary">选择一只灵兽查看详情</Text>
            </Flex>
          </Card>
        )}
      </Col>
    </Row>
  );
});

export default BeastManageTab;
