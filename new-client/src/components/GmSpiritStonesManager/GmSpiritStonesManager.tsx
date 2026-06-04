/**
 * GM 灵石管理组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：给指定玩家或全体玩家增加/减少灵石余额，支持快捷金额输入，
 *    每次调整都记录到灵石流水账。
 * 2. 不做什么：不提供流水查看（由 GmLedgerViewer 负责），不做股票操作。
 *
 * 输入 / 输出：
 * - 输入：无（内部维护表单状态）。
 * - 输出：调整结果（单人返回剩余余额，全体返回成功/跳过人数）。
 *
 * 数据流 / 状态流：
 * 用户填写表单 -> lookupCharacterById()（单人时预查余额） ->
 * adjustSpiritStones() -> 展示结果。
 *
 * 复用设计说明：
 * - API 调用复用 ./services/api/spiritStones.ts
 * - 布局与 GmLedgerViewer / GmPendingOrderViewer 保持一致（Card + Flex + App.useApp）
 * - 请求去重复用 RequestDedup（5s TTL）
 *
 * 关键边界条件与坑点：
 * 1. 全体减少时，余额不足的玩家会被后端跳过，前端需展示 "成功/跳过" 统计。
 * 2. 查找角色失败时需清空已查到的余额展示，避免误导。
 * 3. 提交前必须二次确认，全体操作尤其危险。
 */

import { useState, useCallback } from 'react';
import {
  App, Button, Card, Flex, Input, InputNumber, Modal, Radio, Select, Typography,
} from 'antd';
import { SearchOutlined, CheckOutlined } from '@ant-design/icons';
import {
  lookupCharacterById,
  adjustSpiritStones,
  type GmAdjustTarget,
  type GmAdjustOperation,
  type GmAdjustBizType,
  type GmAllAdjustResult,
} from '../../services/api/spiritStones';
import { RequestDedup } from '../../stores/RequestDedup';

const dedup = new RequestDedup(5_000);

const QUICK_AMOUNTS = [2000, 5000, 10000, 30000, 50000] as const;

const QUICK_AMOUNT_LABEL: Record<number, string> = {
  2000: '2k',
  5000: '5k',
  10000: '1w',
  30000: '3w',
  50000: '5w',
};

const BIZ_TYPE_OPTIONS: { value: GmAdjustBizType; label: string }[] = [
  { value: 'gm_compensation', label: '维护补偿' },
  { value: 'gm_rebate', label: '补涨' },
];

const BIZ_TYPE_LABEL: Record<GmAdjustBizType, string> = {
  gm_compensation: '维护补偿',
  gm_rebate: '补涨',
};

const formatSpiritStones = (value: number): string => {
  return value.toLocaleString();
};

