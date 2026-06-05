
# TypeScript / 前端代码任务执行规范

@AGENTS.md

---

# Git 提交信息规范

1. 提交信息中禁止使用 `Co-Authored-By` 签名。
2. 提交信息格式应简洁明了，包含变更摘要和关键改动点。

---

# 请求去重设计规范

## 核心原则：仅用 in-flight 守卫，不用 TTL

`RequestDedup` 只保留 **in-flight 并发守卫**（`enter` 检查 + `start` 注册 + `complete` 清理），
**不要**引入 TTL（请求完成后一段时间内阻塞重试）机制。

## 为什么

- TTL 会导致用户手动刷新按钮、快速切 tab 回同一页时，既不请求也不显示 loading，体验极差
- StrictMode double-mount 防护已被 in-flight 完全覆盖：第一次 mount 注册 in-flight，第二次 mount 被拦截
- loading 状态本身已经能阻止 loading 期间的重复点击，TTL 属于过度防御

## 使用约定

1. `dedup.enter(key)` 必须在设置 loading 之前调用
2. `dedup.complete(key)` 必须放在 finally 中
3. 后台轮询 / 轮播场景传入 `allowConcurrent=true`，不阻塞正常用户请求
4. 禁止用已有数据长度（如 `if (data.length > 0) return`）作为 effect 守卫条件 —— in-flight 已足够

