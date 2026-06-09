/**
 * 灵石流水格式化工具。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供流水时间格式化（始终 UTC+8）和 CSV 导出工具函数。
 * 2. 不做什么：不处理其他业务域（如股市）的格式化。
 *
 * 输入 / 输出：
 * - formatLedgerTime：秒级时间戳 number → 格式化字符串
 * - exportLedgerCsv：LedgerRecordDto[] + 文件名 → 触发浏览器下载
 *
 * 数据流 / 状态流：
 * 后端返回的 Unix 时间戳已是正确 UTC 值，无需补偿。
 * 前端直接用 Intl.DateTimeFormat + Asia/Shanghai 时区格式化即可。
 *
 * 复用设计说明：
 * - formatLedgerTime 被 LedgerTab 和 GmLedgerViewer 两个页面共用，避免内联重复创建 Intl 实例。
 * - CSV 转义函数按 RFC 4180 实现，后续其他表格导出也可复用。
 *
 * 关键边界条件与坑点：
 * 1. 后端 createdAt 是秒级时间戳（UTC），需 *1000 转毫秒。
 * 2. 列是 timestamp without time zone + 数据库时区 UTC → NOW() 存 UTC 时间 → 前端格式化时必须指定 timeZone: 'Asia/Shanghai'，不可省略。
 * 3. CSV 文件头加 ﻿ (BOM)，否则 Excel 打开中文乱码。
 * 4. 备注字段可能含逗号/换号/双引号，必须用双引号包裹并转义内嵌 "。
 */

const LEDGER_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
});

/** 格式化流水时间戳（秒级，UTC），按 Asia/Shanghai 时区展示 */
export const formatLedgerTime = (ts: number): string => {
  return LEDGER_TIME_FORMATTER.format(new Date(ts * 1000));
};

/** 按 RFC 4180 转义 CSV 字段值 */
const csvEscape = (value: string | number | null | undefined): string => {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/** 将字段数组拼接为单行 CSV 文本 */
const csvRow = (fields: (string | number | null | undefined)[]): string =>
  fields.map(csvEscape).join(',');

/** 触发浏览器下载 CSV 文件 */
const downloadCsv = (csvText: string, fileName: string): void => {
  const BOM = '﻿';
  const blob = new Blob([BOM + csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * 将流水记录导出为 CSV 文件。
 * @param rows 流水数据
 * @param fileName 下载文件名（不含扩展名）
 * @param columns 列配置：字段取值函数 + 表头名称
 */
export const exportLedgerCsv = <T>(
  rows: T[],
  fileName: string,
  columns: { header: string; getValue: (row: T) => string | number | null | undefined }[],
): void => {
  const headerRow = csvRow(columns.map((c) => c.header));
  const dataRows = rows.map((row) =>
    csvRow(columns.map((c) => c.getValue(row))),
  );
  const csvText = [headerRow, ...dataRows].join('\r\n');
  downloadCsv(csvText, `${fileName}.csv`);
};