const GmSpiritStonesManager: React.FC = () => {
  const { message: msg } = App.useApp();

  const [target, setTarget] = useState<GmAdjustTarget>('single');
  const [characterId, setCharacterId] = useState('');
  const [nickname, setNickname] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [operation, setOperation] = useState<GmAdjustOperation>('add');
  const [amount, setAmount] = useState<number | null>(null);
  const [bizType, setBizType] = useState<GmAdjustBizType>('gm_compensation');
  const [memo, setMemo] = useState('');
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
          setBalance(result.data.spiritStones);
        } else {
          msg.error(result.message ?? '角色不存在');
          setNickname('');
          setBalance(null);
        }
      } catch {
        msg.error('查询角色信息失败');
        setNickname('');
        setBalance(null);
      } finally {
        setLookingUp(false);
        dedup.complete(key);
      }
    })();
    dedup.start(key, promise);
    return promise;
  }, [characterId, msg]);

  const handleAmountQuick = useCallback((val: number) => {
    setAmount(val);
  }, []);

  const handleSubmit = useCallback(async () => {
    // 前置校验
    if (target === 'single') {
      const cid = Number(characterId);
      if (!Number.isFinite(cid) || cid <= 0) {
        msg.warning('请先查找并选择目标玩家');
        return;
      }
    }
    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      msg.warning('请输入有效的灵石数量');
      return;
    }

    // 二次确认
    const opLabel = operation === 'add' ? '增加' : '减少';
    const targetLabel = target === 'single'
      ? `玩家 ${nickname}(#${characterId})`
      : '所有已注册玩家';

    Modal.confirm({
      title: `确认${opLabel}灵石`,
      content: (
        <Flex vertical gap={4} style={{ fontSize: 13 }}>
          <Typography.Text>目标：{targetLabel}</Typography.Text>
          <Typography.Text>
            操作：{opLabel} {formatSpiritStones(amount)} 灵石
          </Typography.Text>
          <Typography.Text>理由：{BIZ_TYPE_LABEL[bizType]}</Typography.Text>
          {memo && <Typography.Text>备注：{memo}</Typography.Text>}
          {target === 'all' && operation === 'reduce' && (
            <Typography.Text type="warning">
              余额不足的玩家将自动跳过
            </Typography.Text>
          )}
        </Flex>
      ),
      okText: '确认提交',
      cancelText: '取消',
      onOk: async () => {
        const key = 'adjust-submit';
        if (!dedup.enter(key)) return;

        setSubmitting(true);
        const promise = (async () => {
          try {
            const cid = Number(characterId);
            const result = await adjustSpiritStones({
              target,
              characterId: target === 'single' ? cid : undefined,
              operation,
              amount,
              bizType,
              memo: memo.trim(),
            });

            if (result.success && result.data) {
              const data = result.data;
              if ('remaining' in data) {
                const remainingStr = data.remaining != null
                  ? `，调整后余额：${formatSpiritStones(data.remaining)}`
                  : '';
                msg.success(`${data.message}${remainingStr}`);
              } else {
                const allResult = data as GmAllAdjustResult;
                const parts = [
                  `共 ${allResult.totalCount} 人`,
                  `成功 ${allResult.successCount} 人`,
                ];
                if (allResult.skippedCount > 0) {
                  parts.push(`跳过 ${allResult.skippedCount} 人（余额不足）`);
                }
                msg.success(`全体调整完成：${parts.join('，')}`);
              }
              // 清空表单
              setCharacterId('');
              setNickname('');
              setBalance(null);
              setAmount(null);
              setMemo('');
            } else {
              msg.error(result.message ?? '调整失败');
            }
          } catch {
            msg.error('调整请求失败');
          } finally {
            setSubmitting(false);
            dedup.complete(key);
          }
        })();
        dedup.start(key, promise);
        return promise;
      },
    });
  }, [target, characterId, nickname, amount, operation, bizType, memo, msg]);

  const operationLabel = operation === 'add' ? '增加' : '减少';

  return (
    <Card title="GM灵石管理" size="small" data-section="gm-spirit-stones-manager">
      <Flex vertical gap={16}>
        {/* 调整目标 */}
        <Flex gap={8} align="center">
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>目标</span>
          <Radio.Group
            size="small"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as GmAdjustTarget);
              setNickname('');
              setBalance(null);
              setCharacterId('');
            }}
          >
            <Radio.Button value="single">指定玩家</Radio.Button>
            <Radio.Button value="all">全体玩家</Radio.Button>
          </Radio.Group>
        </Flex>

        {/* 指定玩家查找 */}
        {target === 'single' && (
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
                  setBalance(null);
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
                <span style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>当前信息</span>
                <span style={{ fontSize: 13 }}>
                  <Typography.Text strong>{nickname}</Typography.Text>
                  {' '}
                  <Typography.Text type="secondary">
                    余额：{balance != null ? formatSpiritStones(balance) : '--'} 灵石
                  </Typography.Text>
                </span>
              </Flex>
            )}
          </Flex>
        )}

        {/* 全体玩家提示 */}
        {target === 'all' && (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            将对所有已注册玩家执行{operationLabel}操作
          </Typography.Text>
        )}

        {/* 操作方向 */}
        <Flex gap={8} align="center">
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>操作</span>
          <Radio.Group
            size="small"
            value={operation}
            onChange={(e) => setOperation(e.target.value as GmAdjustOperation)}
          >
            <Radio.Button value="add">增加</Radio.Button>
            <Radio.Button value="reduce">减少</Radio.Button>
          </Radio.Group>
        </Flex>

        {/* 数量 */}
        <Flex vertical gap={8}>
          <Flex gap={8} align="center">
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>数量</span>
            <InputNumber<number>
              style={{ width: 200 }}
              size="small"
              min={1}
              step={1}
              precision={0}
              placeholder="输入灵石数量"
              value={amount}
              onChange={(v) => setAmount(v)}
            />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>灵石</span>
          </Flex>
          <Flex gap={8} wrap="wrap">
            {QUICK_AMOUNTS.map((val) => (
              <Button
                key={val}
                size="small"
                type={amount === val ? 'primary' : 'default'}
                onClick={() => handleAmountQuick(val)}
              >
                {QUICK_AMOUNT_LABEL[val]}
              </Button>
            ))}
          </Flex>
        </Flex>

        {/* 理由 */}
        <Flex gap={8} align="center">
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>理由</span>
          <Select<GmAdjustBizType>
            style={{ width: 160 }}
            size="small"
            value={bizType}
            onChange={setBizType}
            options={BIZ_TYPE_OPTIONS}
          />
        </Flex>

        {/* 备注 */}
        <Flex gap={8} align="center">
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>备注</span>
          <Input
            style={{ width: 300 }}
            size="small"
            placeholder="可选，将记录到流水账"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={200}
          />
        </Flex>

        {/* 提交按钮 */}
        <Flex gap={12}>
          <Button
            type="primary"
            size="small"
            icon={<CheckOutlined />}
            onClick={handleSubmit}
            loading={submitting}
          >
            提交{operationLabel}
          </Button>
        </Flex>
      </Flex>
    </Card>
  );
};

export default GmSpiritStonesManager;
