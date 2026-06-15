import { proxyGet } from "./api";
import { Fundamental, FinancePeriod, marketOf, MarketKline, StockKline, getStartDate } from "./model";

export interface DateRange {
  startDate?: string;
  endDate?: string;
}

const EASTMONEY_HEADERS = {
  "Referer": "https://quote.eastmoney.com/",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};
const EASTMONEY_BOARD_HEADERS = {
  ...EASTMONEY_HEADERS,
  "Referer": "https://quote.eastmoney.com/center/boardlist.html"
};
const EASTMONEY_KLINE_HOSTS = ["push2his.eastmoney.com", "1.push2his.eastmoney.com", "5.push2his.eastmoney.com"];
const EASTMONEY_LIST_HOSTS = ["push2.eastmoney.com", "8.push2.eastmoney.com", "9.push2.eastmoney.com"];

/** 场内基金/ETF/LOF 代码：沪 5xxxxx、深 15xxxx/16xxxx */
export function isFundCode(code: string): boolean {
  return /^(?:5\d|1[56])\d{4}$/.test(code);
}

/** A 股个股代码：沪主板/科创(6 开头)、深主板/创业(0/3 开头)，排除场内基金和深市指数(399) */
export function isStockCode(code: string): boolean {
  return /^(?:6|0|3)\d{5}$/.test(code) && !isFundCode(code) && !code.startsWith("399");
}

const numOr = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
};
const round = (n: number | undefined, d = 2): number | undefined =>
  n == null ? undefined : Math.round(n * 10 ** d) / 10 ** d;

/** 估值/行情：名称、最新价、总市值、PE动、PB */
async function fetchQuote(code: string): Promise<Partial<Fundamental> & { name: string }> {
  const market = marketOf(code);
  const url = `https://qt.gtimg.cn/q=${market}${code}`;
  const txt = await proxyGet(url);
  const match = txt.match(/"([^"]+)"/);
  if (!match) throw new Error("未查到该代码的行情（确认是沪深主板代码）");
  const fields = match[1].split("~");
  if (fields.length < 47 || !fields[1]) throw new Error("行情数据解析失败");
  return {
    name: String(fields[1]),
    marketCap: round(numOr(fields[45])),
    pe: round(numOr(fields[39])),
    pb: round(numOr(fields[46]))
  };
}

