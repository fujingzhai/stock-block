import marketData from "../assets/market-indices.json";
import { MarketKind, PALETTE, StockKline, getStartDate } from "../../shared/model";
import { StockStore } from "../../shared/store";
import { ICONS, esc, tagPicker } from "../ui";

type Row = { date: string; close: number };
export type MarketPane = "index" | MarketKind | "stock" | "tag";

interface Series {
  id: string;
  name: string;
  rows: Row[];
}

interface IndexInfo {
  id: string;
  name: string;
  color: string;
}

interface UnifiedSeries {
  key: string;
  kind: MarketPane;
  code: string;
  name: string;
  color: string;
  rows: Row[];
  removable: boolean;
  refreshable: boolean;
  tagIds?: string[];
}

interface MarketState {
  filter: MarketPane;
  selectedKeys: string[];
  timeframe: string;
  rangeMode: "recent" | "period" | "since";
  periodStart?: string;
  periodEnd?: string;
  periodLabel?: string;
  sinceDate?: string;
}

interface PeriodYearGroup {
  year: number;
  items: Array<{ label: string; start: string; end: string }>;
}

const STORAGE_KEY = "stock-block-market-unified-state";
export const MARKET_PANE_KEY = "stock-block-market-pane";

const INDICES_INFO: IndexInfo[] = [
  { id: "sh000001", name: "上证指数", color: "#ff4d4f" },
  { id: "sz399001", name: "深证成指", color: "#ffa940" },
  { id: "sz399006", name: "创业板指", color: "#fadb14" },
  { id: "sh000688", name: "科创50", color: "#13c2c2" },
  { id: "sh000300", name: "沪深300", color: "#1890ff" },
  { id: "sh000905", name: "中证500", color: "#722ed1" },
  { id: "sh000852", name: "中证1000", color: "#eb2f96" }
];

const FILTERS: Array<{ key: MarketPane; label: string }> = [
  { key: "index", label: "大盘" },
  { key: "board", label: "板块" },
  { key: "fund", label: "ETF" },
  { key: "stock", label: "个股" },
  { key: "tag", label: "标签" }
];

const PALETTE = ["#1890ff", "#52c41a", "#ff4d4f", "#722ed1", "#fa8c16", "#13c2c2", "#eb2f96", "#2f54eb", "#ffa940", "#8c8c8c"];
const LEGACY_DEFAULT_SELECTED_KEYS = ["index:sh000300", "index:sh000001", "index:sz399006"];
const RECENT_RANGES = [
  { value: "1Y", label: "最近1年" },
  { value: "YTD", label: "今年" },
  { value: "6M", label: "最近6月" },
  { value: "3M", label: "最近3月" },
  { value: "1M", label: "最近1月" }
];

function seriesKey(kind: MarketPane, code: string): string {
  return `${kind}:${code}`;
}

export function selectMarketSeries(kind: MarketPane, code: string): void {
  const state = loadState();
  const key = seriesKey(kind, code);
  if (!state.selectedKeys.includes(key)) {
    state.selectedKeys.push(key);
    saveState(state);
  }
}

function loadState(): MarketState {
  const normalizeSelectedKeys = (keys: string[]) => {
    const legacyDefaults = keys.length === LEGACY_DEFAULT_SELECTED_KEYS.length
      && LEGACY_DEFAULT_SELECTED_KEYS.every((key) => keys.includes(key));
    return legacyDefaults ? [] : keys;
  };
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.selectedKeys) && typeof parsed.timeframe === "string") {
        return {
          filter: isPane(parsed.filter) ? parsed.filter : getLegacyPane(),
          selectedKeys: normalizeSelectedKeys(parsed.selectedKeys),
          timeframe: RECENT_RANGES.some((r) => r.value === parsed.timeframe) ? parsed.timeframe : "1Y",
          rangeMode: parsed.rangeMode === "period" || parsed.rangeMode === "since" ? parsed.rangeMode : "recent",
          periodStart: typeof parsed.periodStart === "string" ? parsed.periodStart : undefined,
          periodEnd: typeof parsed.periodEnd === "string" ? parsed.periodEnd : undefined,
          periodLabel: typeof parsed.periodLabel === "string" ? parsed.periodLabel : undefined,
          sinceDate: typeof parsed.sinceDate === "string" ? parsed.sinceDate : undefined
        };
      }
    }
  } catch {
    // ignore
  }
  return {
    filter: getLegacyPane(),
    selectedKeys: [],
    timeframe: "1Y",
    rangeMode: "recent"
  };
}

function saveState(state: MarketState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(MARKET_PANE_KEY, state.filter);
  } catch {
    // ignore
  }
}

function isPane(v: unknown): v is MarketPane {
  return FILTERS.some((p) => p.key === v);
}

function getLegacyPane(): MarketPane {
  const saved = localStorage.getItem(MARKET_PANE_KEY);
  return isPane(saved) ? saved : "index";
}

