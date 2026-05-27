/**
 * 异步关闭门闩
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：统一跟踪模块内的异步任务数量，并在进入关闭态后拒绝新任务。
 * 2. 做什么：为优雅关闭提供 `waitForIdle`，让调用方在销毁底层资源前等待在途任务自然收敛。
 * 3. 不做什么：不负责启动/关闭底层资源，不吞掉任务内部异常，也不替业务层决定关闭顺序。
 *
 * 输入/输出：
 * - 输入：`run(task)` 接收一个异步或同步任务；`beginShutdown()` 切换为关闭态。
 * - 输出：`run(task)` 在关闭前返回任务结果，在关闭后返回 `undefined`；`waitForIdle()` 在所有在途任务结束后完成。
 *
 * 数据流/状态流：
 * 调用方任务 -> `run` 递增活动计数 -> 任务完成后递减计数 -> `waitForIdle` 在计数归零时统一释放等待者。
 *
 * 关键边界条件与坑点：
 * 1. `beginShutdown()` 之后的任务不会再进入执行，调用方必须自行决定返回空结果、忽略事件，还是向上游发送“服务关闭中”。
 * 2. `waitForIdle()` 只等待已经进入 `run` 的任务；若调用方还有未纳入门闩管理的定时器/回调，仍可能在资源销毁后继续执行。
 */
export class AsyncShutdownGate {
  private shuttingDown = false;
  private activeTaskCount = 0;
  private idleWaiters: Array<() => void> = [];

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  async run<T>(task: () => Promise<T> | T): Promise<T | undefined> {
    if (this.shuttingDown) {
      return undefined;
    }

    this.activeTaskCount += 1;
    try {
      return await task();
    } finally {
      this.activeTaskCount -= 1;
      if (this.activeTaskCount === 0) {
        this.resolveIdleWaiters();
      }
    }
  }

  beginShutdown(): void {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
    if (this.activeTaskCount === 0) {
      this.resolveIdleWaiters();
    }
  }

  waitForIdle(): Promise<void> {
    if (this.activeTaskCount === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private resolveIdleWaiters(): void {
    if (this.idleWaiters.length === 0) {
      return;
    }

    const waiters = this.idleWaiters.splice(0, this.idleWaiters.length);
    waiters.forEach((resolve) => resolve());
  }
}