/** 财务主要指标：返回 range 内的各报告期序列（按报告期倒序，最新在前） */
async function fetchFinancePeriods(code: string, range: DateRange = {}): Promise<FinancePeriod[]> {
  const secucode = `${code}.${marketOf(code).toUpperCase()}`;
  const filter = encodeURIComponent(`(SECUCODE="${secucode}")`);
  const url = `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA`
    + `&columns=SECUCODE,REPORT_DATE,EPSJB,ROEJQ,XSMLL,ZCFZL,TOTALOPERATEREVETZ,PARENTNETPROFITTZ`
    + `&filter=${filter}&pageSize=80&sortColumns=REPORT_DATE&sortTypes=-1&source=HSF10&client=PC`;
  const txt = await proxyGet(url, {
    "Referer": "https://quote.eastmoney.com/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  const j = JSON.parse(txt);
  const rows: any[] = j?.result?.data || [];
  const mapped: FinancePeriod[] = rows
    .map((r) => ({
      reportDate: String(r.REPORT_DATE || "").slice(0, 10),
      eps: round(numOr(r.EPSJB), 4),
      roe: round(numOr(r.ROEJQ)),
      grossMargin: round(numOr(r.XSMLL)),
      debtRatio: round(numOr(r.ZCFZL)),
      revGrowth: round(numOr(r.TOTALOPERATEREVETZ)),
      profitGrowth: round(numOr(r.PARENTNETPROFITTZ))
    }))
    .filter((p) => p.reportDate);
  const ranged = mapped.filter((p) => {
    if (range.startDate && p.reportDate < range.startDate) return false;
    if (range.endDate && p.reportDate > range.endDate) return false;
    return true;
  });
  // range 过滤后为空（如新股区间过短）时回退到全部，至少保留最新一期
  return ranged.length ? ranged : mapped.slice(0, 1);
}

/** 一键抓取某代码的基本面：实时估值 + 多报告期财务（两次请求） */
export async function fetchFundamental(code: string, range: DateRange = {}): Promise<Fundamental> {
  if (!isStockCode(code)) throw new Error("请输入 6 位 A 股代码");
  const [quote, periods] = await Promise.all([fetchQuote(code), fetchFinancePeriods(code, range)]);
  return {
    code,
    name: quote.name,
    marketCap: quote.marketCap,
    pe: quote.pe,
    pb: quote.pb,
    periods,
    fetchedAt: Date.now()
  };
}

/** 智能解析输入（代码/名称/拼音）为 6 位 A 股代码 */
export async function resolveStockCode(query: string): Promise<string> {
  const clean = query.trim();
  if (isStockCode(clean)) return clean;
  if (isFundCode(clean)) throw new Error(`${clean} 是场内基金/ETF，请在「基金」分类获取`);

  const url = `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(clean)}&t=gp`;
  const txt = await proxyGet(url);
  const match = txt.match(/"([^"]+)"/);
  if (!match || match[1] === "N") {
    throw new Error(`未找到股票 "${clean}"，请尝试输入正确的名称、代码或拼音缩写`);
  }

  const items = match[1].split("^");
  // 过滤出 A 股 (GP-A)
  const aShares = items
    .map((item) => {
      const parts = item.split("~");
      return {
        market: parts[0],
        code: parts[1],
        name: parts[2],
        type: parts[4]
      };
    })
    .filter((x) => x.type === "GP-A" && isStockCode(x.code));

  if (!aShares.length) {
    throw new Error(`未找到与 "${clean}" 对应的 A 股`);
  }

  // 默认返回第一个匹配的股票代码
  console.log(`[stock-block] 智能解析: ${clean} -> ${aShares[0].name} (${aShares[0].code})`);
  return aShares[0].code;
}

async function fetchKline(secid: string, fallbackCode: string, fallbackName: string, range: DateRange, timeframe = "custom"): Promise<StockKline> {
  const path = `/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=1500`;
  let txt = "";
  let lastErr: unknown = null;
  for (const host of EASTMONEY_KLINE_HOSTS) {
    try {
      txt = await proxyGet(`https://${host}${path}`, EASTMONEY_HEADERS);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!txt) throw lastErr instanceof Error ? lastErr : new Error("东方财富行情接口不可用");
  const j = JSON.parse(txt);
  const data = j?.data;
  if (!data || !data.klines || !data.klines.length) {
    throw new Error("未获取到历史行情数据，可能代码不正确或无交易记录");
  }
  const parsedKlines = data.klines.map((line: string) => {
    const [date, closeStr] = line.split(",");
    return {
      date,
      close: parseFloat(closeStr)
    };
  });

  const maxDate = range.endDate || parsedKlines[parsedKlines.length - 1].date;
  const startDateStr = range.startDate || getStartDate(maxDate, timeframe);
  const filtered = parsedKlines.filter((k: any) => k.date >= startDateStr && (!range.endDate || k.date <= range.endDate));

  return {
    code: data.code || fallbackCode,
    name: data.name || fallbackName,
    timeframe: timeframe,
    klines: filtered,
    fetchedAt: Date.now()
  };
}

function tencentSymbol(code: string): string {
  const market = code.startsWith("5") || code.startsWith("6") || code.startsWith("9") ? "sh" : "sz";
  return `${market}${code}`;
}

async function fetchTencentKline(code: string, range: DateRange, timeframe = "custom"): Promise<StockKline> {
  const symbol = tencentSymbol(code);
  return fetchTencentSymbolKline(symbol, code, undefined, range, timeframe);
}

async function fetchTencentSymbolKline(
  symbol: string,
  code: string,
  fallbackName: string | undefined,
  range: DateRange,
  timeframe = "custom"
): Promise<StockKline> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,1500,qfq`;
  const txt = await proxyGet(url);
  const j = JSON.parse(txt);
  const data = j?.data?.[symbol];
  const rows: any[] = data?.qfqday || data?.day || [];
  if (!rows.length) throw new Error("腾讯行情未返回历史K线数据");
  const parsed = rows.map((row) => ({
    date: String(row[0]),
    close: parseFloat(String(row[2]))
  })).filter((row) => row.date && Number.isFinite(row.close));
  const maxDate = range.endDate || parsed[parsed.length - 1]?.date;
  const startDateStr = range.startDate || getStartDate(maxDate, timeframe);
  const filtered = parsed.filter((row) => row.date >= startDateStr && (!range.endDate || row.date <= range.endDate));
  const qt = data?.qt?.[symbol];
  return {
    code,
    name: Array.isArray(qt) && qt[1] ? String(qt[1]) : fallbackName || code,
    timeframe,
    klines: filtered,
    fetchedAt: Date.now()
  };
}

/** 抓取个股历史K线数据 */
export async function fetchStockKline(code: string, timeframe: string, range: DateRange = {}): Promise<StockKline> {
  if (!isStockCode(code)) throw new Error("请输入 6 位 A 股代码");
  try {
    return await fetchTencentKline(code, range, timeframe);
  } catch (tencentErr) {
    console.warn("[stock-block] 腾讯K线失败，回退东方财富", tencentErr);
    const secid = (code.startsWith("6") || code.startsWith("9") ? "1" : "0") + "." + code;
    return fetchKline(secid, code, code, range, timeframe);
  }
}

export async function fetchStockKlineByRange(code: string, range: DateRange): Promise<StockKline> {
  return fetchStockKline(code, "custom", range);
}

type BoardType = "industry" | "concept";
interface BoardItem {
  code: string;
  name: string;
}
interface ResolvedBoard extends BoardItem {
  boardType: BoardType;
}
const BOARD_ALIASES: Record<string, ResolvedBoard> = {
  "deepseek": { code: "BK1188", name: "DeepSeek概念", boardType: "concept" },
  "deepseek概念": { code: "BK1188", name: "DeepSeek概念", boardType: "concept" },
  "309184": { code: "BK1188", name: "DeepSeek概念", boardType: "concept" }
};

function boardAlias(query: string): ResolvedBoard | undefined {
  return BOARD_ALIASES[query.trim().toLowerCase()];
}

const boardFs = (kind: BoardType): string =>
  kind === "industry" ? "m:90+t:2" : "m:90+t:3";

async function fetchBoardList(kind: BoardType): Promise<BoardItem[]> {
  const fs = encodeURIComponent(boardFs(kind));
  const path = `/api/qt/clist/get?pn=1&pz=500&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=f12,f14`;
  let txt = "";
  let lastErr: unknown = null;
  for (const host of EASTMONEY_LIST_HOSTS) {
    try {
      txt = await proxyGet(`https://${host}${path}`, EASTMONEY_BOARD_HEADERS);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!txt) throw lastErr instanceof Error ? lastErr : new Error("东方财富板块列表接口不可用");
  const j = JSON.parse(txt);
  const rows: any[] = j?.data?.diff || [];
  return rows
    .map((r) => ({ code: String(r.f12 || ""), name: String(r.f14 || "") }))
    .filter((r) => r.code && r.name);
}

/** 在「行业 + 概念」两个板块库里自动解析查询（代码 / 名称），返回命中项及其归属类型 */
async function resolveBoard(query: string): Promise<ResolvedBoard> {
  const clean = query.trim();
  const alias = boardAlias(clean);
  if (alias) return alias;
  if (/^\d{6}$/.test(clean)) {
    throw new Error(`"${clean}" 不是东方财富板块代码（疑似同花顺代码）；请用板块名称（如"证券"）或东财 BKxxxx 代码`);
  }
  const [industry, concept] = await Promise.all([fetchBoardList("industry"), fetchBoardList("concept")]);
  const pools: Array<{ type: BoardType; list: BoardItem[] }> = [
    { type: "industry", list: industry },
    { type: "concept", list: concept }
  ];
  // BK 代码：两库精确匹配；都无则默认按行业处理
  if (/^BK\d{4}$/i.test(clean)) {
    for (const { type, list } of pools) {
      const hit = list.find((x) => x.code.toUpperCase() === clean.toUpperCase());
      if (hit) return { ...hit, boardType: type };
    }
    return { code: clean.toUpperCase(), name: clean.toUpperCase(), boardType: "industry" };
  }
  // 名称精确（行业优先），再模糊
  for (const { type, list } of pools) {
    const hit = list.find((x) => x.name === clean);
    if (hit) return { ...hit, boardType: type };
  }
  for (const { type, list } of pools) {
    const hit = list.find((x) => x.name.includes(clean));
    if (hit) return { ...hit, boardType: type };
  }
  for (const { type, list } of pools) {
    const hit = list.find((x) => clean.includes(x.name));
    if (hit) return { ...hit, boardType: type };
  }
  throw new Error(`未找到板块 "${clean}"（行业 / 概念均无匹配）`);
}

/** 抓取板块 K 线：自动识别行业/概念归类，统一为 kind=board */
export async function fetchBoardKline(query: string, range: DateRange): Promise<MarketKline> {
  const clean = query.trim();
  // 支持形如 sz399975 或 399975 这样的板块指数代码
  if (/^(sz|sh)\d{6}$/i.test(clean) || /^\d{6}$/.test(clean)) {
    const code = /^\d{6}$/.test(clean) ? (clean.startsWith("399") ? `sz${clean}` : `sh${clean}`) : clean;
    const name = await fetchTencentQuoteName(code);
    const kline = await fetchIndexKline(code, name || code, range);
    return { ...kline, kind: "board" };
  }
  const board = await resolveBoard(query);
  const kline = await fetchKline(`90.${board.code}`, board.code, board.name, range);
  return { ...kline, code: board.code, name: board.name, kind: "board", boardType: board.boardType };
}

const INDEX_SECIDS: Record<string, string> = {
  sh000001: "1.000001",
  sz399001: "0.399001",
  sz399006: "0.399006",
  sh000688: "1.000688",
  sh000300: "1.000300",
  sh000905: "1.000905",
  sh000852: "1.000852"
};

/** 指数代码 → 东方财富 secid（内置映射优先，否则按 sh/sz 前缀推） */
function indexEastSecid(id: string): string {
  if (INDEX_SECIDS[id]) return INDEX_SECIDS[id];
  const m = /^(sh|sz)(\d{6})$/i.exec(id);
  if (m) return `${m[1].toLowerCase() === "sh" ? "1" : "0"}.${m[2]}`;
  return id;
}

/** 抓取指数 K 线，id 形如 sh000001 / sz399975（腾讯优先，东财回退） */
export async function fetchIndexKline(id: string, name: string, range: DateRange): Promise<MarketKline> {
  let kline: StockKline;
  try {
    kline = await fetchTencentSymbolKline(id, id, name, range);
  } catch (tencentErr) {
    console.warn("[stock-block] 腾讯指数K线失败，回退东方财富", tencentErr);
    kline = await fetchKline(indexEastSecid(id), id, name, range);
  }
  return { ...kline, code: id, name: kline.name || name, kind: "index" };
}

export async function fetchFundKline(query: string, range: DateRange): Promise<MarketKline> {
  const code = query.trim();
  if (!isFundCode(code)) throw new Error("请输入场内基金/ETF代码（如 159xxx、51xxxx）");
  const kline = await fetchTencentKline(code, range);
  return { ...kline, code, kind: "fund" };
}

// ── 统一自动识别 ─────────────────────────────────────
export type SymbolKind = "index" | "board" | "fund" | "stock";
export interface ResolvedSymbol {
  kind: SymbolKind;
  /** 规范化代码：指数带 sh/sz 前缀；个股/ETF 为 6 位；板块为 BKxxxx */
  code: string;
  name: string;
  boardType?: "industry" | "concept";
}

/** 深市指数代码：399xxx（如证券公司 399975） */
function isIndexCode(code: string): boolean {
  return /^39\d{4}$/.test(code);
}

/** 取腾讯行情里的名称（指数/标的通用），失败返回空串 */
async function fetchTencentQuoteName(symbol: string): Promise<string> {
  try {
    const txt = await proxyGet(`https://qt.gtimg.cn/q=${symbol}`);
    const m = txt.match(/"([^"]+)"/);
    return m ? (m[1].split("~")[1] || "") : "";
  } catch {
    return "";
  }
}

