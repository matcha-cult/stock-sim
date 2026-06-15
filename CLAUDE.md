
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

---

# 数据库时间处理规范

## 基础设施

| 项目 | 值 |
| --- | --- |
| PostgreSQL 列类型 | `timestamp without time zone` |
| 数据库时区 | `UTC` |
| 写入方式 | `NOW()`（返回 UTC 本地时间，无时区标记） |
| node-postgres 读取行为 | 将 `timestamp without time zone` 值**当作 UTC** 解析为 JavaScript Date |

## 核心规则：禁止使用 `Date.getTime()` 计算 Unix 时间戳

**原因**：

数据库存的 `2026-06-09 13:33:11` 是 UTC 时钟的本地时间。node-postgres 把它当作 UTC 解析为 `Date(2026-06-09T13:33:11Z)`，此时 `Date.getTime()` 返回的 epoch **看似正确**。

但如果数据库时区不是 UTC（例如设为 `Asia/Shanghai`），`NOW()` 返回 `2026-06-09 21:33:11`，node-postgres 仍当作 UTC 解析为 `Date(2026-06-09T21:33:11Z)`，`getTime()` 返回的 epoch 会偏大 8 小时。

反之，如果列是 `timestamp without time zone` + 数据库时区 `Asia/Shanghai`，node-postgres 把 `21:33:11` 当作 UTC 读回，`getTime()` 返回的 epoch 会偏大 8 小时。

**正确做法**：在 SQL 中使用 `EXTRACT(EPOCH FROM created_at)` 获取 Unix 时间戳，由 PostgreSQL 根据数据库时区正确换算。

```sql
-- ✅ 正确：PostgreSQL 按数据库时区正确计算 epoch
SELECT EXTRACT(EPOCH FROM created_at) AS epoch FROM spirit_stones_ledger;

-- ❌ 错误：在 Node.js 中用 Date.getTime() / 1000 计算 epoch
--   结果依赖数据库时区 + pg 驱动对 timestamp without time zone 的解析方式
```

## 后端写法

### SQL 查询

必须在 SELECT 中包含 `EXTRACT(EPOCH FROM created_at) AS epoch`：

```typescript
const rows = await query<{ created_at: Date | string; epoch: number }>(
  `
  SELECT created_at,
         EXTRACT(EPOCH FROM created_at) AS epoch
  FROM spirit_stones_ledger
  `,
);
```

### 行数据转换

使用 `row.epoch`，不用 `Date.getTime()`：

```typescript
// ✅ 正确：用 PostgreSQL 算好的 epoch
const createdAt = Math.floor(Number(row.epoch));

// ❌ 错误：依赖 node-postgres 的 Date 解析
const createdAt = Math.floor(row.created_at.getTime() / 1000);
```

### 写入

保持 `NOW()` 即可：

```sql
INSERT INTO spirit_stones_ledger (..., created_at) VALUES (..., NOW())
```

## 前端写法

### 时间格式化

后端返回的 `createdAt` 是 Unix 秒级时间戳（UTC）。前端必须指定时区格式化：

```typescript
// ✅ 正确：显式指定时区
const LEDGER_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
});

export const formatLedgerTime = (ts: number): string => {
  return LEDGER_TIME_FORMATTER.format(new Date(ts * 1000));
};

// ❌ 错误：依赖浏览器本地时区，不同用户看到的时间不同
new Date(ts * 1000).toLocaleString('zh-CN');

// ❌ 错误：硬编码 +8h 补偿，全球化场景下其他时区用户全错
new Date(ts * 1000 + 8 * 3600 * 1000)
```

### CSV 导出

CSV 中的时间列同样使用 `formatLedgerTime`，文件头加 UTF-8 BOM（`﻿`）确保 Excel 正确打开中文。

## 总结：时间数据流

```text
写入:  NOW() → UTC 本地时间 (timestamp without time zone)
        ↓
读取:  EXTRACT(EPOCH FROM created_at) → 正确的 Unix 秒级时间戳
        ↓
API:   { createdAt: 1781011991 }  (UTC Unix timestamp)
        ↓
前端:  Intl.DateTimeFormat + timeZone:'Asia/Shanghai' → "2026/06/09 21:33:11"
```

---

# 五行相生相克

## 相生（相互促进、滋生）

顺序：**木 → 火 → 土 → 金 → 水 → 木**（循环）

- 木生火：木头可以燃烧生火
- 火生土：火烧尽后化为灰烬（土）
- 土生金：土里可以提炼出金属
- 金生水：金属熔化后会变成液体（水），或引申为金属能藏水
- 水生木：树木需要水分才能生长

## 相克（相互制约、克制）

顺序：**木 → 土 → 水 → 火 → 金 → 木**（循环）

- 木克土：树木的根可以穿透、稳固土壤
- 土克水：用土可以筑堤防洪
- 水克火：水能灭火
- 火克金：烈火可以熔化金属
- 金克木：金属刀斧可以砍伐树木

## 简单记忆

把五行的位置想象成一个圆：**相邻相生**（顺着圆走），**间隔相克**（隔一个来画线）。

生与克是相辅相成的。没有"生"就没有生长；没有"克"则会过度混乱。

## 应用

- 杂交配方中，双属性只允许相生组合（相邻）
- 禁止相克组合（间隔）

---

# 设计文档与任务规划规范

## 禁止时间预估

设计文档和任务规划中**禁止**包含任何时间预估，例如：
- "预计 X 天完成"
- "Phase 1（X-Y 天）"
- "总计：X-Y 天"

**原因**：时间预估无实际意义，且容易误导决策。任务应该按逻辑顺序拆分，按优先级执行，而非按预估时间排期。

## 禁止过多伪代码

设计文档中**禁止**包含过多伪代码或实现细节，例如：
- 完整的函数实现
- 详细的类型定义（超过必要范围）
- 重复的代码示例

**允许**的内容：
- 关键数据结构的字段说明（表格形式）
- 必要的接口定义（仅核心字段）
- 流程说明（文字描述或简单图示）

**原因**：设计文档应聚焦于架构决策和数据结构，而非实现细节。过多伪代码会干扰审阅，且容易在实现时过时。

