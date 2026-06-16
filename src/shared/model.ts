/** 数据模型与日期/格式化工具，挂件与插件共用 */

export interface Tag {
  id: string;
  name: string;
  /** 十六进制颜色 */
  color: string;
}

/** 一条记录 = 一只股票的一轮交易（买入 + 可选卖出） */
export interface SellLeg {
  id: string;
  date: string;
  price: number;
  qty: number;
}

export interface Position {
  id: string;
  /** 股票名称（必填） */
  name: string;
  /** 标签 id 列表，可多个；空数组表示未打标签 */
  tagIds: string[];
  /** 买入：YYYY-MM-DD / 价 / 数量 */
  buyDate: string;
  buyPrice: number;
  buyQty: number;
  /** 分批卖出；旧数据会从 sellDate/sellPrice/sellQty 自动迁移 */
  sells?: SellLeg[];
  /** 旧版卖出字段：留作向后兼容 */
  sellDate?: string;
  sellPrice?: number;
  sellQty?: number;
  created: number;
}

export type SortKey = "active" | "created";
export type SortDir = "asc" | "desc";

/** 单一报告期的财务指标 */
export interface FinancePeriod {
  /** 报告期 YYYY-MM-DD */
  reportDate: string;
  /** 净资产收益率（%） */
  roe?: number;
  /** 销售毛利率（%） */
  grossMargin?: number;
  /** 资产负债率（%） */
  debtRatio?: number;
  /** 归母净利同比增速（%） */
  profitGrowth?: number;
  /** 营收同比增速（%） */
  revGrowth?: number;
  /** 基本每股收益 */
  eps?: number;
}

/** 基本面：估值为实时快照，财务为多报告期序列 */
export interface Fundamental {
  code: string;
  name: string;
  /** 最新价（抓取时点） */
  price?: number;
  /** 总市值（亿元） */
  marketCap?: number;
  /** 市盈率（动态/TTM） */
  pe?: number;
  /** 市净率 */
  pb?: number;
  /** 多报告期财务指标，按报告期倒序（最新在前） */
  periods: FinancePeriod[];
  /** 用户自定义标签 id 列表，可多个；空表示未打标签 */
  tagIds?: string[];
  /** 抓取时间戳 */
  fetchedAt: number;
}

/** 估值实时、最新一期财务的 PEG = PE ÷ 归母净利增速（>0 才有意义） */
export function pegOf(f: Fundamental, period?: FinancePeriod): number | undefined {
  const g = (period || f.periods[0])?.profitGrowth;
  if (f.pe == null || g == null || g <= 0) return undefined;
  return Math.round((f.pe / g) * 100) / 100;
}

export interface StockKline {
  code: string;
  name: string;
  timeframe: string;
  klines: { date: string; close: number }[];
  fetchedAt: number;
  tagIds?: string[];
}

export type MarketKind = "index" | "board" | "fund";

export interface MarketKline extends StockKline {
  kind: MarketKind;
  /** kind=board 时记录底层来源（行业/概念），刷新时据此定位东方财富板块 */
  boardType?: "industry" | "concept";
}

export interface StockData {
  version: 1;
  updated: string;
  tags: Tag[];
  positions: Position[];
  /** 基本面快照（按代码） */
  fundamentals: Fundamental[];
  /** 个股日K线历史收盘数据 */
  individualStocks?: StockKline[];
  /** 行情页中非指数、非个股的日K线历史收盘数据 */
  marketSeries?: MarketKline[];
  /** 最近一次使用的标签集合，用于新记录默认带上 */
  lastTagIds?: string[];
  sortBy?: SortKey;
  sortOrder?: SortDir;
}

/** 默认 10 色板（谷歌日历风格，与「记账块/日程块」保持一致） */
export const PALETTE = [
  "#D50000", // 番茄红
  "#E67C73", // 火鹤红
  "#F4511E", // 橘子橙
  "#F6BF26", // 香蕉黄
  "#33B679", // 鼠尾草绿
  "#0B8043", // 罗勒绿
  "#039BE5", // 孔雀蓝
  "#3F51B5", // 蓝莓
  "#7986CB", // 薰衣草
  "#8E24AA"  // 葡萄紫
];

/** 校验并统一为 #RRGGBB 大写；非法时回退到默认色板对应位置 */
export function normalizeColor(color: string, index = 0): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(color || "");
  if (!m) return PALETTE[index % PALETTE.length];
  return `#${m[1].toUpperCase()}`;
}

/** 判断是否为合法 #RRGGBB 颜色 */
export function isHexColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color || "");
}

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function defaultData(): StockData {
  return { version: 1, updated: new Date().toISOString(), tags: [], positions: [], fundamentals: [], sortBy: "active", sortOrder: "desc" };
}

/** 6 开头为沪市，其余（0/3）为深市；主板用户不涉及北交所 */
export function marketOf(code: string): "sh" | "sz" {
  return code.startsWith("6") ? "sh" : "sz";
}

