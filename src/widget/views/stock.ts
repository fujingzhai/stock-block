import { StockStore } from "../../shared/store";
import { StockKline, getStartDate } from "../../shared/model";
import { ICONS, esc } from "../ui";

interface StockState {
  activeCode: string; // 当前激活（选中）的个股代码（单选实际价格模式）
  checkedCodes: string[]; // 勾选用于对比的个股代码列表（多选归一化模式）
  timeframe: string;
}

const STORAGE_KEY = "stock-block-stock-view-state";

export interface KlineViewOptions {
  storageKey?: string;
  emptyText?: string;
  list?: () => StockKline[];
  remove?: (code: string) => Promise<void>;
}

function loadState(stocks: StockKline[], storageKey: string): StockState {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed.activeCode === "string" && Array.isArray(parsed.checkedCodes) && typeof parsed.timeframe === "string") {
        // 校验缓存的代码是否还存在
        const exists = (c: string) => stocks.some((s) => s.code === c);
        return {
          activeCode: exists(parsed.activeCode) ? parsed.activeCode : "",
          checkedCodes: parsed.checkedCodes.filter(exists),
          timeframe: parsed.timeframe
        };
      }
    }
  } catch {
    // ignore
  }

  return {
    activeCode: "",
    checkedCodes: [],
    timeframe: "1Y"
  };
}

function saveState(state: StockState, storageKey: string) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // ignore
  }
}

const PALETTE = [
  "#1890ff", // 蓝色
  "#52c41a", // 绿色
  "#ff4d4f", // 红色
  "#722ed1", // 紫色
  "#fa8c16", // 橙色
  "#13c2c2", // 青色
  "#eb2f96", // 洋红
  "#2f54eb", // 靛青
  "#ffa940", // 金黄
  "#fadb14"  // 黄色
];