export function getMarketPane(): MarketPane {
  return loadState().filter;
}

function kindLabel(kind: MarketPane): string {
  if (kind === "index") return "大盘";
  if (kind === "board") return "板块";
  if (kind === "fund") return "ETF";
  return "个股";
}

export function setMarketPane(pane: MarketPane): void {
  const state = loadState();
  state.filter = pane;
  saveState(state);
}

function normalizeKlineRows(kline: StockKline): Row[] {
  return (kline.klines || []).map((k) => ({ date: k.date, close: k.close }));
}

function seriesRangeTitle(s: UnifiedSeries): string {
  const dates = s.rows.map((r) => r.date).filter(Boolean).sort();
  if (!dates.length) return "暂无行情数据";
  return `数据范围：${dates[0]} 至 ${dates[dates.length - 1]}`;
}

function periodGroups(series: UnifiedSeries[]): PeriodYearGroup[] {
  const dates = series.flatMap((s) => s.rows.map((r) => r.date)).filter(Boolean).sort();
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  if (!minDate || !maxDate) return [];
  const minYear = Number(minDate.slice(0, 4));
  const maxYear = Number(maxDate.slice(0, 4));
  const groups: PeriodYearGroup[] = [];
  const quarters = [
    { q: "Q4", label: "四季度", start: "10-01", end: "12-31" },
    { q: "Q3", label: "三季度", start: "07-01", end: "09-30" },
    { q: "Q2", label: "二季度", start: "04-01", end: "06-30" },
    { q: "Q1", label: "一季度", start: "01-01", end: "03-31" }
  ];
  const buildItem = (label: string, start: string, end: string) => {
    const boundedStart = start < minDate ? minDate : start;
    const boundedEnd = end > maxDate ? maxDate : end;
    if (boundedStart <= boundedEnd) {
      return { label, start: boundedStart, end: boundedEnd };
    }
    return null;
  };
  for (let year = maxYear; year >= minYear; year--) {
    const items = [
      buildItem("全年", `${year}-01-01`, `${year}-12-31`),
      ...quarters.map((p) => buildItem(p.label, `${year}-${p.start}`, `${year}-${p.end}`))
    ].filter((item): item is { label: string; start: string; end: string } => !!item);
    if (items.length) groups.push({ year, items });
  }
  return groups;
}

function allSeries(store: StockStore): UnifiedSeries[] {
  const builtinIds = new Set(INDICES_INFO.map((i) => i.id));
  const indices = INDICES_INFO.map((info) => {
    const dataSeries = (marketData.series as Series[]).find((s) => s.id === info.id);
    const refreshed = store.getMarketSeries("index", info.id);
    return {
      key: seriesKey("index", info.id),
      kind: "index" as const,
      code: info.id,
      name: info.name,
      color: info.color,
      rows: refreshed ? normalizeKlineRows(refreshed) : dataSeries?.rows || [],
      removable: false,
      refreshable: true,
      tagIds: refreshed?.tagIds || []
    };
  });
  let ci = 0;
  const palette = () => PALETTE[ci++ % PALETTE.length];
  // 用户自行导入的指数（如证券公司 sz399975），可删
  const extraIndices = store.marketSeries.filter((s) => s.kind === "index" && !builtinIds.has(s.code)).map((s) => ({
    key: seriesKey("index", s.code),
    kind: "index" as const,
    code: s.code,
    name: s.name,
    color: palette(),
    rows: normalizeKlineRows(s),
    removable: true,
    refreshable: true,
    tagIds: s.tagIds || []
  }));
  const imported = store.marketSeries.filter((s) => s.kind !== "index").map((s) => ({
    key: seriesKey(s.kind, s.code),
    kind: s.kind,
    code: s.code,
    name: s.name,
    color: palette(),
    rows: normalizeKlineRows(s),
    removable: true,
    refreshable: true,
    tagIds: s.tagIds || []
  }));
  const stocks = store.individualStocks.map((s) => ({
    key: seriesKey("stock", s.code),
    kind: "stock" as const,
    code: s.code,
    name: s.name,
    color: palette(),
    rows: normalizeKlineRows(s),
    removable: true,
    refreshable: true,
    tagIds: s.tagIds || []
  }));
  return [...indices, ...extraIndices, ...imported, ...stocks];
}

