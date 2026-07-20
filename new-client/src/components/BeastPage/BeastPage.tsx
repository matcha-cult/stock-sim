/**
 * 万兽楼灵兽系统 — 主页面容器。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理二级 Tab 状态，渲染嵌套 Tabs 结构。
 * 2. 不做什么：不处理具体业务逻辑（由各子 Tab 组件负责）。
 *
 * 数据流 / 状态流：
 * 页面 mount → 渲染二级 Tabs → 各子 Tab 自行加载数据。
 *
 * 二级 Tab 结构：
 * - 灵兽管理：灵兽列表 + 详情 + 出战/收回（内含培育、品阶突破子功能）
 * - 祭坛召唤：祭品选择 + 召唤流程
 *
 * 关键边界条件与坑点：
 * 1. 使用 destroyInactiveTabPane 销毁非活跃 Tab，避免资源浪费。
 * 2. handleSubTabChange 使用白名单过滤合法 key，防止类型错误。
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Tabs, message } from 'antd';
import BeastManageTab from './BeastManageTab';
import BeastSummonTab from './BeastSummonTab';
import BeastLogTab from './BeastLogTab';
import BeastFusionPanel from '../../pages/BeastPage/BeastFusionPanel';
import { fetchBeastOverview, fetchBeastBatchPreview, fuseBeasts, type BeastDetailDto } from '../../services/api/beast';
import { RequestDedup } from '../../stores/RequestDedup';

type BeastSubTab = 'manage' | 'summon' | 'fusion' | 'log';

const BeastPage = function BeastPage() {
  const [activeSubTab, setActiveSubTab] = useState<BeastSubTab>('manage');
  const [beasts, setBeasts] = useState<BeastDetailDto[]>([]);
  const dedup = useMemo(() => new RequestDedup(), []);

  // 加载灵兽列表（包含详情）
  const refreshBeasts = useCallback(async () => {
    if (!dedup.enter('beasts')) return;
    const task = (async () => {
      try {
        const result = await fetchBeastOverview();
        if (result.success && result.data) {
          // 批量获取所有灵兽详情
          const beastIds = result.data.beasts.map((b) => b.id);
          if (beastIds.length > 0) {
            const batchResult = await fetchBeastBatchPreview(beastIds);
            if (batchResult.success && batchResult.data) {
              setBeasts(batchResult.data);
            }
          }
        }
      } catch (error) {
        console.error('加载灵兽列表失败:', error);
      } finally {
        dedup.complete('beasts');
      }
    })();
    dedup.start('beasts', task);
    await task;
  }, [dedup]);

  const handleSubTabChange = useCallback((key: string) => {
    if (key === 'manage' || key === 'summon' || key === 'fusion' || key === 'log') {
      setActiveSubTab(key as BeastSubTab);
      // 切换到融合 Tab 时加载灵兽数据
      if (key === 'fusion') {
        refreshBeasts();
      }
    }
  }, [refreshBeasts]);

  // 初始激活的是融合 Tab 时，加载灵兽数据
  useEffect(() => {
    if (activeSubTab === 'fusion') {
      refreshBeasts();
    }
  }, []);

  const handleFuse = useCallback(async (beastIds: number[]) => {
    if (!dedup.enter('fuse')) return { success: false, message: '请求重复' };
    try {
      const result = await fuseBeasts(beastIds);
      if (result.success) {
        await refreshBeasts();
      }
      return result;
    } finally {
      dedup.complete('fuse');
    }
  }, [dedup, refreshBeasts]);

  return (
    <Tabs
      activeKey={activeSubTab}
      onChange={handleSubTabChange}
      destroyInactiveTabPane
      items={[
        {
          key: 'manage',
          label: '灵兽管理',
          children: <BeastManageTab />,
        },
        {
          key: 'summon',
          label: '祭坛召唤',
          children: <BeastSummonTab />,
        },
        {
          key: 'fusion',
          label: '灵兽融合',
          children: <BeastFusionPanel beasts={beasts} onFuse={handleFuse} />,
        },
        {
          key: 'log',
          label: '操作日志',
          children: <BeastLogTab />,
        },
      ]}
    />
  );
};

export default BeastPage;
