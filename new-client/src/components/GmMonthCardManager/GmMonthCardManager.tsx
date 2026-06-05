/**
 * GM 月卡管理组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：GM 向指定玩家发放/回收月卡，支持自定义天数或按配置默认天数。
 * 2. 不做什么：不提供月卡状态查询（由后端路由返回的结果展示即可）。
 *
 * 输入 / 输出：
 * - 输入：无（内部维护表单状态）。
 * - 输出：发放/回收结果。
 *
 * 数据流 / 状态流：
 * 用户输入角色ID -> lookupCharacterById() 预查角色信息 ->
 * 选择操作（发放/回收） -> gmGrantMonthCard() / gmRevokeMonthCard() ->
 * 展示结果。
 *
 * 复用设计说明：
 * - API 调用复用 ../../services/api/monthCard.ts
 * - 角色查找复用 ../../services/api/spiritStones.ts 的 lookupCharacterById
 * - 布局与 GmSpiritStonesManager 保持一致（Card + Flex + App.useApp）
 * - 请求去复用 RequestDedup（in-flight 守卫）
 *
 * 关键边界条件与坑点：
 * 1. 发放时如果角色已有 active 月卡，会自动续期（后端处理）。
 * 2. 回收对未激活角色是幂等的，后端返回 wasActive: false。
 * 3. 发放/回收均需要二次确认。
 */

import { useState, useCallback } from 'react';
import {
  App, Button, Card, Flex, Input, Modal, Radio, Typography,
} from 'antd';
import { SearchOutlined, CheckOutlined } from '@ant-design/icons';
import {
  lookupCharacterById,
} from '../../services/api/spiritStones';
import {
  gmGrantMonthCard,
  gmRevokeMonthCard,
} from '../../services/api/monthCard';
import { RequestDedup } from '../../stores/RequestDedup';

const dedup = new RequestDedup();

type GmMonthCardOperation = 'grant' | 'revoke';

const GmMonthCardManager: React.FC = () => {
  const { message: msg } = App.useApp();

  const [characterId, setCharacterId] = useState('');
  const [nickname, setNickname] = useState('');
  const [lookingUp, setLookingUp] = useState(false);

  const [operation, setOperation] = useState<GmMonthCardOperation>('grant');
  const [days, setDays] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleLookup = useCallback(async () => {
    const cid = Number(characterId);
    if (!Number.isFinite(cid) || cid <= 0) {
      msg.warning('请输入有效的角色ID');
      return;
    }
    const key = `lookup:${cid}`;
    if (!dedup.enter(key)) return;

    setLookingUp(true);
    const promise = (async () => {
      try {
        const result = await lookupCharacterById(cid);
        if (result.success && result.data) {
          setNickname(result.data.nickname);
        } else {
          msg.error(result.message ?? '角色不存在');
          setNickname('');
        }
      } catch {
        msg.error('查询角色信息失败');
        setNickname('');
      } finally {
        setLookingUp(false);
        dedup.complete(key);
      }
    })();
    dedup.start(key, promise);
    return promise;
  }, [characterId, msg]);

  const handleSubmit = useCallback(async () => {
    const cid = Number(characterId);
    if (!Number.isFinite(cid) || cid <= 0) {
      msg.warning('请先查找并选择目标玩家');
      return;
    }
    if (operation === 'grant' && days !== null && days <= 0) {
      msg.warning('发放天数必须大于 0');
      return;
    }

    const opLabel = operation === 'grant' ? '发放' : '回收';
    const daysLabel = operation === 'grant'
      ? (days ? `${days} 天` : '默认天数')
      : '';

    Modal.confirm({
      title: `确认${opLabel}月卡`,
      content: (
        <Flex vertical gap={4} style={{ fontSize: 13 }}>
          <Typography.Text>目标：{nickname}(#{characterId})</Typography.Text>
          <Typography.Text>操作：{opLabel}月卡{daysLabel}</Typography.Text>
          {operation === 'grant' && (
            <Typography.Text type="secondary">
              如已激活，将在原到期时间上续期
            </Typography.Text>
          )}
        </Flex>
      ),
      okText: '确认提交',
      cancelText: '取消',
      onOk: async () => {
        const key = 'monthcard-submit';
        if (!dedup.enter(key)) return;

        setSubmitting(true);
        const promise = (async () => {
          try {
            if (operation === 'grant') {
              const result = await gmGrantMonthCard(cid, days ?? undefined);
              if (result.success && result.data) {
                const { message, daysRemaining, isNewGrant } = result.data;
                const suffix = daysRemaining != null ? `，剩余 ${daysRemaining} 天` : '';
                msg.success(`${message}${isNewGrant ? '（新发放）' : '（续期）'}${suffix}`);
              } else {
                msg.error(result.message ?? '发放失败');
              }
            } else {
              const result = await gmRevokeMonthCard(cid);
              if (result.success && result.data) {
                const { message: msgText, wasActive } = result.data;
                msg.success(wasActive ? msgText : '该角色月卡未激活');
              } else {
                msg.error(result.message ?? '回收失败');
              }
            }
            // 清空表单
            setCharacterId('');
            setNickname('');
            setDays(null);
          } catch {
            msg.error('请求失败');
          } finally {
            setSubmitting(false);
            dedup.complete(key);
          }
        })();
        dedup.start(key, promise);
        return promise;
      },
    });
  }, [characterId, nickname, operation, days, msg]);

  return (
    <Card title="月卡管理" size="small" data-section="gm-month-card-manager">
      <Flex vertical gap={16}>
        {/* 角色查找 */}
        <Flex gap={12} wrap="wrap" align="flex-end">
          <Flex vertical>
            <span style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>角色ID</span>
            <Input
              style={{ width: 120 }}
              size="small"
              placeholder="输入角色ID"
              value={characterId}
              onChange={(e) => {
                setCharacterId(e.target.value);
                setNickname('');
              }}
              onPressEnter={handleLookup}
            />
          </Flex>
          <Button
            type="primary"
            size="small"
            icon={<SearchOutlined />}
            onClick={handleLookup}
            loading={lookingUp}
          >
            查找
          </Button>
          {nickname && (
            <Flex vertical>
              <span style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>当前角色</span>
              <Typography.Text strong>{nickname}</Typography.Text>
            </Flex>
          )}
        </Flex>

        {/* 操作方向 */}
        <Flex gap={8} align="center">
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>操作</span>
          <Radio.Group
            size="small"
            value={operation}
            onChange={(e) => setOperation(e.target.value as GmMonthCardOperation)}
          >
            <Radio.Button value="grant">发放/续期</Radio.Button>
            <Radio.Button value="revoke">回收</Radio.Button>
          </Radio.Group>
        </Flex>

        {/* 发放天数（仅发放时显示） */}
        {operation === 'grant' && (
          <Flex gap={8} align="center">
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>天数</span>
            <Input
              style={{ width: 120 }}
              size="small"
              type="number"
              min={1}
              step={1}
              placeholder="留空使用默认天数"
              value={days ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setDays(v === '' ? null : Math.max(1, Number(v)));
              }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              留空则使用服务端配置默认天数
            </Typography.Text>
          </Flex>
        )}

        {/* 提交按钮 */}
        <Flex gap={12}>
          <Button
            type="primary"
            size="small"
            icon={<CheckOutlined />}
            onClick={handleSubmit}
            loading={submitting}
          >
            提交{operation === 'grant' ? '发放' : '回收'}
          </Button>
        </Flex>
      </Flex>
    </Card>
  );
};

export default GmMonthCardManager;