export function renderMarketHub(host: HTMLElement, store: StockStore, fit: () => void): void {
  const state = loadState();
  let lockedSeriesKey: string | null = null;
  const series = allSeries(store);
  const existingKeys = new Set(series.map((s) => s.key));
  state.selectedKeys = state.selectedKeys.filter((key) => existingKeys.has(key));

  host.innerHTML = `
    <div class="market-view unified">
      <aside class="market-left compact">
        <div class="market-hub-tabs">
          ${FILTERS.map((p) => `<button class="market-hub-tab${p.key === state.filter ? " on" : ""}" data-pane="${p.key}">${p.label}</button>`).join("")}
        </div>
        <div class="idx-header compact" ${state.filter === "tag" ? 'style="display:none;"' : ""}>
          <input type="checkbox" id="series-all" />
          <label for="series-all"><b>${kindLabel(state.filter)}</b></label>
        </div>
        <div class="idx-list compact" id="seriesList"></div>
      </aside>
      <section class="market-right">
        <div class="chart-canvas-container" id="marketChartContainer">
          <svg id="marketChartSvg" style="width:100%; height:100%; display:block; overflow:visible;"></svg>
          <div id="chartTooltip" class="chart-tooltip" style="display:none; position:absolute; pointer-events:none; z-index:100;"></div>
        </div>
        <div class="chart-legend" id="chartLegend" style="display:none;"></div>
      </section>
    </div>
  `;

  const list = host.querySelector("#seriesList") as HTMLElement;
  const all = host.querySelector("#series-all") as HTMLInputElement;
  const chartContainer = host.querySelector("#marketChartContainer") as HTMLElement;
  const chartSvg = host.querySelector("#marketChartSvg") as unknown as SVGSVGElement & HTMLElement;
  const tooltip = host.querySelector("#chartTooltip") as HTMLElement;

  function visibleSeries(): UnifiedSeries[] {
    return series.filter((s) => s.kind === state.filter);
  }

  function paintList(): void {
    if (state.filter === "tag") {
      // 标签只对个股生效，所以只显示个股列表
      const stockSeries = series.filter((s) => s.kind === "stock");
      let html = "";

      const selectionState = (items: UnifiedSeries[]) => {
        const selected = items.filter((s) => state.selectedKeys.includes(s.key)).length;
        return {
          all: items.length > 0 && selected === items.length,
          partial: selected > 0 && selected < items.length
        };
      };
      
      // 显示全部标签（含空标签），不含颜色
      store.tags.forEach((tag) => {
        const tagStocks = stockSeries.filter((s) => s.tagIds?.includes(tag.id));
        const groupState = selectionState(tagStocks);
        const countLabel = tagStocks.length ? `(${tagStocks.length})` : "";
        html += `
          <div class="tag-group-section" style="margin-bottom: 8px;">
            <div class="tag-group-header" style="display:flex; align-items:center; gap:6px; padding: 4px 6px; background:var(--hover); border-radius:5px;">
              <input type="checkbox" class="tag-group-chk" data-tag-id="${tag.id}" data-partial="${groupState.partial ? "1" : ""}" ${groupState.all ? "checked" : ""} ${tagStocks.length === 0 ? "disabled" : ""} style="cursor:pointer; width:13px; height:13px; accent-color:var(--accent);" />
              <span class="tag-group-name" style="font-size:12px; font-weight:600; color:var(--fg); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:85px;" title="${esc(tag.name)}">${esc(tag.name)} ${countLabel}</span>
            </div>
            ${tagStocks.length > 0 ? `<div class="tag-group-items" style="padding-left:14px; margin-top:4px; display:flex; flex-direction:column; gap:4px;">
              ${tagStocks.map((s) => {
                const checked = state.selectedKeys.includes(s.key);
                return `
                  <div class="idx-item series-item" data-code="${esc(s.code)}" data-kind="${esc(s.kind)}">
                    <input type="checkbox" id="series-${tag.id}-${esc(s.key)}" data-key="${esc(s.key)}" ${checked ? "checked" : ""} />
                    <label for="series-${tag.id}-${esc(s.key)}" title="${esc(seriesRangeTitle(s))}">
                      <span class="idx-name">${esc(s.name)}</span>
                    </label>
                    <button class="tx-op del tag-stock-remove" data-tag-id="${tag.id}" data-code="${esc(s.code)}" title="从该标签移除">${ICONS.del}</button>
                  </div>
                `;
              }).join("")}
            </div>` : ""}
          </div>
        `;
      });
      
      const untaggedStocks = stockSeries.filter((s) => !s.tagIds || s.tagIds.length === 0);
      if (untaggedStocks.length > 0) {
        const groupState = selectionState(untaggedStocks);
        html += `
          <div class="tag-group-section" style="margin-bottom: 8px;">
            <div class="tag-group-header" style="display:flex; align-items:center; gap:6px; padding: 4px 6px; background:var(--hover); border-radius:5px;">
              <input type="checkbox" class="tag-group-chk" data-tag-id="untagged" data-partial="${groupState.partial ? "1" : ""}" ${groupState.all ? "checked" : ""} style="cursor:pointer; width:13px; height:13px; accent-color:var(--accent);" />
              <span class="tag-group-name" style="font-size:12px; font-weight:600; color:var(--fg);">无标签 (${untaggedStocks.length})</span>
            </div>
            <div class="tag-group-items" style="padding-left:14px; margin-top:4px; display:flex; flex-direction:column; gap:4px;">
              ${untaggedStocks.map((s) => {
                const checked = state.selectedKeys.includes(s.key);
                return `
                  <div class="idx-item series-item" data-code="${esc(s.code)}" data-kind="${esc(s.kind)}">
                    <input type="checkbox" id="series-untagged-${esc(s.key)}" data-key="${esc(s.key)}" ${checked ? "checked" : ""} />
                    <label for="series-untagged-${esc(s.key)}" title="${esc(seriesRangeTitle(s))}">
                      <span class="idx-name">${esc(s.name)}</span>
                    </label>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        `;
      }

      list.innerHTML = html;

      list.querySelectorAll<HTMLInputElement>(".tag-group-chk").forEach((input) => {
        input.indeterminate = input.dataset.partial === "1";
      });
      
      const allSelected = stockSeries.length > 0 && stockSeries.every((s) => state.selectedKeys.includes(s.key));
      const someSelected = stockSeries.some((s) => state.selectedKeys.includes(s.key));
      all.checked = allSelected;
      all.indeterminate = someSelected && !allSelected;
      
    } else {
      const rows = visibleSeries();
      if (!rows.length) {
        list.innerHTML = `<div class="empty small">暂无${kindLabel(state.filter)}数据</div>`;
      } else {
        list.innerHTML = rows.map((s) => {
          const checked = state.selectedKeys.includes(s.key);
          const isStock = s.kind === "stock";
          return `<div class="idx-item series-item" data-code="${esc(s.code)}" data-kind="${esc(s.kind)}">
            <input type="checkbox" id="series-${esc(s.key)}" data-key="${esc(s.key)}" ${checked ? "checked" : ""} />
            <label for="series-${esc(s.key)}" title="${esc(seriesRangeTitle(s))}">
              <span class="idx-name">${esc(s.name)}</span>
            </label>
            ${isStock ? `<div class="series-tag-container"></div>` : ""}
            ${s.removable ? `<button class="tx-op del series-del" data-kind="${s.kind}" data-code="${esc(s.code)}" title="删除">${ICONS.del}</button>` : ""}
          </div>`;
        }).join("");
        
        // 只给个股附加标签选择器，大盘/板块/ETF不需要
        list.querySelectorAll<HTMLElement>(".idx-item.series-item").forEach((row) => {
          const kind = row.dataset.kind!;
          if (kind !== "stock") return;
          const code = row.dataset.code!;
          const container = row.querySelector(".series-tag-container") as HTMLElement;
          if (container) {
            const sTags = store.getStockKline(code)?.tagIds || [];
            row.classList.toggle("has-tags", sTags.length > 0);
            container.appendChild(tagPicker(store, sTags, (ids) => {
              row.classList.toggle("has-tags", ids.length > 0);
              void store.setSeriesTags(kind, code, ids);
            }, { noColor: true }));
          }
        });
      }
      const keys = rows.map((s) => s.key);
      const selected = keys.filter((key) => state.selectedKeys.includes(key));
      all.checked = keys.length > 0 && selected.length === keys.length;
      all.indeterminate = selected.length > 0 && selected.length < keys.length;
    }
  }

  function paintRangeControls(): void {
    const headCenter = document.getElementById("headCenter");
    if (!headCenter) return;
    const groups = periodGroups(series);
    const periodLabel = state.rangeMode === "period" && state.periodLabel ? state.periodLabel : "年份/季度";

    headCenter.innerHTML = `
      <div class="range-switch" id="rangeSwitch">
        <select class="range-control ${state.rangeMode === "recent" ? "on" : ""}" id="recentRange" title="最近时间范围">
          <option value="" disabled ${state.rangeMode !== "recent" ? "selected" : ""}>最近范围</option>
          ${RECENT_RANGES.map((r) => `<option value="${r.value}" ${state.rangeMode === "recent" && state.timeframe === r.value ? "selected" : ""}>${r.label}</option>`).join("")}
        </select>
        <div class="range-period ${state.rangeMode === "period" ? "on" : ""}" id="periodRange">
          <button class="range-control range-period-trigger" type="button" title="特定年份或季度">${esc(periodLabel)}</button>
          <div class="range-period-menu">
            ${groups.map((group) => `
              <div class="range-period-year">
                <button class="range-period-year-btn" type="button">${group.year}年</button>
                <div class="range-period-submenu">
                  ${group.items.map((item) => {
                    const label = item.label === "全年" ? `${group.year}全年` : `${group.year}${item.label}`;
                    const on = state.rangeMode === "period" && state.periodStart === item.start && state.periodEnd === item.end;
                    return `<button class="period-option${on ? " on" : ""}" type="button" data-start="${item.start}" data-end="${item.end}" data-label="${esc(label)}">${esc(item.label)}</button>`;
                  }).join("")}
                </div>
              </div>
            `).join("")}
          </div>
        </div>
        <input class="range-control since-control ${state.rangeMode === "since" ? "on" : ""}" id="sinceRange" type="${state.rangeMode === "since" ? "date" : "text"}" value="${esc(state.sinceDate || "")}" placeholder="起始日期" title="从选定日期到最新数据" />
      </div>
    `;

    const recentRange = headCenter.querySelector("#recentRange") as HTMLSelectElement;
    const periodRange = headCenter.querySelector("#periodRange") as HTMLElement;
    const periodTrigger = headCenter.querySelector(".range-period-trigger") as HTMLButtonElement;
    const sinceRange = headCenter.querySelector("#sinceRange") as HTMLInputElement;
    const dates = series.flatMap((s) => s.rows.map((r) => r.date)).filter(Boolean).sort();
    if (dates[0]) sinceRange.min = dates[0];
    if (dates[dates.length - 1]) sinceRange.max = dates[dates.length - 1];

    // 全程原地更新三个控件，从不重建 DOM：既保住日期框的焦点，
    // 也避免重建后鼠标静止在按钮上、:hover 不重新触发而必须先点一下才弹出子菜单的问题。
    const syncRangeUI = () => {
      recentRange.classList.toggle("on", state.rangeMode === "recent");
      periodRange.classList.toggle("on", state.rangeMode === "period");
      sinceRange.classList.toggle("on", state.rangeMode === "since");
      recentRange.value = state.rangeMode === "recent" ? (state.timeframe || "1Y") : "";
      periodTrigger.textContent = state.rangeMode === "period" && state.periodLabel ? state.periodLabel : "年份/季度";
      periodRange.querySelectorAll<HTMLButtonElement>(".period-option").forEach((opt) => {
        const on = state.rangeMode === "period" && opt.dataset.start === state.periodStart && opt.dataset.end === state.periodEnd;
        opt.classList.toggle("on", on);
      });
      if (state.rangeMode !== "since") {
        sinceRange.value = "";
        if (document.activeElement !== sinceRange) sinceRange.type = "text";
      }
    };

    recentRange.addEventListener("change", () => {
      if (!recentRange.value) return; // 选中占位项时忽略
      state.rangeMode = "recent";
      state.timeframe = recentRange.value;
      state.periodStart = undefined;
      state.periodEnd = undefined;
      state.periodLabel = undefined;
      state.sinceDate = undefined;
      saveState(state);
      syncRangeUI();
      drawChart();
      fit();
    });
    periodRange.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".period-option") as HTMLButtonElement | null;
      if (!btn) return;
      const start = btn.dataset.start || "";
      const end = btn.dataset.end || "";
      const label = btn.dataset.label || "";
      if (!start || !end) return;
      state.rangeMode = "period";
      state.periodStart = start;
      state.periodEnd = end;
      state.periodLabel = label;
      state.sinceDate = undefined;
      saveState(state);
      syncRangeUI();
      // 选完立刻收起菜单，避免重建造成的 hover 卡顿；移开再悬停即可重新展开
      periodTrigger.blur();
      drawChart();
      fit();
    });
    sinceRange.addEventListener("focus", () => {
      sinceRange.type = "date";
      if (dates[0]) sinceRange.min = dates[0];
      if (dates[dates.length - 1]) sinceRange.max = dates[dates.length - 1];
    });
    sinceRange.addEventListener("blur", () => {
      if (!sinceRange.value && state.rangeMode !== "since") sinceRange.type = "text";
    });
    // 日期输入：原地更新，绝不重建控件，否则每敲一位就丢失焦点
    sinceRange.addEventListener("change", () => {
      if (!sinceRange.value) {
        state.rangeMode = "recent";
        state.timeframe = state.timeframe || "1Y";
        state.sinceDate = undefined;
      } else {
        state.rangeMode = "since";
        state.sinceDate = sinceRange.value;
        state.periodStart = undefined;
        state.periodEnd = undefined;
        state.periodLabel = undefined;
      }
      saveState(state);
      syncRangeUI();
      drawChart();
      fit();
    });
  }

  function selectedSeries(): UnifiedSeries[] {
    const selected = new Set(state.selectedKeys);
    return series.filter((s) => selected.has(s.key));
  }

  function drawChart(): void {
    const chosen = selectedSeries();
    const clearLegend = () => {
      const legendEl = host.querySelector("#chartLegend") as HTMLElement | null;
      if (!legendEl) return;
      legendEl.style.display = "none";
      legendEl.innerHTML = "";
    };
    // 单选 → 绝对实值；多选 → 自动归一到 100 起点对比
    const normalize = chosen.length > 1;
    if (!chosen.length) {
      chartSvg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="var(--fg-faint)" font-size="14">请从左侧勾选需要对比的标的</text>`;
      tooltip.style.display = "none";
      clearLegend();
      return;
    }

    const sortedDates = chosen.flatMap((s) => s.rows.map((r) => r.date)).sort();
    const latestDate = sortedDates[sortedDates.length - 1] || String(marketData.end_date);
    const rangeStart = state.rangeMode === "period" && state.periodStart
      ? state.periodStart
      : state.rangeMode === "since" && state.sinceDate
        ? state.sinceDate
        : getStartDate(latestDate, state.timeframe || "1Y");
    const rangeEnd = state.rangeMode === "period" && state.periodEnd ? state.periodEnd : latestDate;
    const activeSeries: Array<UnifiedSeries & { rows: Array<Row & { value: number; dailyPct?: number }> }> = [];
    const allDatesSet = new Set<string>();
    let globalMin = Infinity;
    let globalMax = -Infinity;

    chosen.forEach((s) => {
      const filtered = [...s.rows].filter((row) => row.date >= rangeStart && row.date <= rangeEnd).sort((a, b) => a.date.localeCompare(b.date));
      if (!filtered.length) return;
      const baseClose = filtered[0].close;
      if (!baseClose) return;
      const rows = filtered.map((row, idx) => {
        const value = normalize ? (row.close / baseClose) * 100 : row.close;
        const prevClose = idx > 0 ? filtered[idx - 1].close : undefined;
        const dailyPct = prevClose ? ((row.close - prevClose) / prevClose) * 100 : undefined;
        globalMin = Math.min(globalMin, value);
        globalMax = Math.max(globalMax, value);
        allDatesSet.add(row.date);
        return { ...row, value, dailyPct };
      });
      const tempColor = PALETTE[activeSeries.length % PALETTE.length];
      activeSeries.push({ ...s, color: tempColor, rows });
    });

    if (!activeSeries.length) {
      chartSvg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="var(--fg-faint)" font-size="14">选定区间内无行情数据</text>`;
      tooltip.style.display = "none";
      clearLegend();
      return;
    }

    const allDates = Array.from(allDatesSet).sort();
    const width = chartContainer.clientWidth || 700;
    const height = chartContainer.clientHeight || 340;
    const margin = { top: 15, right: 16, bottom: 42, left: 42 };
    const plotWidth = Math.max(80, width - margin.left - margin.right);
    const plotHeight = Math.max(80, height - margin.top - margin.bottom);
    const xScale = (dateStr: string) => {
      const idx = allDates.indexOf(dateStr);
      if (idx < 0 || allDates.length <= 1) return margin.left;
      return margin.left + (idx / (allDates.length - 1)) * plotWidth;
    };

    // 多选用涨跌幅%（围绕 0），单选用绝对实值；统一线性轴
    const pad = Math.max((globalMax - globalMin) * 0.08, normalize ? 1.5 : Math.max(globalMax * 0.01, 1e-6));
    const yMin = normalize ? Math.min(98, globalMin - pad) : Math.max(0, globalMin - pad);
    const yMax = normalize ? Math.max(102, globalMax + pad) : globalMax + pad;
    const toY = (val: number) => margin.top + (1 - (val - yMin) / (yMax - yMin)) * plotHeight;
    const axisVals: number[] = [];
    for (let i = 0; i <= 5; i++) axisVals.push(yMin + (i / 5) * (yMax - yMin));

    let svgHtml = "";
    for (const val of axisVals) {
      const y = toY(val);
      svgHtml += `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="var(--line)" stroke-width="1" stroke-dasharray="3,3" />
        <text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" fill="var(--fg-faint)" font-size="10" font-family="monospace">${formatAxis(val, normalize)}</text>`;
    }
    if (normalize) {
      const y100 = toY(100);
      svgHtml += `<line x1="${margin.left}" y1="${y100}" x2="${width - margin.right}" y2="${y100}" stroke="var(--line-strong)" stroke-width="1" stroke-dasharray="5,2" />`;
    }

    const tickCount = Math.max(3, Math.min(7, Math.floor(plotWidth / 95)));
    const tickIdxs = new Set<number>();
    for (let i = 0; i < tickCount; i++) {
      tickIdxs.add(Math.round((i / Math.max(1, tickCount - 1)) * (allDates.length - 1)));
    }
    Array.from(tickIdxs).sort((a, b) => a - b).forEach((idx) => {
      const dateStr = allDates[idx];
      svgHtml += `<text x="${xScale(dateStr)}" y="${height - 16}" text-anchor="middle" fill="var(--fg-faint)" font-size="10">${dateStr.slice(2)}</text>`;
    });

    activeSeries.forEach((s) => {
      const pathD = s.rows.map((row, i) => `${i === 0 ? "M" : "L"} ${xScale(row.date)} ${toY(row.value)}`).join(" ");
      svgHtml += `<path class="series-path" data-key="${esc(s.key)}" d="${pathD}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`;
    });
    svgHtml += `<line id="hoverLine" x1="0" y1="${margin.top}" x2="0" y2="${height - margin.bottom}" stroke="var(--fg-soft)" stroke-width="1" stroke-dasharray="2,2" style="display:none;" />
      <g id="hoverDots"></g>
      <rect id="hoverOverlay" x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" fill="transparent" style="cursor:crosshair;" />`;
    chartSvg.innerHTML = svgHtml;

    const overlay = chartSvg.querySelector("#hoverOverlay") as SVGRectElement | null;
    const hoverLine = chartSvg.querySelector("#hoverLine") as SVGLineElement | null;
    const hoverDotsGroup = chartSvg.querySelector("#hoverDots") as SVGGElement | null;
    if (!overlay || !hoverLine || !hoverDotsGroup) return;

    const applySeriesFocus = (key: string | null) => {
      chartSvg.querySelectorAll<SVGPathElement>(".series-path").forEach((path) => {
        const on = !key || path.dataset.key === key;
        path.style.opacity = on ? "1" : "0.16";
        path.style.strokeWidth = on && key ? "2.8" : "2";
      });
      const legendEl = host.querySelector("#chartLegend") as HTMLElement | null;
      legendEl?.querySelectorAll<HTMLElement>(".legend-item[data-key]").forEach((item) => {
        const on = !key || item.dataset.key === key;
        item.classList.toggle("is-dim", !on);
        item.classList.toggle("is-focused", !!key && on);
      });
    };
    chartSvg.querySelectorAll<SVGPathElement>(".series-path").forEach((path) => {
      path.addEventListener("mouseenter", () => applySeriesFocus(path.dataset.key || null));
      path.addEventListener("mouseleave", () => applySeriesFocus(lockedSeriesKey));
      path.addEventListener("click", () => {
        lockedSeriesKey = lockedSeriesKey === path.dataset.key ? null : path.dataset.key || null;
        applySeriesFocus(lockedSeriesKey);
      });
    });

    const onLeave = () => {
      hoverLine.style.display = "none";
      hoverDotsGroup.innerHTML = "";
      tooltip.style.display = "none";
      applySeriesFocus(lockedSeriesKey);
    };
    overlay.addEventListener("mousemove", (e) => {
      const rect = chartSvg.getBoundingClientRect();
      const plotX = e.clientX - rect.left - margin.left;
      if (plotX < 0 || plotX > plotWidth) {
        onLeave();
        return;
      }
      const targetIdx = Math.min(allDates.length - 1, Math.max(0, Math.round((plotX / plotWidth) * (allDates.length - 1))));
      const targetDate = allDates[targetIdx];
      const cx = xScale(targetDate);
      hoverLine.setAttribute("x1", String(cx));
      hoverLine.setAttribute("x2", String(cx));
      hoverLine.style.display = "block";

      const mouseY = e.clientY - rect.top;
      const currentData: Array<{ key: string; name: string; color: string; original: number; value: number; y: number; dailyPct?: number }> = [];
      hoverDotsGroup.innerHTML = activeSeries.map((s) => {
        const matched = s.rows.find((r) => r.date === targetDate);
        if (!matched) return "";
        const cy = toY(matched.value);
        currentData.push({ key: s.key, name: s.name, color: s.color, original: matched.close, value: matched.value, y: cy, dailyPct: matched.dailyPct });
        return `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${s.color}" stroke="var(--card)" stroke-width="1.5" />`;
      }).join("");
      if (!lockedSeriesKey && currentData.length > 1) {
        // 只有当鼠标确实贴近某条折线（纵向 14px 内）才聚焦它；空白处不强行高亮最近线
        const FOCUS_THRESHOLD = 14;
        let nearest: (typeof currentData)[number] | null = null;
        let best = Infinity;
        for (const d of currentData) {
          const dist = Math.abs(d.y - mouseY);
          if (dist < best) {
            best = dist;
            nearest = d;
          }
        }
        applySeriesFocus(best <= FOCUS_THRESHOLD ? nearest?.key || null : null);
      }
      currentData.sort((a, b) => b.value - a.value);
      tooltip.innerHTML = `<div class="tooltip-date">${targetDate}</div><div class="tooltip-rows">${currentData.map((d) => {
        const chg = d.dailyPct;
        const cls = chg > 0 ? "up" : chg < 0 ? "down" : "";
        const pct = chg == null ? "—" : `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`;
        return `<div class="tooltip-row"><span class="dot" style="background:${d.color}"></span><span class="name">${esc(d.name)}</span><span class="val">${d.original.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</span><span class="norm ${cls}">${pct}</span></div>`;
      }).join("")}</div>`;
      tooltip.style.display = "block";
      const tooltipRect = tooltip.getBoundingClientRect();
      let left = cx + 15;
      if (left + tooltipRect.width > width - 10) left = cx - tooltipRect.width - 15;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${margin.top + 10}px`;
    });
    overlay.addEventListener("mouseleave", onLeave);

    const legendEl = host.querySelector("#chartLegend") as HTMLElement | null;
    if (legendEl) {
      if (activeSeries.length > 0) {
        legendEl.style.display = "flex";
        legendEl.innerHTML = activeSeries.map((s) => `
          <button class="legend-item" data-key="${esc(s.key)}" title="${esc(seriesRangeTitle(s))}">
            <span class="legend-marker">
              <span class="legend-line" style="background:${s.color}"></span>
              <span class="legend-dot" style="background:${s.color}"></span>
            </span>
            <span class="legend-name">${esc(s.name)}</span>
          </button>
        `).join("") + `<button class="legend-clear" id="legendClear" title="清空所有选中标的">清空</button>`;
        legendEl.querySelectorAll<HTMLButtonElement>(".legend-item[data-key]").forEach((item) => {
          item.addEventListener("mouseenter", () => applySeriesFocus(item.dataset.key || null));
          item.addEventListener("mouseleave", () => applySeriesFocus(lockedSeriesKey));
          item.addEventListener("click", () => {
            lockedSeriesKey = lockedSeriesKey === item.dataset.key ? null : item.dataset.key || null;
            applySeriesFocus(lockedSeriesKey);
          });
        });
        (legendEl.querySelector("#legendClear") as HTMLButtonElement | null)?.addEventListener("click", () => {
          lockedSeriesKey = null;
          state.selectedKeys = [];
          saveState(state);
          paintList();
          drawChart();
          fit();
        });
        applySeriesFocus(lockedSeriesKey);
      } else {
        legendEl.style.display = "none";
        legendEl.innerHTML = "";
      }
    }
  }

  host.querySelectorAll<HTMLButtonElement>(".market-hub-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filter = btn.dataset.pane as MarketPane;
      saveState(state);
      renderMarketHub(host, store, fit);
    });
  });
  list.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    if (!input) return;
    if (input.classList.contains("tag-group-chk")) {
      const tagId = input.dataset.tagId!;
      const stocks = series.filter((s) => s.kind === "stock");
      const tagStocks = tagId === "untagged"
        ? stocks.filter((s) => !(s as any).tagIds || (s as any).tagIds.length === 0)
        : stocks.filter((s) => (s as any).tagIds?.includes(tagId));
      const keys = tagStocks.map((s) => s.key);
      if (input.checked) {
        state.selectedKeys = Array.from(new Set([...state.selectedKeys, ...keys]));
      } else {
        state.selectedKeys = state.selectedKeys.filter((key) => !keys.includes(key));
      }
      saveState(state);
      paintList();
      drawChart();
      fit();
    } else if (input.dataset.key) {
      state.selectedKeys = input.checked
        ? Array.from(new Set([...state.selectedKeys, input.dataset.key]))
        : state.selectedKeys.filter((key) => key !== input.dataset.key);
      saveState(state);
      paintList();
      drawChart();
      fit();
    }
  });
  list.addEventListener("click", async (e) => {
    // 标签分组内：从当前标签移除个股；个股本身保留，若无其它标签会进入「无标签」。
    const tagStockRemoveBtn = (e.target as HTMLElement).closest(".tag-stock-remove") as HTMLButtonElement | null;
    if (tagStockRemoveBtn) {
      e.stopPropagation();
      const tagId = tagStockRemoveBtn.dataset.tagId!;
      const code = tagStockRemoveBtn.dataset.code!;
      const stock = store.getStockKline(code);
      if (!stock) return;
      await store.setStockKlineTags(code, (stock.tagIds || []).filter((id) => id !== tagId));
      renderMarketHub(host, store, fit);
      return;
    }

    // 标的删除按钮
    const btn = (e.target as HTMLElement).closest(".series-del") as HTMLButtonElement | null;
    if (!btn) return;
    const kind = btn.dataset.kind as MarketPane;
    const code = btn.dataset.code!;
    if (kind === "stock") await store.removeStockKline(code);
    else await store.removeMarketSeries(kind as MarketKind, code);
    state.selectedKeys = state.selectedKeys.filter((key) => key !== seriesKey(kind, code));
    saveState(state);
    renderMarketHub(host, store, fit);
  });
  all.addEventListener("change", () => {
    const keys = visibleSeries().map((s) => s.key);
    state.selectedKeys = all.checked
      ? Array.from(new Set([...state.selectedKeys, ...keys]))
      : state.selectedKeys.filter((key) => !keys.includes(key));
    saveState(state);
    paintList();
    drawChart();
    fit();
  });
  paintList();
  paintRangeControls();

  if ((host as any)._chartObserver) {
    try {
      (host as any)._chartObserver.disconnect();
    } catch (err) {
      console.warn("Failed to disconnect chart observer", err);
    }
  }
  const observer = new ResizeObserver(() => drawChart());
  observer.observe(chartContainer);
  (host as any)._chartObserver = observer;

  setTimeout(() => {
    drawChart();
    fit();
  }, 30);
}

function formatAxis(value: number, normalize: boolean): string {
  if (normalize) return value.toFixed(0);
  if (value >= 1000) return value.toFixed(0);
  if (value >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

export function indexInfos(): IndexInfo[] {
  return [...INDICES_INFO];
}

export function defaultRefreshRange(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  return { startDate: dateStr(start), endDate: dateStr(end) };
}

function dateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
