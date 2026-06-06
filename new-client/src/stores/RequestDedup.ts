/**
 * 请求去重工具。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：解决 React StrictMode double-mount 导致的并发重复请求，
 *    以及 loading 期间快速点击 tab / 按钮的重复请求。
 * 2. 不做什么：不缓存响应数据、不做请求取消、不替代 loading 状态。
 *
 * 使用方式：
 * 每个 Store 持有一个实例，在 fetch 方法顶部调用 `dedup.enter(key)` 做入口守卫，
 * 请求完成后调用 `dedup.complete(key)`。
 *
 * 关键边界条件与坑点：
 * 1. `enter()` 必须在所有同步操作（设置 loading）之前调用。
 * 2. `complete()` 必须放在 finally 中，确保异常也能清理。
 * 3. 无 TTL 机制，仅靠 in-flight 守卫防重复。StrictMode 双 mount 由 in-flight 覆盖。
 * 4. `allowConcurrent=true` 适用于后台轮询 / 轮播等不应阻塞正常请求的场景。
 */

export interface DedupOptions {
  /** 是否允许与已有 in-flight 请求并发（默认 false）。
   *  false（默认）：已有请求在飞则跳过，适用于用户主动触发的请求。
   *  true：允许并发，适用于后台刷新 / 轮询。 */
  allowConcurrent?: boolean;
}

export class RequestDedup {
  private inFlight = new Map<string, Promise<void>>();

  /**
   * 请求入口守卫。
   * @param key 请求唯一标识（如 "trades:1"、"overview"）
   * @param options 去重选项：
   *   - boolean（向后兼容）：等同于 `{ allowConcurrent: value }`
   *   - DedupOptions：完整选项
   * @returns true 允许执行，false 跳过
   */
  enter(key: string, options: boolean | DedupOptions = false): boolean {
    const opts: DedupOptions = typeof options === 'boolean'
      ? { allowConcurrent: options }
      : options;

    if (!opts.allowConcurrent && this.inFlight.has(key)) {
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
   * 标记请求完成，清除 in-flight。
   * 必须放在 finally 中调用。
   */
  complete(key: string): void {
    this.inFlight.delete(key);
  }

  /**
   * 重置所有去重状态。登出 / 切换角色时调用。
   */
  reset(): void {
    this.inFlight.clear();
  }
}