export function renderStock(host: HTMLElement, store: StockStore, fit: () => void, options: KlineViewOptions = {}): void {
  const storageKey = options.storageKey || STORAGE_KEY;
  const getStocks = options.list || (() => store.individualStocks);
  const removeStock = options.remove || ((code: string) => store.removeStockKline(code));
  const stocks = getStocks();

  if (!stocks.length) {
    host.innerHTML = `
      <div class="empty">
        ${esc(options.emptyText || "还没有导入任何个股。请在右上输入代码或名称，点「获取」导入历史行情。")}
      </div>
    `;
    fit();
    return;
  }

  const state = loadState(stocks, storageKey);

  // 1. 初始化 DOM 框架
  host.innerHTML = `
    <div class="stock-view">
      <div class="stock-left" id="stockList"></div>
      <div class="stock-right">
        <div class="market-control-bar">
          <div class="time-tabs" id="stockTimeTabs">
            <button class="time-tab" data-t="1M">1个月</button>
            <button class="time-tab" data-t="3M">3个月</button>
            <button class="time-tab" data-t="6M">6个月</button>
            <button class="time-tab" data-t="1Y">1年</button>
            <button class="time-tab" data-t="YTD">今年以来</button>
            <button class="time-tab" data-t="All">全部</button>
          </div>
          <span class="norm-tip" id="stockChartTip">个股实际价格走势</span>
        </div>
        <div class="chart-canvas-container" id="stockChartContainer">
          <svg id="stockChartSvg" style="width:100%; height:100%; display:block; overflow:visible;"></svg>
          <div id="stockChartTooltip" class="chart-tooltip" style="display:none; position:absolute; pointer-events:none; z-index:100;"></div>
        </div>
      </div>
    </div>
  `;

  const stockList = host.querySelector("#stockList") as HTMLElement;
  const timeTabs = host.querySelector("#stockTimeTabs") as HTMLElement;
  const chartTip = host.querySelector("#stockChartTip") as HTMLElement;
  const chartContainer = host.querySelector("#stockChartContainer") as HTMLElement;
  const chartSvg = host.querySelector("#stockChartSvg") as unknown as SVGSVGElement & HTMLElement;
  const tooltip = host.querySelector("#stockChartTooltip") as HTMLElement;

  // 2. 渲染左侧个股列表
  function renderStockList() {
    const isCompMode = state.checkedCodes.length >= 2;
    stockList.innerHTML = stocks.map((s) => {
      const isChecked = state.checkedCodes.includes(s.code);
      // 在多选对比模式下，不显示 active 激活状态；在单选模式下，activeCode 显示高亮
      const isActive = !isCompMode && state.activeCode === s.code;
      return `
        <div class="stock-list-item${isActive ? " on" : ""}" data-code="${s.code}">
          <input type="checkbox" class="stock-chk" data-code="${s.code}" ${isChecked ? "checked" : ""} />
          <div class="stock-info">
            <span class="stock-name" title="${esc(s.name)}">${esc(s.name)}</span>
            <span class="stock-code">${s.code}</span>
          </div>
          <button class="tx-op del stock-del-btn" data-code="${s.code}" title="删除">${ICONS.del}</button>
        </div>
      `;
    }).join("");
  }

  // 3. 渲染时间范围 Tab
  function renderTimeTabs() {
    timeTabs.querySelectorAll<HTMLButtonElement>(".time-tab").forEach((btn) => {
      if (btn.dataset.t === state.timeframe) {
        btn.classList.add("on");
      } else {
        btn.classList.remove("on");
      }
    });
  }

  // 4. 重绘图表
  function drawChart() {
    const isCompMode = state.checkedCodes.length >= 2;

    // 4.1 确定当前参与绘制的个股列表
    let drawStocks: StockKline[] = [];
    if (isCompMode) {
      drawStocks = stocks.filter((s) => state.checkedCodes.includes(s.code));
      chartTip.textContent = "起点归一化 100 对比";
    } else {
      // 单股模式：如果勾选了 1 个，以勾选的为准；否则以 activeCode 为准
      const targetCode = state.checkedCodes.length === 1 ? state.checkedCodes[0] : state.activeCode;
      const singleStock = stocks.find((s) => s.code === targetCode);
      if (singleStock) {
        drawStocks = [singleStock];
        chartTip.textContent = `${singleStock.name} (${singleStock.code}) 实际价格`;
      }
    }

    if (!drawStocks.length) {
      chartSvg.innerHTML = `
        <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="var(--fg-faint)" font-size="14">
          请从左侧列表勾选或点击个股以显示走势图
        </text>
      `;
      tooltip.style.display = "none";
      return;
    }

    // 4.2 数据过滤和归一化处理
    const seriesData: {
      code: string;
      name: string;
      color: string;
      rows: { date: string; close: number; displayVal: number }[];
    }[] = [];

    let globalMin = Infinity;
    let globalMax = -Infinity;
    const allDatesSet = new Set<string>();

    // 为对比模式分配颜色索引
    drawStocks.forEach((s, sIdx) => {
      const klines = s.klines;
      if (!klines || !klines.length) return;

      // 提取最新的日期，用于倒推区间
      const maxDateInStock = klines[klines.length - 1].date;
      const startDateStr = getStartDate(maxDateInStock, state.timeframe);

      const filtered = klines.filter((k) => k.date >= startDateStr);
      if (!filtered.length) return;

      const sorted = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
      const basePrice = sorted[0].close;

      const color = isCompMode ? PALETTE[sIdx % PALETTE.length] : "var(--accent)";

      const mappedRows = sorted.map((row) => {
        // 如果是对比模式，值为归一化 100；如果是单股模式，值为实际价格
        const displayVal = isCompMode ? (row.close / basePrice) * 100 : row.close;
        if (displayVal < globalMin) globalMin = displayVal;
        if (displayVal > globalMax) globalMax = displayVal;
        allDatesSet.add(row.date);

        return {
          date: row.date,
          close: row.close,
          displayVal: displayVal
        };
      });

      seriesData.push({
        code: s.code,
        name: s.name,
        color: color,
        rows: mappedRows
      });
    });

    if (!seriesData.length) {
      chartSvg.innerHTML = `
        <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="var(--fg-faint)" font-size="14">
          所选区间内无历史价格数据
        </text>
      `;
      tooltip.style.display = "none";
      return;
    }

    const allDates = Array.from(allDatesSet).sort();
    let yMin = globalMin;
    let yMax = globalMax;

    if (isCompMode) {
      yMin = Math.min(98, globalMin - 1.5);
      yMax = Math.max(102, globalMax + 1.5);
    } else {
      // 单股模式，上下保留 3% 留白
      const diff = yMax - yMin;
      if (diff === 0) {
        yMin = yMin * 0.95;
        yMax = yMax * 1.05;
      } else {
        yMin = Math.max(0, yMin - diff * 0.05);
        yMax = yMax + diff * 0.05;
      }
    }

    // 4.3 物理尺寸映射
    const width = chartContainer.clientWidth || 600;
    const height = chartContainer.clientHeight || 320;

    const margin = { top: 15, right: 15, bottom: 25, left: 45 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const xScale = (dateStr: string) => {
      const idx = allDates.indexOf(dateStr);
      if (idx === -1 || allDates.length <= 1) return margin.left;
      return margin.left + (idx / (allDates.length - 1)) * plotWidth;
    };

    const yScale = (val: number) => {
      return margin.top + (1 - (val - yMin) / (yMax - yMin)) * plotHeight;
    };

    // 4.4 渲染网格与折线
    let svgHtml = "";

    // A. 绘制 Y 轴虚线网格
    const yGridTicks = 5;
    for (let i = 0; i <= yGridTicks; i++) {
      const val = yMin + (i / yGridTicks) * (yMax - yMin);
      const y = yScale(val);
      svgHtml += `
        <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" 
              stroke="var(--line)" stroke-width="1" stroke-dasharray="3,3" />
        <text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" fill="var(--fg-faint)" font-size="10" font-family="monospace">
          ${val.toFixed(isCompMode ? 0 : 2)}
        </text>
      `;
    }

    // B. 对比模式下绘制 100 起点虚线
    if (isCompMode && yMin <= 100 && yMax >= 100) {
      const y100 = yScale(100);
      svgHtml += `
        <line x1="${margin.left}" y1="${y100}" x2="${width - margin.right}" y2="${y100}" 
              stroke="var(--line-strong)" stroke-width="1.2" stroke-dasharray="5,2" />
      `;
    }

    // C. 绘制 X 轴时间
    const dateTicks = 5;
    const dateStep = Math.max(1, Math.floor(allDates.length / dateTicks));
    for (let i = 0; i < allDates.length; i += dateStep) {
      const dateStr = allDates[i];
      const x = xScale(dateStr);
      svgHtml += `
        <text x="${x}" y="${height - 6}" text-anchor="middle" fill="var(--fg-faint)" font-size="10">
          ${dateStr.substring(2)}
        </text>
      `;
    }
    if ((allDates.length - 1) % dateStep !== 0) {
      const lastDate = allDates[allDates.length - 1];
      svgHtml += `
        <text x="${xScale(lastDate)}" y="${height - 6}" text-anchor="middle" fill="var(--fg-faint)" font-size="10">
          ${lastDate.substring(2)}
        </text>
      `;
    }

    // D. 绘制折线
    seriesData.forEach((s) => {
      let pathD = "";
      s.rows.forEach((row, i) => {
        const x = xScale(row.date);
        const y = yScale(row.displayVal);
        if (i === 0) {
          pathD += `M ${x} ${y}`;
        } else {
          pathD += ` L ${x} ${y}`;
        }
      });
      svgHtml += `
        <path d="${pathD}" fill="none" stroke="${s.color}" stroke-width="2" 
              stroke-linejoin="round" stroke-linecap="round" />
      `;
    });

    // E. 交互层
    svgHtml += `
      <line id="stockHoverLine" x1="0" y1="${margin.top}" x2="0" y2="${height - margin.bottom}" 
            stroke="var(--fg-soft)" stroke-width="1" stroke-dasharray="2,2" style="display:none;" />
      <g id="stockHoverDots"></g>
      <rect id="stockHoverOverlay" x="${margin.left}" y="${margin.top}" 
            width="${plotWidth}" height="${plotHeight}" fill="transparent" style="cursor:crosshair;" />
    `;

    chartSvg.innerHTML = svgHtml;

    // 4.5 Hover 悬停交互事件绑定
    const overlay = chartSvg.querySelector("#stockHoverOverlay") as SVGRectElement | null;
    const hoverLine = chartSvg.querySelector("#stockHoverLine") as SVGLineElement | null;
    const hoverDotsGroup = chartSvg.querySelector("#stockHoverDots") as SVGGElement | null;

    if (overlay && hoverLine && hoverDotsGroup) {
      const onMove = (e: MouseEvent) => {
        const rect = chartSvg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const plotX = mouseX - margin.left;

        if (plotX < 0 || plotX > plotWidth) {
          onLeave();
          return;
        }

        const ratio = plotX / plotWidth;
        const targetIdx = Math.min(
          allDates.length - 1,
          Math.max(0, Math.round(ratio * (allDates.length - 1)))
        );
        const targetDate = allDates[targetIdx];
        const cx = xScale(targetDate);

        // A. 垂直十字线
        hoverLine.setAttribute("x1", String(cx));
        hoverLine.setAttribute("x2", String(cx));
        hoverLine.style.display = "block";

        // B. 圆点及 Tooltip 组装
        const currentData: {
          name: string;
          color: string;
          original: number;
          displayVal: number;
          chgPct?: number; // 单股模式下，自起点以来的涨跌幅
        }[] = [];

        let dotsHtml = "";
        seriesData.forEach((s) => {
          const matched = s.rows.find((r) => r.date === targetDate);
          if (matched) {
            const cy = yScale(matched.displayVal);
            dotsHtml += `
              <circle cx="${cx}" cy="${cy}" r="4.5" fill="${s.color}" stroke="var(--card)" stroke-width="1.5" />
            `;

            // 计算单股模式的涨跌幅
            let chgPct: number | undefined;
            if (!isCompMode && s.rows.length) {
              const basePrice = s.rows[0].close;
              chgPct = basePrice ? ((matched.close - basePrice) / basePrice) * 100 : 0;
            }

            currentData.push({
              name: s.name,
              color: s.color,
              original: matched.close,
              displayVal: matched.displayVal,
              chgPct: chgPct
            });
          }
        });

        hoverDotsGroup.innerHTML = dotsHtml;

        // C. 排版 Tooltip
        let itemsHtml = "";
        if (isCompMode) {
          // 对比模式：按业绩降序排列
          currentData.sort((a, b) => b.displayVal - a.displayVal);
          itemsHtml = currentData.map((d) => {
            const chg = d.displayVal - 100;
            const chgText = chg >= 0 ? `+${chg.toFixed(2)}%` : `${chg.toFixed(2)}%`;
            const chgCls = chg > 0 ? "up" : chg < 0 ? "down" : "";
            return `
              <div class="tooltip-row">
                <span class="dot" style="background:${d.color}"></span>
                <span class="name">${d.name}</span>
                <span class="val">${d.original.toFixed(2)}</span>
                <span class="norm ${chgCls}">${chgText}</span>
              </div>
            `;
          }).join("");
        } else {
          // 单个股模式：显示实际收盘价和相对于起点的累计涨跌幅
          const d = currentData[0];
          if (d) {
            const chg = d.chgPct || 0;
            const chgText = chg >= 0 ? `+${chg.toFixed(2)}%` : `${chg.toFixed(2)}%`;
            const chgCls = chg > 0 ? "up" : chg < 0 ? "down" : "";
            itemsHtml = `
              <div class="tooltip-row" style="margin-bottom: 4px;">
                <span class="name">收盘价格:</span>
                <span class="val" style="font-weight:bold; font-size:12.5px;">${d.original.toFixed(2)}</span>
              </div>
              <div class="tooltip-row">
                <span class="name">累计涨跌:</span>
                <span class="norm ${chgCls}" style="font-weight:bold;">${chgText}</span>
              </div>
            `;
          }
        }

        tooltip.innerHTML = `
          <div class="tooltip-date">${targetDate}</div>
          <div class="tooltip-rows">${itemsHtml}</div>
        `;
        tooltip.style.display = "block";

        const tooltipRect = tooltip.getBoundingClientRect();
        let leftPos = cx + 15;
        if (leftPos + tooltipRect.width > width - 10) {
          leftPos = cx - tooltipRect.width - 15;
        }
        tooltip.style.left = `${leftPos}px`;
        tooltip.style.top = `${margin.top + 10}px`;
      };

      const onLeave = () => {
        hoverLine.style.display = "none";
        hoverDotsGroup.innerHTML = "";
        tooltip.style.display = "none";
      };

      overlay.addEventListener("mousemove", onMove);
      overlay.addEventListener("mouseleave", onLeave);
    }
  }

  // 5. 绑定交互事件监听器
  // A. 左侧列表点击与勾选事件
  stockList.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;

    // 1. 如果是点击删除按钮
    const delBtn = target.closest(".stock-del-btn") as HTMLButtonElement | null;
    if (delBtn) {
      e.stopPropagation();
      const code = delBtn.dataset.code!;
      await removeStock(code);
      
      // 更新状态缓存
      if (state.activeCode === code) {
        state.activeCode = "";
      }
      state.checkedCodes = state.checkedCodes.filter((c) => c !== code);
      saveState(state, storageKey);
      
      // 重绘
      renderStock(host, store, fit, options);
      return;
    }

    // 2. 如果是点击 checkbox 选框
    const chk = target.closest(".stock-chk") as HTMLInputElement | null;
    if (chk) {
      const code = chk.dataset.code!;
      if (chk.checked) {
        if (!state.checkedCodes.includes(code)) {
          state.checkedCodes.push(code);
        }
      } else {
        state.checkedCodes = state.checkedCodes.filter((c) => c !== code);
      }
      saveState(state, storageKey);
      renderStockList();
      drawChart();
      return;
    }

    // 3. 点击整行进行单选激活
    const row = target.closest(".stock-list-item") as HTMLElement | null;
    if (row) {
      const code = row.dataset.code!;
      state.activeCode = code;
      // 单选激活时，清空多选列表，并让选中的复选框变为唯一勾选（也可不清空多选，但清空是最好的单/多选状态隔离）
      state.checkedCodes = [];
      saveState(state, storageKey);
      renderStockList();
      drawChart();
    }
  });

  // B. 时间区间切换事件
  timeTabs.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target && target.classList.contains("time-tab")) {
      state.timeframe = target.dataset.t!;
      saveState(state, storageKey);
      renderTimeTabs();
      drawChart();
    }
  });

  // 6. 开启初次渲染与绘制
  renderStockList();
  renderTimeTabs();

  // 7. 使用 ResizeObserver 自适应重绘
  if ((host as any)._chartObserver) {
    try {
      (host as any)._chartObserver.disconnect();
    } catch (err) {
      console.warn("Failed to disconnect chart observer", err);
    }
  }
  const observer = new ResizeObserver(() => {
    drawChart();
  });
  observer.observe(chartContainer);
  (host as any)._chartObserver = observer;

  // 初次渲染触发绘制
  setTimeout(() => {
    drawChart();
    fit();
  }, 30);
}