// ── 持仓计算 ──────────────────────────────────────────
/** 规范化后的卖出记录，兼容旧版单次卖出字段 */
export function sellLegs(p: Position): SellLeg[] {
  if (Array.isArray(p.sells)) {
    return p.sells
      .filter((s) => !!s.date && Number.isFinite(s.price) && Number.isFinite(s.qty) && s.price > 0 && s.qty > 0)
      .map((s, idx) => ({ ...s, id: s.id || `${p.id || "sell"}-${s.date}-${idx}` }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  if (p.sellDate && p.sellPrice != null && Number.isFinite(p.sellPrice)) {
    const qty = p.sellQty != null && Number.isFinite(p.sellQty) ? p.sellQty : p.buyQty;
    return qty > 0 ? [{ id: `${p.id || "sell"}-legacy`, date: p.sellDate, price: p.sellPrice, qty }] : [];
  }
  return [];
}
/** 是否已录入有效卖出信息 */
export function hasSell(p: Position): boolean {
  return sellLegs(p).length > 0;
}
/** 实际卖出股数合计 */
export function effSellQty(p: Position): number {
  return sellLegs(p).reduce((sum, s) => sum + s.qty, 0);
}
/** 剩余持有股数 */
export function remainingQty(p: Position): number {
  return Math.max(0, p.buyQty - effSellQty(p));
}
/** 是否已清仓：有效卖出数量覆盖全部买入数量 */
export function isClosed(p: Position): boolean {
  return hasSell(p) && remainingQty(p) <= 0;
}
/** 买入成本额 */
export function cost(p: Position): number {
  return p.buyPrice * p.buyQty;
}
/** 最后一笔卖出日期；未卖出返回空字符串 */
export function lastSellDate(p: Position): string {
  const legs = sellLegs(p);
  return legs.length ? legs[legs.length - 1].date : "";
}
/** 最后一笔卖出价；未卖出返回 null */
export function lastSellPrice(p: Position): number | null {
  const legs = sellLegs(p);
  return legs.length ? legs[legs.length - 1].price : null;
}
/** 已实现盈亏 */
export function realizedPnl(p: Position): number {
  return sellLegs(p).reduce((sum, s) => sum + (s.price - p.buyPrice) * s.qty, 0);
}
/** 已实现盈亏；未清仓返回 null（浮动盈亏需当前价，留待行情视图） */
export function pnl(p: Position): { amount: number; pct: number } | null {
  if (!isClosed(p)) return null;
  const amount = realizedPnl(p);
  const pct = cost(p) ? amount / cost(p) : 0;
  return { amount, pct };
}
/** 该记录用于排序的"最近活动日"：卖出日优先，否则买入日 */
export function activeDate(p: Position): string {
  return lastSellDate(p) || p.buyDate || "";
}

// ── 日期 ──────────────────────────────────────────────
export function todayStr(): string {
  return dateStr(new Date());
}
export function dateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
/** 持有天数：(卖出日或今天) − 买入日 */
export function holdDays(p: Position): number {
  if (!p.buyDate) return 0;
  const end = isClosed(p) && lastSellDate(p) ? parseDate(lastSellDate(p)) : new Date();
  const ms = end.getTime() - parseDate(p.buyDate).getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

// ── 格式化 ────────────────────────────────────────────
/** 价格：最多 3 位小数，去掉无意义尾零 */
export function fmtPrice(n: number): string {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
}
/** 数量/金额：千分位，最多 2 位小数 */
export function fmtNum(n: number): string {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
/** 带正负号的金额 */
export function fmtSigned(n: number): string {
  const s = Math.abs(n).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${s}`;
}
/** 带正负号的百分比 */
export function fmtPct(p: number): string {
  const v = (Math.abs(p) * 100).toFixed(2);
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${v}%`;
}

export function getStartDate(endDateStr: string, timeframe: string): string {
  const parts = endDateStr.split("-").map(Number);
  let y = parts[0];
  let m = parts[1] - 1; // 0-11
  const d = parts[2];

  switch (timeframe) {
    case "1M":
      m -= 1;
      break;
    case "3M":
      m -= 3;
      break;
    case "6M":
      m -= 6;
      break;
    case "1Y":
      y -= 1;
      break;
    case "2Y":
      y -= 2;
      break;
    case "3Y":
      y -= 3;
      break;
    case "YTD":
      return `${y}-01-01`;
    default:
      return "1990-01-01"; // 全部范围
  }

  if (m < 0) {
    y += Math.floor(m / 12);
    m = (m % 12 + 12) % 12;
  }

  const temp = new Date(y, m + 1, 0); // last day of target month
  const targetDay = Math.min(d, temp.getDate());

  const start = new Date(y, m, targetDay);
  const ry = start.getFullYear();
  const rm = String(start.getMonth() + 1).padStart(2, "0");
  const rd = String(start.getDate()).padStart(2, "0");
  return `${ry}-${rm}-${rd}`;
}