const MAJOR_INDEX_CODES = new Set([
  "sh000001", "sh000002", "sh000003", "sh000016", "sh000300", "sh000905", "sh000852", "sh000688",
  "sz399001", "sz399005", "sz399006", "sz399300",
  "000001", "000002", "000003", "000016", "000300", "000905", "000852", "000688",
  "399001", "399005", "399006", "399300"
]);

/** 根据输入（代码/名称/拼音）自动判断标的类型并归类：大盘 / 板块 / ETF / 个股 */
export async function resolveSymbol(input: string): Promise<ResolvedSymbol> {
  const clean = input.trim();
  if (!clean) throw new Error("请输入标的");
  const alias = boardAlias(clean);
  if (alias) return { kind: "board", code: alias.code, name: alias.name, boardType: alias.boardType };
  
  // 1. 板块代码 BKxxxx
  if (/^BK\d{4}$/i.test(clean)) {
    const b = await resolveBoard(clean);
    return { kind: "board", code: b.code, name: b.name, boardType: b.boardType };
  }
  // 同花顺板块代码 88xxxx / 92xxxx
  if (/^(?:8|92)\d{4,5}$/.test(clean)) {
    throw new Error(`"${clean}" 疑似同花顺板块代码；东财请用板块名称（如"证券"）或 BKxxxx`);
  }

  // 2. 显式带有市场前缀的指数/股票 (如 sh000300, sz000001)
  const m = /^(sh|sz)(\d{6})$/i.exec(clean);
  if (m) {
    const market = m[1].toLowerCase();
    const code = m[2];
    const sym = market + code;
    const name = await fetchTencentQuoteName(sym);
    if (!name) throw new Error(`未查到标的 ${clean} 的行情`);
    
    if (isFundCode(code)) {
      return { kind: "fund", code, name };
    }
    const isMajor = MAJOR_INDEX_CODES.has(code) || MAJOR_INDEX_CODES.has(sym);
    if (code.startsWith("399") || (market === "sh" && code.startsWith("000"))) {
      return { kind: isMajor ? "index" : "board", code: sym, name };
    }
    return { kind: "stock", code: sym, name };
  }

  // 3. 优先匹配主流指数代码
  if (MAJOR_INDEX_CODES.has(clean)) {
    const sym = clean.startsWith("3") ? `sz${clean}` : `sh${clean}`;
    const name = (await fetchTencentQuoteName(sym)) || clean;
    return { kind: "index", code: sym, name };
  }

  // 4. 深市指数 (399xxx) -> 板块/行业指数
  if (isIndexCode(clean)) {
    const sym = `sz${clean}`;
    const name = (await fetchTencentQuoteName(sym)) || clean;
    return { kind: "board", code: sym, name };
  }

  // 5. 场内基金 / ETF
  if (isFundCode(clean)) {
    return { kind: "fund", code: clean, name: clean };
  }

  // 6. 个股
  if (isStockCode(clean)) {
    return { kind: "stock", code: clean, name: clean };
  }

  // 7. 其余 6 位数字：如果是 000xxx 或 0009xx 这种可能也是沪市 of 指数，默认按沪市指数尝试
  if (/^\d{6}$/.test(clean)) {
    const sym = `sh${clean}`;
    const name = await fetchTencentQuoteName(sym);
    if (name) {
      const isMajor = MAJOR_INDEX_CODES.has(clean) || MAJOR_INDEX_CODES.has(sym);
      const isIndex = clean.startsWith("000");
      return { kind: isIndex ? (isMajor ? "index" : "board") : "stock", code: sym, name };
    }
  }

  // 8. 名称 / 拼音：尝试从腾讯 Smartbox 匹配（可能匹配到个股、ETF/基金、指数/行业板块指数）
  try {
    const url = `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(clean)}&t=gp`;
    const txt = await proxyGet(url);
    const match = txt.match(/"([^"]+)"/);
    if (match && match[1] !== "N") {
      const items = match[1].split("^");
      if (items.length > 0) {
        const best = items[0].split("~");
        const market = best[0].toLowerCase();
        const code = best[1];
        const name = best[2];
        const type = best[4];
        const sym = market + code;

        // 如果是指数 (ZS)
        if (type === "ZS") {
          const isMajor = MAJOR_INDEX_CODES.has(code) || MAJOR_INDEX_CODES.has(sym);
          return { kind: isMajor ? "index" : "board", code: sym, name };
        }
        // 如果是基金/ETF
        if (type === "LOF" || type === "ETF" || isFundCode(code)) {
          return { kind: "fund", code, name };
        }
        // 如果是股票
        if (type === "GP-A" && isStockCode(code)) {
          return { kind: "stock", code, name };
        }
      }
    }
  } catch (err) {
    console.warn("[stock-block] Smartbox name resolution failed, falling back", err);
  }

  // 9. 如果 Smartbox 没匹配到，或者不是支持的类型，退回到原有逻辑（个股 -> 东财板块）
  try {
    const code = await resolveStockCode(clean);
    return { kind: "stock", code, name: clean };
  } catch {
    const b = await resolveBoard(clean);
    return { kind: "board", code: b.code, name: b.name, boardType: b.boardType };
  }
}

