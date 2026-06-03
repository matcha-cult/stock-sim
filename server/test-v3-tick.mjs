import 'dotenv/config';
import { initStockDefinitions } from './src/services/staticConfigLoader.js';
import { stockMarketV3Service } from './src/services/stockMarket/stockMarketV3Service.js';
import { query } from './src/config/database.js';

const run = async () => {
  console.log('=== V3 Tick 测试开始 ===');
  await initStockDefinitions();
  console.log('股票定义加载完成\n');

  // 先查看当前场景状态
  const stateResult = await query('SELECT * FROM stock_market_v3_scene_state LIMIT 1');
  console.log('当前场景状态:', JSON.stringify(stateResult.rows[0], null, 2));

  // 查看最近 V3 tick
  const tickResult = await query('SELECT id, tick_hour, status, scene_id, headline, summary FROM stock_market_v3_tick ORDER BY tick_hour DESC LIMIT 3');
  console.log('\n最近 V3 tick:');
  for (const row of tickResult.rows) {
    console.log(`  tick #${row.id} | ${row.tick_hour} | ${row.status} | scene: ${row.scene_id} | ${row.headline}`);
  }

  // 连续跑 3 个 tick
  for (let i = 0; i < 3; i++) {
    console.log(`\n========== 第 ${i + 1} 个 tick ==========\n`);
    const futureTime = new Date(Date.now() + (i + 1) * 3 * 60 * 1000);
    const result = await stockMarketV3Service.runScheduledTick(futureTime);
    console.log(`结果: ${JSON.stringify(result)}`);

    // 查看场景状态变化
    const stateAfter = await query('SELECT scene_id, ticks_elapsed, previous_scene_id FROM stock_market_v3_scene_state LIMIT 1');
    console.log(`场景状态: ${JSON.stringify(stateAfter.rows[0])}`);
  }

  // 最终汇总
  console.log('\n=== 最终场景状态 ===');
  const finalState = await query('SELECT * FROM stock_market_v3_scene_state LIMIT 1');
  console.log(JSON.stringify(finalState.rows[0], null, 2));

  console.log('\n=== 所有 V3 tick ===');
  const allTicks = await query('SELECT id, tick_hour, scene_id, headline FROM stock_market_v3_tick ORDER BY tick_hour ASC');
  for (const row of allTicks.rows) {
    console.log(`  tick #${row.id} | ${row.tick_hour} | scene: ${row.scene_id} | ${row.headline}`);
  }

  process.exit(0);
};

run().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
