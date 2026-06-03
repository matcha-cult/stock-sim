/**
 * 请求去重工具。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：解决 React StrictMode double-mount 导致的并发重复请求，
 *    以及快速切换 tab / 重复点击导致的短时间重复请求。
 * 2. 不做什么：不缓存响应数据、不做请求取消、不替代 loading 状态。
 *
 * 使用方式：
 * 每个 Store 持有一个实例，在 fetch 方法顶部调用 `dedup.enter(key)` 做入口守卫，
 * 请求完成后调用 `dedup.complete(key)`。
 *
 * 关键边界条件与坑点：
 * 1. `enter()` 必须在所有同步操作（设置 loading）之前调用。
 * 2. `complete()` 必须放在 finally 中，确保异常也能清理。
 * 3. 后台请求（background=true）应传入 `allowConcurrent=true`，不阻塞正常请求。
 */

export class RequestDedup {
  private inFlight = new Map<string, Promise<void>>();
  private lastComplete = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs = 5_000) {
    this.ttlMs = ttlMs;
  }

  /**
   * 请求入口守卫。
   * @param key 请求唯一标识（如 "trades:1"、"shops"）
   * @param allowConcurrent 是否允许与已有 in-flight 请求并发
   *   - false（默认）：已有请求在飞则跳过，适用于用户主动触发的请求
   *   - true：允许并发，适用于后台刷新 / 轮询
   * @returns true 允许执行，false 跳过
   */
  enter(key: string, allowConcurrent = false): boolean {
    // TTL 去重：上次完成后 ttlMs 内跳过
    const lastTs = this.lastComplete.get(key);
    if (lastTs !== undefined && Date.now() - lastTs < this.ttlMs) {
      return false;
    }
    // 并发去重：已有请求在飞则跳过
    if (!allowConcurrent && this.inFlight.has(key)) {
      return false;
    }
    return true;
  }

  /**
   * 注册 in-flight 请求。
   * 在创建 Promise 后、await 之前调用。
   */
  start(key: string, promise: Promise<void>): void {
    this.inFlight.set(key, promise);
  }

  /**
   * 标记请求完成，更新 TTL 时间戳并清除 in-flight。
   * 必须放在 finally 中调用。
   */
  complete(key: string): void {
    this.lastComplete.set(key, Date.now());
    this.inFlight.delete(key);
  }

  /**
   * 重置所有去重状态。登出 / 切换角色时调用。
   */
  reset(): void {
    this.inFlight.clear();
    this.lastComplete.clear();
  }
}
