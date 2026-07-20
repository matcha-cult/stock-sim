import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new IORedis(REDIS_URL);

async function clean() {
  console.log('清理 Redis 中残留的 BullMQ 重复任务...');
  
  const queueName = 'demon-cave-idle-battles';
  
  // 1. 删除所有 repeat 相关的 key
  console.log('\n=== 删除所有重复任务 key ===');
  const repeatKeys = await redis.keys(`bull:${queueName}:repeat:*`);
  console.log(`找到 ${repeatKeys.length} 个重复任务 key`);
  
  if (repeatKeys.length > 0) {
    const deleted = await redis.del(...repeatKeys);
    console.log(`已删除 ${deleted} 个重复任务 key`);
  }
  
  // 2. 删除队列相关 key
  console.log('\n=== 删除队列相关 key ===');
  const queueKeys = [
    `bull:${queueName}:repeat`,
    `bull:${queueName}:delayed`,
    `bull:${queueName}:wait`,
    `bull:${queueName}:failed`,
    `bull:${queueName}:completed`,
    `bull:${queueName}:id`,
    `bull:${queueName}:events`,
    `bull:${queueName}:meta`,
    `bull:${queueName}:limiter`,
  ];
  
  const deleted = await redis.del(...queueKeys);
  console.log(`已删除 ${deleted} 个队列相关 key`);
  
  // 3. 验证清理结果
  console.log('\n=== 验证清理结果 ===');
  const remainingKeys = await redis.keys(`bull:${queueName}:*`);
  console.log(`剩余 ${remainingKeys.length} 个 key`);
  
  await redis.quit();
  console.log('\n清理完成！');
}

clean().catch(console.error);