/** 手动指定标的类型并归类：大盘 / 板块 / ETF / 个股 */
export async function resolveSymbolManually(input: string, kind: SymbolKind): Promise<ResolvedSymbol> {
  const clean = input.trim();
  if (!clean) throw new Error("请输入标的");
  const alias = boardAlias(clean);
  if (alias && kind === "board") {
    return { kind: "board", code: alias.code, name: alias.name, boardType: alias.boardType };
  }

  const kindNames: Record<string, string> = { index: "大盘", board: "板块", fund: "ETF", stock: "个股" };

  // 1. 直截了当的数字/代码格式判断
  const isBK = /^BK\d{4}$/i.test(clean);
  const isDigits = /^\d{6}$/.test(clean);
  const hasMarketPrefix = /^(sh|sz)(\d{6})$/i.exec(clean);

  if (isBK || isDigits || hasMarketPrefix) {
    if (kind === "board") {
      if (isBK) {
        const b = await resolveBoard(clean);
        return { kind: "board", code: b.code, name: b.name, boardType: b.boardType };
      } else {
        const sym = isDigits ? (clean.startsWith("399") ? `sz${clean}` : `sh${clean}`) : clean.toLowerCase();
        const name = await fetchTencentQuoteName(sym);
        return { kind: "board", code: sym, name: name || sym };
      }
    } else if (kind === "index") {
      const sym = isDigits ? (clean.startsWith("3") ? `sz${clean}` : `sh${clean}`) : clean.toLowerCase();
      const name = await fetchTencentQuoteName(sym);
      return { kind: "index", code: sym, name: name || sym };
    } else if (kind === "fund") {
      const code = hasMarketPrefix ? hasMarketPrefix[2] : clean;
      const sym = (code.startsWith("5") ? "sh" : "sz") + code;
      const name = await fetchTencentQuoteName(sym);
      return { kind: "fund", code, name: name || code };
    } else {
      // GP-A stock
      const code = hasMarketPrefix ? hasMarketPrefix[2] : clean;
      const sym = (code.startsWith("6") || code.startsWith("9") ? "sh" : "sz") + code;
      const name = await fetchTencentQuoteName(sym);
      return { kind: "stock", code, name: name || code };
    }
  }

  // 2. 名称 / 拼音：尝试 Smartbox 模糊匹配，若成功则根据对应类型映射并格式化
  try {
    const url = `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(clean)}&t=gp`;
    const txt = await proxyGet(url);
    const match = txt.match(/"([^"]+)"/);
    if (match && match[1] !== "N") {
      const items = match[1].split("^");
      if (items.length > 0) {
        const best = items[0].split("~");
        const market = best[0].toLowerCase();
        const rawCode = best[1];
        const bestName = best[2];
        const sym = market + rawCode;

        if (kind === "stock") {
          return { kind: "stock", code: rawCode, name: bestName };
        } else if (kind === "fund") {
          return { kind: "fund", code: rawCode, name: bestName };
        } else if (kind === "index") {
          return { kind: "index", code: sym, name: bestName };
        } else {
          return { kind: "board", code: sym, name: bestName };
        }
      }
    }
  } catch (err) {
    console.warn("[stock-block] Smartbox name resolution in resolveSymbolManually failed, falling back", err);
  }

  // 3. 各种后备解析
  if (kind === "board") {
    const b = await resolveBoard(clean);
    return { kind: "board", code: b.code, name: b.name, boardType: b.boardType };
  } else if (kind === "stock") {
    const code = await resolveStockCode(clean);
    const sym = (code.startsWith("6") || code.startsWith("9") ? "sh" : "sz") + code;
    const name = await fetchTencentQuoteName(sym);
    return { kind: "stock", code, name: name || clean };
  }

  throw new Error(`无法将标的 "${clean}" 解析为 ${kindNames[kind] || kind}`);
}
