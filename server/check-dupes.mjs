import 'dotenv/config';
import { query } from './src/config/database.js';

const result = await query(`
  SELECT h.tick_id, h.stock_id, h.id, h.price_spirit_stones, h.change_bps, h.direction, h.reason, h.created_at
  FROM stock_market_price_history h
  WHERE h.tick_id IN (
    SELECT tick_id FROM stock_market_price_history GROUP BY tick_id, stock_id HAVING COUNT(*) > 1
  )
  ORDER BY h.tick_id, h.stock_id, h.id ASC
  LIMIT 50
`);
console.log('=== 重复 price_history 行 ===');
for (const r of result.rows) {
  console.log(JSON.stringify(r));
}
console.log('Total:', result.rows.length);
process.exit(0);
