/**
 * 锁妖窟主页面
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示锁妖窟概览、楼层预览、灵兽选择、挑战入口
 * 2. 不做什么：不处理战斗逻辑（由 BattlePage 处理）
 *
 * 数据流 / 状态流：
 * 页面加载 -> 获取概览数据 -> 展示进度/楼层预览 -> 用户操作（挑战/挂机）
 *
 * 关键边界条件与坑点：
 * 1. 页面刷新时需恢复进行中的战斗（ongoingBattle）
 * 2. 挑战与挂机互斥，不能同时进行
 */

import { useState, useEffect, useRef } from 'react';
import {
  Card,
  Button,
  Space,
  Typography,
  Tag,
  Spin,
  Modal,
  message,
  InputNumber,
  Descriptions,
  Flex,
  Row,
  Col,
  Alert,
} from 'antd';
import {
  ThunderboltOutlined,
  ReloadOutlined,
  PauseCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import {
  getDemonCaveOverview,
  setDemonCaveBeastTeam,
  startDemonCaveChallenge,
  startDemonCaveIdle,
  stopDemonCaveIdle,
  type DemonCaveOverviewDto,
} from '../../services/api/demonCave';
import { fetchBeastOverview, type BeastDisplayDto } from '../../services/api/beast';
import { RequestDedup } from '../../stores/RequestDedup';
import FloorPreview from './FloorPreview';
import BeastSelector from './BeastSelector';
import IdleHistory from './IdleHistory';

const { Title, Text } = Typography;

export default function DemonCavePage() {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<DemonCaveOverviewDto | null>(null);
  const [allBeasts, setAllBeasts] = useState<BeastDisplayDto[]>([]);
  const [beastSelectorOpen, setBeastSelectorOpen] = useState(false);
  const [challenging, setChallenging] = useState(false);
  const [idleModalOpen, setIdleModalOpen] = useState(false);
  const [idleFloor, setIdleFloor] = useState<number>(1);
  const [idleLoading, setIdleLoading] = useState(false);
  const [challengeFloor, setChallengeFloor] = useState<number>(1);
  const [battleResultModal, setBattleResultModal] = useState<{
    open: boolean;
    data: Awaited<ReturnType<typeof startDemonCaveChallenge>>['data'] | null;
  }>({ open: false, data: null });
  const dedupRef = useRef(new RequestDedup());

  const loadData = async () => {
    const dedup = dedupRef.current;
    if (!dedup.enter('overview')) return;

    setLoading(true);
    try {
      const loadPromise = (async () => {
        const [overviewRes, beastsRes] = await Promise.all([
          getDemonCaveOverview(),
          fetchBeastOverview(),
        ]);

        if (overviewRes.success) {
          setOverview(overviewRes.data);
          // 初始化挑战楼层为当前层
          setChallengeFloor(overviewRes.data.progress.currentFloor);
        } else {
          message.error(overviewRes.message || '加载锁妖窟数据失败');
        }

        if (beastsRes.success) {
          setAllBeasts(beastsRes.data.beasts);
        }
      })();

      dedup.start('overview', loadPromise);
      await loadPromise;
    } catch (error) {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
      dedup.complete('overview');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSelectBeastTeam = async (beastIds: number[]) => {
    const dedup = dedupRef.current;
    if (!dedup.enter('setBeast')) return;

    try {
      const setPromise = (async () => {
        const res = await setDemonCaveBeastTeam(beastIds);
        if (res.success) {
          message.success('已设置出战灵兽队伍');
          setBeastSelectorOpen(false);
          await loadData();
        } else {
          message.error(res.message || '设置失败');
        }
      })();

      dedup.start('setBeast', setPromise);
      await setPromise;
    } catch (error) {
      message.error('设置失败');
    } finally {
      dedup.complete('setBeast');
    }
  };

  const handleStartChallenge = async () => {
    if (!overview?.progress.beastIds || overview.progress.beastIds.length === 0) {
      message.warning('请先设置出战灵兽');
      return;
    }

    const dedup = dedupRef.current;
    if (!dedup.enter('challenge')) return;

    setChallenging(true);
    try {
      const challengePromise = (async () => {
        const res = await startDemonCaveChallenge(challengeFloor);
        if (res.success) {
          // 同步战斗已完成，显示战斗详情
          setBattleResultModal({
            open: true,
            data: res.data,
          });
          await loadData();
        } else {
          message.error(res.message || '挑战失败');
        }
      })();

      dedup.start('challenge', challengePromise);
      await challengePromise;
    } catch (error) {
      message.error('挑战失败');
    } finally {
      setChallenging(false);
      dedup.complete('challenge');
    }
  };

  const handleStartIdle = async () => {
    if (!overview?.progress.beastIds || overview.progress.beastIds.length === 0) {
      message.warning('请先设置出战灵兽');
      return;
    }

    if (!idleFloor || idleFloor < 1) {
      message.warning('请选择有效的挂机楼层');
      return;
    }

    const dedup = dedupRef.current;
    if (!dedup.enter('startIdle')) return;

    setIdleLoading(true);
    try {
      const idlePromise = (async () => {
        const res = await startDemonCaveIdle(idleFloor);
        if (res.success) {
          message.success(`开始在第 ${idleFloor} 层挂机`);
          setIdleModalOpen(false);
          await loadData();
        } else {
          message.error(res.message || '开始挂机失败');
        }
      })();

      dedup.start('startIdle', idlePromise);
      await idlePromise;
    } catch (error) {
      message.error('开始挂机失败');
    } finally {
      setIdleLoading(false);
      dedup.complete('startIdle');
    }
  };

  const handleStopIdle = async () => {
    const dedup = dedupRef.current;
    if (!dedup.enter('stopIdle')) return;

    setIdleLoading(true);
    try {
      const stopPromise = (async () => {
        const res = await stopDemonCaveIdle();
        if (res.success) {
          message.success('已停止挂机');
          await loadData();
        } else {
          message.error(res.message || '停止挂机失败');
        }
      })();

      dedup.start('stopIdle', stopPromise);
      await stopPromise;
    } catch (error) {
      message.error('停止挂机失败');
    } finally {
      setIdleLoading(false);
      dedup.complete('stopIdle');
    }
  };

  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: 400 }}>
        <Spin size="large" />
      </Flex>
    );
  }

  if (!overview) {
    return (
      <Card>
        <Flex justify="center" align="center" gap="middle">
          <Text type="secondary">加载失败</Text>
          <Button onClick={loadData}>重试</Button>
        </Flex>
      </Card>
    );
  }

  const { progress, beasts, floorPreview } = overview;

  return (
    <Flex vertical gap="large" style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* 标题栏 */}
      <Flex justify="space-between" align="center">
        <Title level={2} style={{ margin: 0 }}>
          锁妖窟
        </Title>
        <Button icon={<ReloadOutlined />} onClick={loadData}>
          刷新
        </Button>
      </Flex>

      {/* 进度信息 */}
      <Card>
        <Flex vertical gap="middle">
          <Flex align="center" gap="small">
            <Text strong>当前层数：</Text>
            <Text strong style={{ fontSize: 18 }}>
              地下 {progress.currentFloor} 层
            </Text>
          </Flex>

          <Flex align="center" gap="small">
            <Text strong>历史最高：</Text>
            <Text>地下 {progress.bestFloor} 层</Text>
          </Flex>

          <Flex align="center" gap="small">
            <Text strong>出战灵兽：</Text>
            {beasts && beasts.length > 0 ? (
              <Space wrap>
                {beasts.map((beast) => (
                  <Space key={beast.id} size={4}>
                    <Text>{beast.name}</Text>
                    <Tag color="blue">Lv.{beast.level}</Tag>
                  </Space>
                ))}
                <Button type="link" size="small" onClick={() => setBeastSelectorOpen(true)}>
                  更换
                </Button>
              </Space>
            ) : (
              <Button type="primary" size="small" onClick={() => setBeastSelectorOpen(true)}>
                选择灵兽
              </Button>
            )}
          </Flex>

          {/* 挂机状态 */}
          {progress.isIdling && (
            <Alert
              type="info"
              showIcon
              icon={<LoadingOutlined />}
              message={
                <Space>
                  <Tag color="green">挂机中</Tag>
                  <Text>第 {progress.idleFloor} 层</Text>
                  {progress.idleStartedAt && (
                    <Text type="secondary">
                      开始时间：{new Date(progress.idleStartedAt).toLocaleString('zh-CN')}
                    </Text>
                  )}
                </Space>
              }
            />
          )}
        </Flex>
      </Card>

      {/* 楼层预览 */}
      <FloorPreview preview={floorPreview} />

      {/* 挑战楼层选择 */}
      <Card size="small" title="挑战楼层">
        <Flex align="center" gap="middle">
          <Text>选择楼层：</Text>
          <InputNumber
            min={1}
            max={progress.bestFloor + 1}
            value={challengeFloor}
            onChange={(v) => setChallengeFloor(v || 1)}
            style={{ width: 100 }}
          />
          <Text type="secondary">
            （已解锁：1 ~ {progress.bestFloor + 1} 层）
          </Text>
        </Flex>
      </Card>

      {/* 已达顶层提示 */}
      {overview.isMaxFloorReached && (
        <Alert
          message="已通关所有关卡"
          description="恭喜！你已通关所有关卡，无后续关卡。"
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 操作按钮 */}
      <Flex justify="center" gap="large">
        <Button
          type="primary"
          size="large"
          icon={<ThunderboltOutlined />}
          loading={challenging}
          onClick={handleStartChallenge}
          disabled={!progress.beastIds || progress.beastIds.length === 0 || progress.isIdling || overview.isMaxFloorReached}
          style={{ width: 200, height: 50, fontSize: 18 }}
        >
          {overview.isMaxFloorReached ? '已通关' : '开始挑战'}
        </Button>

        {progress.isIdling ? (
          <Button
            danger
            size="large"
            icon={<PauseCircleOutlined />}
            loading={idleLoading}
            onClick={handleStopIdle}
            style={{ width: 200, height: 50, fontSize: 18 }}
          >
            停止挂机
          </Button>
        ) : (
          <Button
            size="large"
            loading={idleLoading}
            onClick={() => {
              setIdleFloor(progress.bestFloor || 1);
              setIdleModalOpen(true);
            }}
            disabled={!progress.beastIds || progress.beastIds.length === 0 || progress.bestFloor === 0}
            style={{ width: 200, height: 50, fontSize: 18 }}
          >
            开始挂机
          </Button>
        )}
      </Flex>

      {/* 灵兽选择器 */}
      <BeastSelector
        open={beastSelectorOpen}
        beasts={allBeasts}
        selectedBeastIds={progress.beastIds || []}
        onSelectTeam={handleSelectBeastTeam}
        onCancel={() => setBeastSelectorOpen(false)}
      />

      {/* 挂机选择器 */}
      <Modal
        title="选择挂机楼层"
        open={idleModalOpen}
        onOk={handleStartIdle}
        onCancel={() => setIdleModalOpen(false)}
        confirmLoading={idleLoading}
      >
        <Flex vertical gap="middle">
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="当前最高层">
              地下 {progress.bestFloor} 层
            </Descriptions.Item>
            <Descriptions.Item label="挂机楼层">
              <InputNumber
                min={1}
                max={progress.bestFloor || 1}
                value={idleFloor}
                onChange={(value) => setIdleFloor(value || 1)}
                style={{ width: '100%' }}
              />
            </Descriptions.Item>
          </Descriptions>
          <Text type="secondary">
            只能选择已通关的楼层（1 ~ {progress.bestFloor}）进行挂机
          </Text>
        </Flex>
      </Modal>

      {/* 战斗详情弹窗 */}
      <Modal
        title="战斗详情"
        open={battleResultModal.open && battleResultModal.data !== null}
        onCancel={() => setBattleResultModal({ open: false, data: null })}
        footer={null}
        width={900}
      >
        {battleResultModal.data && (
          <Flex vertical gap="middle">
            <Flex gap="small" align="center">
              <Text strong>结果：</Text>
              <Tag color={battleResultModal.data.battleResult.success ? 'green' : 'red'}>
                {battleResultModal.data.battleResult.success ? '胜利' : '失败'}
              </Tag>
              <Text strong>回合数：</Text>
              <Text>{battleResultModal.data.battleResult.rounds}</Text>
              <Text strong>经验：</Text>
              <Text strong style={{ color: '#52c41a' }}>
                {battleResultModal.data.battleResult.experience === '0'
                  ? '-'
                  : `+${battleResultModal.data.battleResult.experience}`}
              </Text>
            </Flex>

            {battleResultModal.data.battleResult.battleLogs && battleResultModal.data.battleResult.battleLogs.length > 0 ? (
              <Flex vertical gap="small" style={{ maxHeight: 500, overflowY: 'auto' }}>
                {battleResultModal.data.battleResult.battleLogs.map((log, idx) => (
                  <Text
                    key={idx}
                    style={{
                      color: log.isCrit
                        ? '#ff4d4f'
                        : log.isParry
                          ? '#faad14'
                          : log.action === 'miss'
                            ? '#8c8c8c'
                            : '#1890ff',
                      fontWeight: log.isCrit ? 'bold' : 'normal',
                    }}
                  >
                    [第 {log.round} 回合] {log.message}
                    {log.isElementBonus && (
                      <Tag color="purple" style={{ marginLeft: 8 }}>
                        五行克制
                      </Tag>
                    )}
                  </Text>
                ))}
              </Flex>
            ) : (
              <Alert type="info" title="无详细战斗日志" />
            )}
          </Flex>
        )}
      </Modal>

      {/* 挂机历史 */}
      <IdleHistory />
    </Flex>
  );
}
