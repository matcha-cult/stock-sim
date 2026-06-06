import 'dotenv/config';
import { stockMarketV3Service } from './src/services/stockMarket/stockMarketV3Service.js';

const run = async () => {
  console.log('=== V3 Tick 测试开始 ===');
  const result = await stockMarketV3Service.runScheduledTick(new Date());
  console.log('=== 最终结果 ===', JSON.stringify(result, null, 2));
  process.exit(0);
};

run().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
