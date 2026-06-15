import { StockStore } from "../../shared/store";
import { Fundamental, FinancePeriod, pegOf } from "../../shared/model";
import { ICONS, esc, tagPicker } from "../ui";

const fmt = (n: number | undefined, unit = ""): string =>
  n == null ? "—" : `${n.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${unit}`;

type FdKey = "name" | "tags" | "marketCap" | "pe" | "peg" | "roe" | "profitGrowth" | "revGrowth" | "grossMargin" | "debtRatio" | "eps";

// 跨重绘保留的视图状态
let sortKey: FdKey = "marketCap";
let sortDir: "asc" | "desc" = "desc";
let selYear = "";
let selQuarter = "";
let filterTags: string[] = [];

const QUARTER_ORDER = ["12-31", "09-30", "06-30", "03-31"];
function quarterLabel(md: string): string {
  if (md === "12-31") return "年报";
  if (md === "09-30") return "三季";
  if (md === "06-30") return "中报";
  if (md === "03-31") return "一季";
  return md;
}
function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)));
}
function growthCls(v: number | undefined): string {
  if (v == null) return "";
  return v > 0 ? "up" : v < 0 ? "down" : "";
}

/** 分析视图：实时估值 + 多报告期财务；可点表头排序、按年份+季度选报告期、按标签筛选与打标签 */
export function renderFundamentals(host: HTMLElement, store: StockStore, fit: () => void): void {
  const headers: Array<{ k: FdKey; label: string; num?: boolean }> = [
    { k: "name", label: "股票" },
    { k: "marketCap", label: "总市值/亿", num: true },
    { k: "pe", label: "PE", num: true },
    { k: "peg", label: "PEG", num: true },
    { k: "roe", label: "ROE%", num: true },
    { k: "profitGrowth", label: "净利增速%", num: true },
    { k: "revGrowth", label: "营收增速%", num: true },
    { k: "grossMargin", label: "毛利%", num: true },
    { k: "debtRatio", label: "负债率%", num: true },
    { k: "eps", label: "EPS", num: true },
    { k: "tags", label: "标签" }
  ];

  function tagSortVal(f: Fundamental): string {
    const names = store.fundTags(f).map((t) => t.name);
    return names.length ? names.join(",") : "~~~"; // 无标签排末尾
  }

  function fdVal(f: Fundamental, period: FinancePeriod | undefined): number | string {
    switch (sortKey) {
      case "name": return f.name;
      case "tags": return tagSortVal(f);
      case "marketCap": return f.marketCap ?? -Infinity;
      case "pe": return f.pe ?? -Infinity;
      case "peg": return pegOf(f, period) ?? -Infinity;
      default: return (period?.[sortKey] as number | undefined) ?? -Infinity;
    }
  }

  function draw(): void {
    const all = store.fundamentals;
    if (!all.length) {
      host.innerHTML = `<div class="empty">在右上点「获取」抓一只的基本面（范围可设多年，按年份+季度查看 ROE、净利增速等）</div>`;
      fit();
      return;
    }

    const allReports = uniq(all.flatMap((f) => f.periods.map((p) => p.reportDate))).sort().reverse();
    const years = uniq(allReports.map((r) => r.slice(0, 4)));
    if (years.length && !years.includes(selYear)) selYear = years[0];
    const quartersOfYear = QUARTER_ORDER.filter((q) => allReports.includes(`${selYear}-${q}`));
    if (!quartersOfYear.includes(selQuarter)) selQuarter = quartersOfYear[0] || "";
    const selectedReport = selYear && selQuarter ? `${selYear}-${selQuarter}` : "";

    filterTags = filterTags.filter((id) => store.tag(id));
    const rows = filterTags.length
      ? all.filter((f) => filterTags.some((id) => (f.tagIds || []).includes(id)))
      : all;

    const filterBar = `
      <div class="fd-filter-bar">
        <button class="fd-chip fd-tag-mgr-btn" id="fdTagMgr" title="标签管理" style="display:inline-flex; align-items:center; justify-content:center; padding:0; width:24px; height:24px;">${ICONS.cog}</button>
        <button class="fd-chip${filterTags.length === 0 ? " on" : ""}" data-tag="">全部</button>
        ${store.tags.map((t) => `<button class="fd-chip${filterTags.includes(t.id) ? " on" : ""}" data-tag="${t.id}"><span class="dot" style="background:${t.color}"></span>${esc(t.name)}</button>`).join("")}
      </div>
    `;

    host.innerHTML = `${filterBar}<div class="table-wrap">${buildTable(rows, selectedReport)}</div>`;

    const headCenter = document.getElementById("headCenter");
    if (headCenter) {
      if (years.length) {
        const yearOptions = years.map((y) => `<option value="${y}" ${y === selYear ? "selected" : ""}>${y}年</option>`).join("");
        const quarterTabs = quartersOfYear.map((q) => `<button class="time-tab${q === selQuarter ? " on" : ""}" data-q="${q}">${quarterLabel(q)}</button>`).join("");
        headCenter.innerHTML = `
          <div class="fd-time-selector" style="display:inline-flex; align-items:center; gap:8px;">
            <select id="fdYearSelect" class="anchor-input" style="width:72px; height:24px; padding:0 4px; font-size:11.5px; border-radius:5px; border:1px solid var(--line); background:var(--card); color:var(--fg); cursor:pointer;">
              ${yearOptions}
            </select>
            <div class="time-tabs fd-quarter-tabs" style="padding:2px;">
              ${quarterTabs}
            </div>
          </div>
        `;
      } else {
        headCenter.innerHTML = "";
      }
    }

    bind();
    fit();
  }

  function buildTable(rows: Fundamental[], selectedReport: string): string {
    const arrow = (k: FdKey) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");
    const ths = headers.map((h) => {
      const cls = [h.num ? "num" : "", "th-sort", sortKey === h.k ? "on" : ""].filter(Boolean).join(" ");
      return `<th class="${cls}" data-k="${h.k}">${h.label}${arrow(h.k)}</th>`;
    }).join("") + `<th class="th-ops"></th>`;

    const sign = sortDir === "asc" ? 1 : -1;
    const list = rows
      .map((f) => ({ f, period: f.periods.find((p) => p.reportDate === selectedReport) }))
      .sort((a, b) => {
        const av = fdVal(a.f, a.period);
        const bv = fdVal(b.f, b.period);
        let c: number;
        if (typeof av === "number" && typeof bv === "number") c = av - bv;
        else c = String(av).localeCompare(String(bv), "zh");
        if (c === 0) c = (b.f.fetchedAt || 0) - (a.f.fetchedAt || 0);
        return c * sign;
      });

    const trs = list.map(({ f, period }) => `<tr>
      <td class="td-name">${esc(f.name)}</td>
      <td class="num">${fmt(f.marketCap)}</td>
      <td class="num">${fmt(f.pe)}</td>
      <td class="num">${fmt(pegOf(f, period))}</td>
      <td class="num">${fmt(period?.roe)}</td>
      <td class="num ${growthCls(period?.profitGrowth)}">${fmt(period?.profitGrowth)}</td>
      <td class="num ${growthCls(period?.revGrowth)}">${fmt(period?.revGrowth)}</td>
      <td class="num">${fmt(period?.grossMargin)}</td>
      <td class="num">${fmt(period?.debtRatio)}</td>
      <td class="num">${fmt(period?.eps)}</td>
      <td class="fd-tag-cell" data-code="${esc(f.code)}"></td>
      <td class="td-ops">
        <button class="tx-op fd-op del" data-code="${esc(f.code)}" title="删除">${ICONS.del}</button>
      </td>
    </tr>`).join("");

    return `<table class="pos-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
  }

  function bind(): void {
    host.querySelectorAll<HTMLTableCellElement>("th.th-sort").forEach((th) => {
      th.addEventListener("click", () => {
        const k = th.dataset.k as FdKey;
        if (sortKey === k) sortDir = sortDir === "asc" ? "desc" : "asc";
        else { sortKey = k; sortDir = th.classList.contains("num") ? "desc" : "asc"; }
        draw();
      });
    });
    const headCenter = document.getElementById("headCenter");
    if (headCenter) {
      const yearSelect = headCenter.querySelector("#fdYearSelect") as HTMLSelectElement | null;
      if (yearSelect) {
        yearSelect.addEventListener("change", () => {
          selYear = yearSelect.value;
          selQuarter = "";
          draw();
        });
      }
      headCenter.querySelectorAll<HTMLButtonElement>(".fd-quarter-tabs .time-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          selQuarter = btn.dataset.q || selQuarter;
          draw();
        });
      });
    }

    const tagMgr = host.querySelector("#fdTagMgr");
    if (tagMgr) {
      tagMgr.addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("stock-block:open-tag-panel"));
      });
    }

    host.querySelectorAll<HTMLButtonElement>(".fd-chip").forEach((btn) => {
      if (btn.id === "fdTagMgr") return;
      btn.addEventListener("click", () => {
        const id = btn.dataset.tag || "";
        if (!id) filterTags = [];
        else filterTags = filterTags.includes(id) ? filterTags.filter((x) => x !== id) : [...filterTags, id];
        draw();
      });
    });
    // 行内打标签：每行标签单元格挂一个标签选择器，改动即存（不重绘以便连续多选）
    host.querySelectorAll<HTMLElement>(".fd-tag-cell").forEach((cell) => {
      const code = cell.dataset.code!;
      const f = store.getFundamental(code);
      cell.appendChild(tagPicker(store, f?.tagIds || [], (ids) => { void store.setFundamentalTags(code, ids); }, { noName: true }));
    });
    host.querySelectorAll<HTMLButtonElement>(".fd-op").forEach((btn) => {
      const c = btn.dataset.code!;
      btn.addEventListener("click", async () => { await store.removeFundamental(c); draw(); });
    });
  }

  draw();
}
