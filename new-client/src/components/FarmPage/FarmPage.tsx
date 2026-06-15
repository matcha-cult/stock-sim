/**
 * 灵田系统 V3 — 主页面组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：灵田系统的入口页面，管理整体布局和数据加载，灵田内测模式下显示提示横幅。
 * 2. 不做什么：不做具体格子渲染（由 FarmPlotsGrid 负责）。
 *
 * 数据流 / 状态流：
 * 页面 mount → farmStore.fetchStaticConfig + fetchOverview → 子组件共享 observable 数据。
 * 页面 mount → fetchServerConfig → farmBetaWipeMode → 渲染内测横幅。
 *
 * 布局设计：
 * - PC端：左右分栏，左侧灵田网格，右侧种子袋+灵材仓库
 * - 移动端：单卡片布局，种子袋/灵材仓库通过弹窗访问
 *
 * 关键边界条件与坑点：
 * 1. 首次加载走 dedup 防重。
 * 2. 未开垦玩家（reclaimed=false）显示开垦界面。
 * 3. farmBetaWipeMode 会话期间不变，用 useState 即可。
 */

import { useContext, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Spin, Button, Result, Alert } from 'antd';
import { RootStoreContext } from '../../stores/RootStore';
import FarmPlotsGrid from './FarmPlotsGrid';
import { fetchServerConfig } from '../../services/api/serverConfig';

const FARM_BETA_BANNER_MESSAGE = '灵田系统删档内测中，所有灵田数据将在测试结束后清除，灵石流水暂不记录。';

const FarmPage = observer(function FarmPage() {
  const rootStore = useContext(RootStoreContext)!;
  const { farmStore } = rootStore;
  const [farmBetaWipeMode, setFarmBetaWipeMode] = useState(false);

  useEffect(() => {
    farmStore.fetchStaticConfig();
    farmStore.fetchOverview();
    fetchServerConfig()
      .then((config) => setFarmBetaWipeMode(config.farmBetaWipeMode))
      .catch(() => { /* 静默失败，默认非内测模式 */ });
  }, []);

  if (!farmStore.overviewLoaded && farmStore.overviewLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (farmStore.overviewError) {
    return (
      <Result
        status="error"
        title="加载失败"
        subTitle={farmStore.overviewError}
        extra={
          <Button type="primary" onClick={() => farmStore.fetchOverview()}>
            重试
          </Button>
        }
      />
    );
  }

  return (
    <>
      {farmBetaWipeMode && (
        <Alert
          message={FARM_BETA_BANNER_MESSAGE}
          type="warning"
          showIcon
          banner
          style={{ marginBottom: 12 }}
        />
      )}
      <FarmPlotsGrid />
    </>
  );
});

export default FarmPage;
