import marketData from "../assets/market-indices.json";

interface Row {
  date: string;
  close: number;
}

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

const INDICES_INFO: IndexInfo[] = [
  { id: "sh000001", name: "上证指数", color: "#ff4d4f" },
  { id: "sz399001", name: "深证成指", color: "#ffa940" },
  { id: "sz399006", name: "创业板指", color: "#fadb14" },
  { id: "sh000688", name: "科创50", color: "#13c2c2" },
  { id: "sh000300", name: "沪深300", color: "#1890ff" },
  { id: "sh000905", name: "中证500", color: "#722ed1" },
  { id: "sh000852", name: "中证1000", color: "#eb2f96" }
];

interface MarketState {
  selectedIndices: string[];
  timeframe: string;
}

const STORAGE_KEY = "stock-block-market-state";

function loadState(): MarketState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (
        Array.isArray(parsed.selectedIndices) &&
        parsed.selectedIndices.length > 0 &&
        typeof parsed.timeframe === "string"
      ) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  // 默认勾选 沪深300、上证指数、创业板指
  return {
    selectedIndices: ["sh000300", "sh000001", "sz399006"],
    timeframe: "1Y"
  };
}

function saveState(state: MarketState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function getStartDate(endDateStr: string, timeframe: string): string {
  const end = new Date(endDateStr.replace(/-/g, "/"));
  const start = new Date(end);
  switch (timeframe) {
    case "1M":
      start.setMonth(start.getMonth() - 1);
      break;
    case "3M":
      start.setMonth(start.getMonth() - 3);
      break;
    case "6M":
      start.setMonth(start.getMonth() - 6);
      break;
    case "1Y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    case "YTD":
      return `${end.getFullYear()}-01-01`;
    default:
      return "2020-01-01"; // 全部，覆盖所有数据即可
  }
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, "0");
  const d = String(start.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function renderMarket(host: HTMLElement, fit: () => void): void {
  const state = loadState();
  const maxDate = marketData.end_date;

  // 1. 初始化 DOM 框架
  host.innerHTML = `
    <div class="market-view">
      <div class="market-left">
        <div class="idx-header">
          <input type="checkbox" id="idx-all" />
          <label for="idx-all"><b>行情指数对比</b></label>
        </div>
        <div class="idx-list" id="idxList"></div>
      </div>
      <div class="market-right">
        <div class="market-control-bar">
          <div class="time-tabs" id="timeTabs">
            <button class="time-tab" data-t="1M">1个月</button>
            <button class="time-tab" data-t="3M">3个月</button>
            <button class="time-tab" data-t="6M">6个月</button>
            <button class="time-tab" data-t="1Y">1年</button>
            <button class="time-tab" data-t="YTD">今年以来</button>
            <button class="time-tab" data-t="All">全部</button>
          </div>
          <span class="norm-tip">起点归一化 100 对比</span>
        </div>
        <div class="chart-canvas-container" id="marketChartContainer">
          <svg id="marketChartSvg" style="width:100%; height:100%; display:block; overflow:visible;"></svg>
          <div id="chartTooltip" class="chart-tooltip" style="display:none; position:absolute; pointer-events:none; z-index:100;"></div>
        </div>
      </div>
    </div>
  `;

  const idxList = host.querySelector("#idxList") as HTMLElement;
  const idxAll = host.querySelector("#idx-all") as HTMLInputElement;
  const timeTabs = host.querySelector("#timeTabs") as HTMLElement;
  const chartContainer = host.querySelector("#marketChartContainer") as HTMLElement;
  const chartSvg = host.querySelector("#marketChartSvg") as unknown as SVGSVGElement & HTMLElement;
  const tooltip = host.querySelector("#chartTooltip") as HTMLElement;

  // 2. 渲染左侧指数列表
  function renderIndexList() {
    idxList.innerHTML = INDICES_INFO.map((info) => {
      const checked = state.selectedIndices.includes(info.id);
      return `
        <div class="idx-item">
          <input type="checkbox" id="idx-${info.id}" data-id="${info.id}" ${checked ? "checked" : ""} />
          <label for="idx-${info.id}">
            <span class="color-dot" style="background:${info.color}"></span>
            <span class="idx-name">${info.name}</span>
          </label>
        </div>
      `;
    }).join("");

    // 更新“全选”复选框状态
    const allChecked = INDICES_INFO.every((info) => state.selectedIndices.includes(info.id));
    const someChecked = INDICES_INFO.some((info) => state.selectedIndices.includes(info.id));
    idxAll.checked = allChecked;
    idxAll.indeterminate = !allChecked && someChecked;
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

  // 4. 重绘图表核心逻辑
  function drawChart() {
    if (!state.selectedIndices.length) {
      chartSvg.innerHTML = `
        <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="var(--fg-faint)" font-size="14">
          请在左侧勾选需要对比的指数
        </text>
      `;
      tooltip.style.display = "none";
      return;
    }

    const startDateStr = getStartDate(maxDate, state.timeframe);

    // 4.1 提取与过滤数据，计算归一化点数
    const activeSeries: {
      id: string;
      name: string;
      color: string;
      rows: { date: string; close: number; normVal: number }[];
    }[] = [];

    let globalMin = Infinity;
    let globalMax = -Infinity;
    const allDatesSet = new Set<string>();

    for (const id of state.selectedIndices) {
      const info = INDICES_INFO.find((item) => item.id === id);
      const dataSeries = (marketData.series as Series[]).find((item) => item.id === id);
      if (!info || !dataSeries) continue;

      const filtered = dataSeries.rows.filter((row) => row.date >= startDateStr);
      if (!filtered.length) continue;

      // 保证按时间排序
      const sortedRows = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
      const baseClose = sortedRows[0].close;

      const mappedRows = sortedRows.map((row) => {
        const normVal = (row.close / baseClose) * 100;
        if (normVal < globalMin) globalMin = normVal;
        if (normVal > globalMax) globalMax = normVal;
        allDatesSet.add(row.date);
        return {
          date: row.date,
          close: row.close,
          normVal: normVal
        };
      });

      activeSeries.push({
        id: id,
        name: info.name,
        color: info.color,
        rows: mappedRows
      });
    }

    if (!activeSeries.length) {
      chartSvg.innerHTML = `
        <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="var(--fg-faint)" font-size="14">
          选定区间内无行情数据
        </text>
      `;
      tooltip.style.display = "none";
      return;
    }

    // 4.2 计算时间轴轴点与 Y 轴范围
    const allDates = Array.from(allDatesSet).sort();
    let yMin = Math.min(98, globalMin - 1.5);
    let yMax = Math.max(102, globalMax + 1.5);

    // 4.3 物理坐标映射
    const width = chartContainer.clientWidth || 600;
    const height = chartContainer.clientHeight || 320;

    const margin = { top: 15, right: 15, bottom: 25, left: 40 };
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

    // 4.4 构建 SVG 内容
    let svgHtml = "";

    // A. 绘制 Y 轴背景网格线与刻度
    const yGridTicks = 5;
    for (let i = 0; i <= yGridTicks; i++) {
      const val = yMin + (i / yGridTicks) * (yMax - yMin);
      const y = yScale(val);
      
      svgHtml += `
        <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" 
              stroke="var(--line)" stroke-width="1" stroke-dasharray="3,3" />
        <text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" fill="var(--fg-faint)" font-size="10" font-family="monospace">
          ${val.toFixed(0)}
        </text>
      `;
    }

    // 强绘制起点100的参考线，以避免因刻度不均匀而不明显
    if (yMin <= 100 && yMax >= 100) {
      const y100 = yScale(100);
      svgHtml += `
        <line x1="${margin.left}" y1="${y100}" x2="${width - margin.right}" y2="${y100}" 
              stroke="var(--line-strong)" stroke-width="1" stroke-dasharray="5,2" />
        <text x="${width - margin.right - 4}" y="${y100 - 4}" text-anchor="end" fill="var(--fg-soft)" font-size="10" font-weight="bold">
          100 (起点)
        </text>
      `;
    }

    // B. 绘制 X 轴时间刻度
    const dateTicks = 5;
    const dateStep = Math.max(1, Math.floor(allDates.length / dateTicks));
    for (let i = 0; i < allDates.length; i += dateStep) {
      const dateStr = allDates[i];
      const x = xScale(dateStr);
      // 精简日期格式：YYYY-MM-DD -> MM-DD 或 YY-MM
      const label = dateStr.substring(2); 
      svgHtml += `
        <text x="${x}" y="${height - 6}" text-anchor="middle" fill="var(--fg-faint)" font-size="10">
          ${label}
        </text>
      `;
    }
    // 补齐末尾日期标签
    if ((allDates.length - 1) % dateStep !== 0) {
      const lastDate = allDates[allDates.length - 1];
      svgHtml += `
        <text x="${xScale(lastDate)}" y="${height - 6}" text-anchor="middle" fill="var(--fg-faint)" font-size="10">
          ${lastDate.substring(2)}
        </text>
      `;
    }

    // C. 绘制折线
    activeSeries.forEach((s) => {
      let pathD = "";
      s.rows.forEach((row, i) => {
        const x = xScale(row.date);
        const y = yScale(row.normVal);
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

    // D. 交互图层元素 (默认隐藏，鼠标移动时显示)
    svgHtml += `
      <!-- 垂直十字参考线 -->
      <line id="hoverLine" x1="0" y1="${margin.top}" x2="0" y2="${height - margin.bottom}" 
            stroke="var(--fg-soft)" stroke-width="1" stroke-dasharray="2,2" style="display:none;" />
      
      <!-- 各曲线的指示圆点 -->
      <g id="hoverDots"></g>

      <!-- 拦截鼠标悬停的主交互矩形 -->
      <rect id="hoverOverlay" x="${margin.left}" y="${margin.top}" 
            width="${plotWidth}" height="${plotHeight}" fill="transparent" style="cursor:crosshair;" />
    `;

    chartSvg.innerHTML = svgHtml;

    // 4.5 绑定 Hover 悬停交互事件
    const overlay = chartSvg.querySelector("#hoverOverlay") as SVGRectElement | null;
    const hoverLine = chartSvg.querySelector("#hoverLine") as SVGLineElement | null;
    const hoverDotsGroup = chartSvg.querySelector("#hoverDots") as SVGGElement | null;

    if (overlay && hoverLine && hoverDotsGroup) {
      const onMove = (e: MouseEvent) => {
        const rect = chartSvg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const plotX = mouseX - margin.left;

        if (plotX < 0 || plotX > plotWidth) {
          onLeave();
          return;
        }

        // 寻找最靠近鼠标日期的 index
        const ratio = plotX / plotWidth;
        const targetIdx = Math.min(
          allDates.length - 1,
          Math.max(0, Math.round(ratio * (allDates.length - 1)))
        );
        const targetDate = allDates[targetIdx];
        const cx = xScale(targetDate);

        // A. 更新垂直参考线位置
        hoverLine.setAttribute("x1", String(cx));
        hoverLine.setAttribute("x2", String(cx));
        hoverLine.style.display = "block";

        // B. 计算当前日期下，各个指数的实际数值以渲染圆点及 Tooltip
        const currentData: {
          name: string;
          color: string;
          original: number;
          norm: number;
        }[] = [];

        let dotsHtml = "";
        activeSeries.forEach((s) => {
          const matched = s.rows.find((r) => r.date === targetDate);
          if (matched) {
            const cy = yScale(matched.normVal);
            dotsHtml += `
              <circle cx="${cx}" cy="${cy}" r="4.5" fill="${s.color}" stroke="var(--card)" stroke-width="1.5" />
            `;
            currentData.push({
              name: s.name,
              color: s.color,
              original: matched.close,
              norm: matched.normVal
            });
          }
        });

        hoverDotsGroup.innerHTML = dotsHtml;

        // C. 按涨跌幅（归一化数值）对 Tooltip 列表进行降序排列
        currentData.sort((a, b) => b.norm - a.norm);

        // D. 组装并展示 Tooltip
        const itemsHtml = currentData
          .map((d) => {
            const chg = d.norm - 100;
            const chgText = chg >= 0 ? `+${chg.toFixed(2)}%` : `${chg.toFixed(2)}%`;
            const chgCls = chg > 0 ? "up" : chg < 0 ? "down" : "";
            return `
            <div class="tooltip-row">
              <span class="dot" style="background:${d.color}"></span>
              <span class="name">${d.name}</span>
              <span class="val">${d.original.toLocaleString("zh-CN", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 2
              })}</span>
              <span class="norm ${chgCls}">${chgText}</span>
            </div>
          `;
          })
          .join("");

        tooltip.innerHTML = `
          <div class="tooltip-date">${targetDate}</div>
          <div class="tooltip-rows">${itemsHtml}</div>
        `;
        tooltip.style.display = "block";

        // 避免 Tooltip 超出右边界
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
  // A. 指数选择列表事件
  idxList.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    if (target && target.tagName === "INPUT") {
      const id = target.dataset.id!;
      if (target.checked) {
        if (!state.selectedIndices.includes(id)) {
          state.selectedIndices.push(id);
        }
      } else {
        state.selectedIndices = state.selectedIndices.filter((item) => item !== id);
      }
      saveState(state);
      renderIndexList();
      drawChart();
    }
  });

  // B. 全选复选框事件
  idxAll.addEventListener("change", () => {
    if (idxAll.checked) {
      state.selectedIndices = INDICES_INFO.map((info) => info.id);
    } else {
      state.selectedIndices = [];
    }
    saveState(state);
    renderIndexList();
    drawChart();
  });

  // C. 时间区间 Tab 切换事件
  timeTabs.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target && target.classList.contains("time-tab")) {
      state.timeframe = target.dataset.t!;
      saveState(state);
      renderTimeTabs();
      drawChart();
    }
  });

  // 6. 执行初次渲染和绘制
  renderIndexList();
  renderTimeTabs();

  // 7. 使用 ResizeObserver 在挂件尺寸改变时重新绘制图表
  const observer = new ResizeObserver(() => {
    drawChart();
  });
  observer.observe(chartContainer);

  // 初次渲染触发绘制
  setTimeout(() => {
    drawChart();
    fit();
  }, 30);
}
