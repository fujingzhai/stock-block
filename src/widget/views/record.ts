import { StockStore } from "../../shared/store";
import {
  PALETTE,
  Position,
  activeDate,
  fmtNum,
  fmtPct,
  fmtPrice,
  fmtSigned,
  holdDays,
  isClosed,
  isHexColor,
  effSellQty,
  todayStr
} from "../../shared/model";
import { setWidgetHeight } from "../theme";
import { ICONS, esc, showError, tagPicker } from "../ui";
import { renderFundamentals } from "./fundamentals";
import { defaultRefreshRange, indexInfos, renderMarketHub, selectMarketSeries, setMarketPane } from "./marketHub";
import { fetchBoardKline, fetchFundamental, fetchFundKline, fetchIndexKline, fetchStockKlineByRange, resolveStockCode, resolveSymbolManually, SymbolKind } from "../../shared/eastmoney";
import type { ViewHandle } from "../main";

type View = "positions" | "fundamentals" | "market";

const HEIGHT_BUFFER = 18;
const MAX_HEIGHT = 10000;
const MIN_HEIGHT = 200;

export interface AppOptions {
  /** 面板模式：在独立标签页里放大显示，填满高度、内部滚动 */
  panel?: boolean;
  initialView?: View;
}

interface FormResult {
  name: string;
  tagIds: string[];
  buyDate: string;
  buyPrice: number;
  buyQty: number;
  sellDate?: string;
  sellPrice?: number;
  sellQty?: number;
}

const num = (s: string): number | null => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
};

export function mountStockApp(root: HTMLElement, store: StockStore, opts: AppOptions = {}): ViewHandle {
  const panel = !!opts.panel;
  let view: View = opts.initialView || "positions";
  let fetchQuery = "";
  let fetchAmount = 1;
  let fetchUnit: "month" | "year" = "year";
  let fetchLoading = false;

  document.addEventListener("stock-block:fetch-fundamental", (e) => {
    const code = (e as CustomEvent<{ code?: string }>).detail?.code;
    if (code) fetchFundamentalFromToolbar(code);
  });
  document.addEventListener("stock-block:toast", (e) => {
    const detail = (e as CustomEvent<{ type?: "ok" | "err"; message?: string }>).detail;
    showToast(detail?.message || "", detail?.type || "ok");
  });
  document.addEventListener("stock-block:open-tag-panel", () => {
    openTagPanel();
  });

  function fit(): void {
    if (panel) return;
    const content = root.querySelector(".app") as HTMLElement | null;
    if (!content) return;
    let minH = MIN_HEIGHT;
    if (view === "positions" || view === "fundamentals") {
      minH = 480;
    } else if (view === "market") {
      minH = 400;
    }
    const h = Math.min(MAX_HEIGHT, Math.max(minH, content.scrollHeight + HEIGHT_BUFFER));
    setWidgetHeight(h);
  }

  // 表格列（可排序）；标签与操作列另行渲染，不参与排序
  type ColKey = "name" | "buyDate" | "buyPrice" | "qty" | "status" | "sellPrice" | "pnl" | "pnlPct";
  let sortKey: ColKey = "buyDate";
  let sortDir: "asc" | "desc" = "desc";

  function getLatestPrice(name: string): number | null {
    const stock = store.individualStocks.find((s) => s.name === name);
    if (!stock?.klines?.length) return null;
    return stock.klines[stock.klines.length - 1].close;
  }

  function calcPnl(p: Position): { amount: number; pct: number } | null {
    if (isClosed(p)) {
      const sp = p.sellPrice as number;
      const amount = (sp - p.buyPrice) * effSellQty(p);
      const pct = p.buyPrice ? sp / p.buyPrice - 1 : 0;
      return { amount, pct };
    }
    const currentPrice = getLatestPrice(p.name);
    if (currentPrice == null) return null;
    const amount = (currentPrice - p.buyPrice) * p.buyQty;
    const pct = p.buyPrice ? currentPrice / p.buyPrice - 1 : 0;
    return { amount, pct };
  }

  function valOf(p: Position, key: ColKey): number | string {
    switch (key) {
      case "name": return p.name;
      case "buyDate": return p.buyDate || "";
      case "buyPrice": return p.buyPrice;
      case "qty": return p.buyQty;
      case "status": return isClosed(p) ? 1 : 0;
      case "sellPrice": return isClosed(p) ? (p.sellPrice ?? -1) : (getLatestPrice(p.name) ?? -1);
      case "pnl": return calcPnl(p)?.amount ?? -Infinity;
      case "pnlPct": return calcPnl(p)?.pct ?? -Infinity;
    }
  }

  function sortPositions(): Position[] {
    const sign = sortDir === "asc" ? 1 : -1;
    return [...store.positions].sort((a, b) => {
      const av = valOf(a, sortKey), bv = valOf(b, sortKey);
      let c: number;
      if (typeof av === "number" && typeof bv === "number") c = av - bv;
      else c = String(av).localeCompare(String(bv), "zh");
      if (c === 0) c = (a.created || 0) - (b.created || 0);
      return c * sign;
    });
  }

  function render(): void {
    if (store.loadFailed) {
      showError(root, "股票数据未正确加载");
      return;
    }

    const tab = (k: View, label: string) => `<button class="vtab${view === k ? " on" : ""}" data-v="${k}">${label}</button>`;
    const actions = view === "positions"
      ? `<button class="new-btn" id="newPos">${ICONS.plus}<span>新建</span></button>`
      : `<button class="new-btn" id="openFetch">${ICONS.plus}<span>获取</span></button>
         <button class="refresh-btn" id="refreshAll" title="刷新全部">${ICONS.refresh}<span>刷新</span></button>`;

    root.innerHTML = `<div class="app${panel ? " panel" : ""}">
      <div class="head">
        <span class="vtabs">${tab("positions", "记录")}${tab("fundamentals", "分析")}${tab("market", "对比")}</span>
        <span class="head-center" id="headCenter"></span>
        <span class="head-actions">${actions}</span>
      </div>
      <div class="body" id="body"></div>
    </div>`;

    root.querySelectorAll<HTMLButtonElement>(".vtab").forEach((b) => {
      b.addEventListener("click", () => { view = b.dataset.v as View; render(); });
    });

    const body = root.querySelector("#body") as HTMLElement;
    if (view === "positions") renderPositions(body);
    else if (view === "fundamentals") renderFundamentals(body, store, fit);
    else renderMarketHub(body, store, fit);

    if (view === "positions") {
      (root.querySelector("#newPos") as HTMLButtonElement).addEventListener("click", () => openForm(null));
    } else {
      (root.querySelector("#openFetch") as HTMLButtonElement).addEventListener("click", openFetchDialog);
      (root.querySelector("#refreshAll") as HTMLButtonElement).addEventListener("click", refreshCurrentView);
      const tagBtn = root.querySelector("#tagMgr") as HTMLButtonElement | null;
      if (tagBtn) tagBtn.addEventListener("click", openTagPanel);
    }
    fit();
  }

  function marketFetchPlaceholder(): string {
    return "代码 / 名称 / 拼音（自动识别大盘·板块·ETF·个股）";
  }

  function paneLabel(kind: string): string {
    return kind === "index" ? "大盘" : kind === "board" ? "板块" : kind === "fund" ? "ETF" : "个股";
  }

  function validRange(): { startDate: string; endDate: string } | null {
    if (!Number.isFinite(fetchAmount) || fetchAmount <= 0) {
      showToast("时间数量必须大于 0", "err");
      return null;
    }
    return periodRange(fetchAmount, fetchUnit);
  }

  async function fetchFundamentalFromToolbar(rawInput?: string, tagIds?: string[]): Promise<boolean> {
    const input = (rawInput || fetchQuery).trim();
    if (!input) return false;
    // 行内「刷新」(带 rawInput) 用较长范围，避免把已抓的多年报告期覆盖成短区间
    const range = rawInput ? fundamentalRange() : validRange();
    if (!range) { render(); return false; }
    fetchLoading = true;
    render();
    try {
      const code = await resolveStockCode(input);
      const f = await fetchFundamental(code, range);
      await store.upsertFundamental(f);
      const kline = await fetchStockKlineByRange(code, range);
      await store.upsertStockKline(kline);
      if (tagIds) {
        await store.setFundamentalTags(f.code, tagIds);
        await store.setStockKlineTags(kline.code, tagIds);
      }
      showToast(`${f.name} 分析与对比数据获取成功`, "ok");
      return true;
    } catch (e) {
      showToast(`获取失败：${e instanceof Error ? e.message : String(e)}`, "err");
      return false;
    } finally {
      fetchLoading = false;
      render();
    }
  }

  async function fetchMarketFromToolbar(selectedTags?: string[], forcedKind?: string): Promise<boolean> {
    const input = fetchQuery.trim();
    if (!input) return false;
    const range = validRange();
    if (!range) { render(); return false; }
    fetchLoading = true;
    render();
    try {
      const sym = await resolveSymbolManually(input, (forcedKind || "index") as SymbolKind);
      let name = sym.name;
      if (sym.kind === "stock") {
        const kline = await fetchStockKlineByRange(sym.code, range);
        await store.upsertStockKline(kline);
        const f = await fetchFundamental(sym.code, range);
        await store.upsertFundamental(f);
        if (selectedTags) {
          await store.setStockKlineTags(kline.code, selectedTags);
          await store.setFundamentalTags(f.code, selectedTags);
        }
        selectMarketSeries("stock", kline.code);
        name = kline.name;
      } else if (sym.kind === "fund") {
        const kline = await fetchFundKline(sym.code, range);
        await store.upsertMarketSeries(kline);
        if (selectedTags) {
          await store.setSeriesTags("fund", kline.code, selectedTags);
        }
        selectMarketSeries("fund", kline.code);
        name = kline.name;
      } else if (sym.kind === "index") {
        const kline = await fetchIndexKline(sym.code, sym.name, range);
        await store.upsertMarketSeries(kline);
        if (selectedTags) {
          await store.setSeriesTags("index", kline.code, selectedTags);
        }
        selectMarketSeries("index", kline.code);
        name = kline.name;
      } else {
        const kline = await fetchBoardKline(sym.code, range);
        await store.upsertMarketSeries(kline);
        if (selectedTags) {
          await store.setSeriesTags("board", kline.code, selectedTags);
        }
        selectMarketSeries(kline.kind, kline.code);
        name = kline.name;
      }
      setMarketPane(sym.kind);
      showToast(`${name}（${paneLabel(sym.kind)}）获取成功`, "ok");
      return true;
    } catch (e) {
      showToast(`获取失败：${e instanceof Error ? e.message : String(e)}`, "err");
      return false;
    } finally {
      fetchLoading = false;
      render();
    }
  }

  function openFetchDialog(): void {
    document.querySelector(".sb-mask")?.remove();
    const mask = document.createElement("div");
    mask.className = "sb-mask";
    const isFund = view === "fundamentals";
    const placeholder = "代码 / 名称 / 拼音";
    
    let kindHtml = "";
    if (!isFund) {
      kindHtml = `
        <div class="ff">
          <label>类型</label>
          <select id="fetchKind" class="ff-in">
            <option value="index">大盘</option>
            <option value="board">板块</option>
            <option value="fund">ETF</option>
            <option value="stock">个股</option>
          </select>
        </div>
      `;
    }

    mask.innerHTML = `<div class="form-panel fetch-panel">
      <div class="fp-head"><span>${isFund ? "获取分析数据" : "获取对比数据"}</span><button class="head-btn" id="fpClose" title="关闭">✕</button></div>
      <div class="ff"><label>标的</label><input id="fetchQuery" class="ff-in" placeholder="${placeholder}" value="${esc(fetchQuery)}" /></div>
      ${kindHtml}
      <div class="ff"><label>范围</label><div class="period-pair">
        <input id="fetchAmount" class="ff-in top-fetch-num" type="number" min="1" step="1" value="${fetchAmount}" />
        <select id="fetchUnit" class="ff-in top-fetch-unit"><option value="month" ${fetchUnit === "month" ? "selected" : ""}>月</option><option value="year" ${fetchUnit === "year" ? "selected" : ""}>年</option></select>
      </div></div>
      <div class="ff" id="fetchTagSection" style="align-items: flex-start; flex-direction: column; gap: 6px;">
        <label>打标签</label>
        <div id="fetchTagList" style="width: 100%; max-height: 120px; overflow-y: auto; border: 1px solid var(--line); border-radius: 6px; padding: 4px; background: var(--hover); display: flex; flex-direction: column; gap: 4px; box-sizing: border-box;"></div>
        <div class="fetch-tag-add" style="display: flex; gap: 6px; width: 100%; box-sizing: border-box; margin-top: 2px;">
          <input id="fetchNewTagName" class="ff-in" style="flex: 1; height: 26px; font-size: 12px; padding: 0 6px; border-radius: 4px;" placeholder="新标签名..." />
          <button id="fetchNewTagAddBtn" class="q-add" style="height: 26px; line-height: 26px; padding: 0 10px; font-size: 12px; margin: 0; border-radius: 4px;">添加</button>
        </div>
      </div>
      <div class="fp-err" id="fetchErr"></div>
      <div class="fp-foot"><button class="nav-btn" id="fetchCancel">取消</button><button class="q-add" id="fetchRun">获取</button></div>
    </div>`;
    document.body.appendChild(mask);
    
    let selectedTags: string[] = [];
    const renderFetchTagList = () => {
      const tagListContainer = mask.querySelector("#fetchTagList") as HTMLElement;
      if (!tagListContainer) return;
      tagListContainer.innerHTML = "";
      if (store.tags.length === 0) {
        tagListContainer.innerHTML = `<div class="empty small" style="padding: 4px; text-align: center; color: var(--fg-faint); font-size: 11px;">暂无标签</div>`;
        return;
      }
      store.tags.forEach((tag) => {
        const item = document.createElement("div");
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.justifyContent = "space-between";
        item.style.gap = "6px";
        item.style.padding = "2px 4px";
        
        const isChecked = selectedTags.includes(tag.id);
        item.innerHTML = `
          <div style="display:flex; align-items:center; gap:6px;">
            <input type="checkbox" class="fetch-tag-chk" data-id="${tag.id}" ${isChecked ? "checked" : ""} style="cursor:pointer; width:13px; height:13px; accent-color:var(--accent); margin:0;" />
            <span style="font-size:12px; color:var(--fg); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:150px;" title="${esc(tag.name)}">${esc(tag.name)}</span>
          </div>
          <button class="fetch-tag-del tx-op del" data-id="${tag.id}" style="background:none; border:none; padding:2px; cursor:pointer;" title="删除标签">${ICONS.del}</button>
        `;
        
        const chk = item.querySelector(".fetch-tag-chk") as HTMLInputElement;
        chk.addEventListener("change", () => {
          if (chk.checked) {
            selectedTags = Array.from(new Set([...selectedTags, tag.id]));
          } else {
            selectedTags = selectedTags.filter((id) => id !== tag.id);
          }
        });
        
        const delBtn = item.querySelector(".fetch-tag-del") as HTMLButtonElement;
        delBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          await store.removeTag(tag.id);
          selectedTags = selectedTags.filter((id) => id !== tag.id);
          renderFetchTagList();
          render();
        });
        
        tagListContainer.appendChild(item);
      });
    };

    renderFetchTagList();
    const syncFetchTagVisibility = () => {
      const tagSection = mask.querySelector("#fetchTagSection") as HTMLElement | null;
      if (!tagSection) return;
      const kindSelect = mask.querySelector("#fetchKind") as HTMLSelectElement | null;
      const showTags = isFund || kindSelect?.value === "stock";
      tagSection.style.display = showTags ? "flex" : "none";
      if (!showTags && selectedTags.length) {
        selectedTags = [];
        renderFetchTagList();
      }
    };
    syncFetchTagVisibility();

    const addFetchTag = async () => {
      const input = mask.querySelector("#fetchNewTagName") as HTMLInputElement;
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      const newTag = await store.addTag(v, PALETTE[store.tags.length % PALETTE.length]);
      selectedTags = Array.from(new Set([...selectedTags, newTag.id]));
      input.value = "";
      renderFetchTagList();
      render();
      input.focus();
    };

    (mask.querySelector("#fetchNewTagAddBtn") as HTMLButtonElement).addEventListener("click", addFetchTag);
    (mask.querySelector("#fetchNewTagName") as HTMLInputElement).addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addFetchTag();
      }
    });

    const $ = <T extends HTMLElement = HTMLElement>(id: string) => mask.querySelector(`#${id}`) as T;
    const close = () => mask.remove();
    mask.addEventListener("mousedown", (e) => { if (e.target === mask) close(); });
    $("fpClose").addEventListener("click", close);
    $("fetchCancel").addEventListener("click", close);
    const fetchKindSelect = mask.querySelector("#fetchKind") as HTMLSelectElement | null;
    fetchKindSelect?.addEventListener("change", syncFetchTagVisibility);
    const run = async () => {
      fetchQuery = ($<HTMLInputElement>("fetchQuery")).value.trim();
      const n = parseInt(($<HTMLInputElement>("fetchAmount")).value, 10);
      fetchAmount = Number.isFinite(n) && n > 0 ? n : 1;
      fetchUnit = ($<HTMLSelectElement>("fetchUnit")).value === "month" ? "month" : "year";
      
      const kindSelect = mask.querySelector("#fetchKind") as HTMLSelectElement | null;
      const forcedKind = kindSelect?.value || "";

      if (!fetchQuery) {
        $("fetchErr").textContent = "请输入标的";
        ($<HTMLInputElement>("fetchQuery")).focus();
        return;
      }
      
      ($("fetchRun") as HTMLButtonElement).disabled = true;
      try {
        const ok = isFund
          ? await fetchFundamentalFromToolbar(undefined, selectedTags)
          : await fetchMarketFromToolbar(selectedTags, forcedKind);
        if (ok) {
          fetchQuery = "";
          close();
        }
      } finally {
        ($("fetchRun") as HTMLButtonElement | null)?.removeAttribute("disabled");
      }
    };
    $("fetchRun").addEventListener("click", run);
    $("fetchQuery").addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") run();
      if ((e as KeyboardEvent).key === "Escape") close();
    });
    ($<HTMLInputElement>("fetchQuery")).focus();
  }

  async function refreshCurrentView(): Promise<void> {
    const range = defaultRefreshRange();
    fetchLoading = true;
    render();
    let ok = 0;
    let skipped = 0;
    const failures: string[] = [];
    // 手动点击「刷新」= 强制拉取最新收盘，逐项重新请求，不做缓存跳过
    const isStale = (_fetchedAt?: number) => true;
    try {
      if (view === "fundamentals") {
        const fRange = fundamentalRange();
        for (const f of store.fundamentals) {
          if (!isStale(f.fetchedAt)) { skipped++; continue; }
          try {
            await store.upsertFundamental(await fetchFundamental(f.code, fRange));
            ok++;
          } catch (err) {
            failures.push(`${f.name || f.code}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } else {
        for (const info of indexInfos()) {
          const cached = store.getMarketSeries("index", info.id);
          if (cached && !isStale(cached.fetchedAt)) { skipped++; continue; }
          try {
            const itemRange = cached ? klineRangeOrDefault(cached.klines || []) : range;
            await store.upsertMarketSeries(await fetchIndexKline(info.id, info.name, itemRange));
            ok++;
          } catch (err) {
            failures.push(`${info.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        const builtinIds = new Set(indexInfos().map((i) => i.id));
        for (const s of store.marketSeries) {
          if (s.kind === "index" && builtinIds.has(s.code)) continue; // 内置指数已在上面刷新
          if (!isStale(s.fetchedAt)) { skipped++; continue; }
          try {
            const itemRange = klineRangeOrDefault(s.klines || []);
            const refreshed = s.kind === "fund"
              ? await fetchFundKline(s.code, itemRange)
              : s.kind === "board"
                ? await fetchBoardKline(s.code, itemRange)
                : s.kind === "index"
                  ? await fetchIndexKline(s.code, s.name, itemRange)
                  : null;
            if (!refreshed) continue;
            await store.upsertMarketSeries(refreshed);
            ok++;
          } catch (err) {
            failures.push(`${s.name || s.code}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        for (const s of store.individualStocks) {
          if (!isStale(s.fetchedAt)) { skipped++; continue; }
          try {
            const itemRange = klineRangeOrDefault(s.klines || []);
            await store.upsertStockKline(await fetchStockKlineByRange(s.code, itemRange));
            ok++;
          } catch (err) {
            failures.push(`${s.name || s.code}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      if (!ok && !failures.length) showToast("暂无可刷新的数据", "ok");
      else showToast(failures.length ? `刷新完成：成功 ${ok} 项，失败 ${failures.length} 项` : `刷新成功：${ok} 项已更新到最新`, failures.length ? "err" : "ok");
    } finally {
      fetchLoading = false;
      render();
    }
  }

  function renderPositions(body: HTMLElement): void {
    const closed = store.positions.filter(isClosed);
    const holding = store.positions.length - closed.length;
    const totalPnl = store.positions.reduce((s, p) => s + (calcPnl(p)?.amount || 0), 0);
    const totalCost = store.positions.reduce((s, p) => s + p.buyPrice * p.buyQty, 0);
    const totalPct = totalCost ? totalPnl / totalCost : 0;
    const pnlCls = totalPnl > 0 ? "up" : totalPnl < 0 ? "down" : "";
    const headCenter = document.getElementById("headCenter");
    if (headCenter) {
      headCenter.innerHTML = `<span class="position-summary">持仓 ${holding} 笔，清仓 ${closed.length} 笔，总盈亏 <b class="${pnlCls}">${fmtSigned(totalPnl)}</b>，<b class="${pnlCls}">${fmtPct(totalPct)}</b></span>`;
    }
    body.innerHTML = `<div class="table-wrap" id="tableWrap"></div>`;
    const wrap = body.querySelector("#tableWrap") as HTMLElement;
    if (!store.positions.length) {
      wrap.innerHTML = `<div class="empty">还没有持仓，点右上「新建」记一只</div>`;
    } else {
      wrap.appendChild(buildTable());
    }
  }

  function buildTable(): HTMLElement {
    const headers: Array<{ k?: ColKey; label: string; num?: boolean; cls?: string }> = [
      { k: "name", label: "股票" },
      { k: "buyDate", label: "买入时间" },
      { k: "buyPrice", label: "成本", num: true },
      { k: "qty", label: "数量", num: true },
      { k: "status", label: "状态" },
      { k: "sellPrice", label: "卖价/现价", num: true },
      { k: "pnl", label: "盈亏", num: true },
      { k: "pnlPct", label: "盈亏%", num: true }
    ];
    const arrow = (k: ColKey) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");
    const thHtml = headers.map((h) => {
      const cls = [h.num ? "num" : "", h.cls || "", h.k ? "th-sort" : "", h.k && sortKey === h.k ? "on" : ""].filter(Boolean).join(" ");
      const attr = h.k ? ` data-k="${h.k}"` : "";
      return `<th class="${cls}"${attr}>${h.label}${h.k ? arrow(h.k) : ""}</th>`;
    }).join("");

    const table = document.createElement("table");
    table.className = "pos-table";
    table.innerHTML = `<thead><tr>${thHtml}<th class="th-ops"></th></tr></thead><tbody></tbody>`;

    const tbody = table.querySelector("tbody") as HTMLElement;
    for (const p of sortPositions()) tbody.appendChild(buildRow(p));

    // 表头点击排序
    table.querySelectorAll<HTMLTableCellElement>("th.th-sort").forEach((th) => {
      th.addEventListener("click", () => {
        const k = th.dataset.k as ColKey;
        if (sortKey === k) sortDir = sortDir === "asc" ? "desc" : "asc";
        else { sortKey = k; sortDir = th.classList.contains("num") ? "desc" : "asc"; }
        render();
      });
    });
    return table;
  }

  function buildRow(p: Position): HTMLElement {
    const closed = isClosed(p);
    const pl = calcPnl(p);
    const pnlCls = pl ? (pl.amount > 0 ? "up" : pl.amount < 0 ? "down" : "") : "";
    const currentPrice = closed ? null : getLatestPrice(p.name);
    const priceDisplay = closed
      ? fmtPrice(p.sellPrice as number)
      : currentPrice != null ? fmtPrice(currentPrice) : "—";
    const statusDisplay = closed
      ? `<span class="dim">${esc(p.sellDate as string)}</span> 清仓`
      : "持有中";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="td-name">${esc(p.name)}</td>
      <td class="dim">${esc(p.buyDate)}</td>
      <td class="num">${fmtPrice(p.buyPrice)}</td>
      <td class="num">${fmtNum(p.buyQty)}</td>
      <td>${statusDisplay}</td>
      <td class="num">${priceDisplay}</td>
      <td class="num ${pnlCls}">${pl ? fmtSigned(pl.amount) : "—"}</td>
      <td class="num ${pnlCls}">${pl ? fmtPct(pl.pct) : "—"}</td>
      <td class="td-ops">
        <button class="tx-op" title="编辑">${ICONS.edit}</button>
        <button class="tx-op del" title="删除">${ICONS.del}</button>
      </td>`;
    const [editBtn, delBtn] = tr.querySelectorAll<HTMLButtonElement>(".tx-op");
    tr.addEventListener("dblclick", (e) => {
      if ((e.target as HTMLElement).closest(".tx-op")) return;
      openForm(p);
    });
    editBtn.addEventListener("click", (e) => { e.stopPropagation(); openForm(p); });
    delBtn.addEventListener("click", async (e) => { e.stopPropagation(); await store.removePos(p.id); render(); });
    return tr;
  }

  // ── 新建/编辑表单（弹窗） ─────────────────────────────
  function openForm(edit: Position | null): void {
    document.querySelector(".sb-mask")?.remove();
    const mask = document.createElement("div");
    mask.className = "sb-mask";
    mask.innerHTML = `<div class="form-panel">
      <div class="fp-head"><span>${edit ? "编辑记录" : "新建记录"}</span><button class="head-btn" id="fpClose" title="关闭">✕</button></div>
      <div class="ff"><label>股票</label><input id="fName" class="ff-in" placeholder="名称" /></div>
      <div class="fp-leg">
        <div class="fp-leg-title buy">买入</div>
        <div class="ff-grid">
          <input id="bDate" class="ff-in" type="date" />
          <input id="bPrice" class="ff-in" inputmode="decimal" placeholder="价格" />
          <input id="bQty" class="ff-in" inputmode="numeric" placeholder="数量" />
        </div>
      </div>
      <div class="fp-leg">
        <div class="fp-leg-title sell">卖出 <span class="opt">留空 = 仍持有</span></div>
        <div class="ff-grid">
          <input id="sDate" class="ff-in" type="date" />
          <input id="sPrice" class="ff-in" inputmode="decimal" placeholder="价格" />
          <input id="sQty" class="ff-in" inputmode="numeric" placeholder="数量（默认同买入）" />
        </div>
      </div>
      <div class="fp-err" id="fErr"></div>
      <div class="fp-foot">
        <button class="nav-btn" id="fCancel">取消</button>
        <button class="q-add" id="fSave">${edit ? "保存" : "记下"}</button>
      </div>
    </div>`;
    document.body.appendChild(mask);

    const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => mask.querySelector(`#${id}`) as T;
    const close = () => mask.remove();
    mask.addEventListener("mousedown", (e) => { if (e.target === mask) close(); });
    $("fpClose").addEventListener("click", close);
    $("fCancel").addEventListener("click", close);

    // 初值
    ($("fName") as HTMLInputElement).value = edit?.name || "";
    ($("bDate") as HTMLInputElement).value = edit?.buyDate || todayStr();
    if (edit) {
      ($("bPrice") as HTMLInputElement).value = String(edit.buyPrice);
      ($("bQty") as HTMLInputElement).value = String(edit.buyQty);
      if (edit.sellDate) ($("sDate") as HTMLInputElement).value = edit.sellDate;
      if (edit.sellPrice != null) ($("sPrice") as HTMLInputElement).value = String(edit.sellPrice);
      if (edit.sellQty != null) ($("sQty") as HTMLInputElement).value = String(edit.sellQty);
    }

    const err = (msg: string, focusId?: string) => {
      $("fErr").textContent = msg;
      if (focusId) ($(focusId) as HTMLInputElement).focus();
    };

    const collect = (): FormResult | null => {
      const name = ($("fName") as HTMLInputElement).value.trim();
      if (!name) { err("请填股票名称", "fName"); return null; }
      const buyDate = ($("bDate") as HTMLInputElement).value || todayStr();
      const buyPrice = num(($("bPrice") as HTMLInputElement).value);
      const buyQty = num(($("bQty") as HTMLInputElement).value);
      if (buyPrice == null || buyPrice <= 0) { err("买入价格不正确", "bPrice"); return null; }
      if (buyQty == null || buyQty <= 0) { err("买入数量不正确", "bQty"); return null; }

      const sDate = ($("sDate") as HTMLInputElement).value;
      const sPrice = num(($("sPrice") as HTMLInputElement).value);
      const sQtyRaw = num(($("sQty") as HTMLInputElement).value);
      const hasSell = !!sDate || sPrice != null || sQtyRaw != null;
      const res: FormResult = {
        name, tagIds: [],
        buyDate, buyPrice: Math.round(buyPrice * 1000) / 1000, buyQty: Math.round(buyQty * 100) / 100
      };
      if (hasSell) {
        if (!sDate) { err("已填卖出，请补卖出日期", "sDate"); return null; }
        if (sPrice == null || sPrice <= 0) { err("卖出价格不正确", "sPrice"); return null; }
        res.sellDate = sDate;
        res.sellPrice = Math.round(sPrice * 1000) / 1000;
        if (sQtyRaw != null && sQtyRaw > 0) res.sellQty = Math.round(sQtyRaw * 100) / 100;
      }
      return res;
    };

    const save = async () => {
      const v = collect();
      if (!v) return;
      if (edit) {
        await store.updatePos(edit.id, { ...v, sellDate: v.sellDate, sellPrice: v.sellPrice, sellQty: v.sellQty });
      } else {
        await store.addPos(v);
      }
      close();
      render();
    };
    $("fSave").addEventListener("click", save);
    mask.querySelectorAll<HTMLInputElement>(".ff-in").forEach((el) => {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") close();
      });
    });
    ($("fName") as HTMLInputElement).focus();
  }

  // ── 标签管理面板 ──────────────────────────────────────
  function openTagPanel(): void {
    document.querySelector(".sb-mask")?.remove();
    const mask = document.createElement("div");
    mask.className = "sb-mask";
    mask.innerHTML = `<div class="tag-panel">
      <div class="fp-head"><span>标签管理</span><button class="head-btn" id="tpClose" title="关闭">✕</button></div>
      <div class="tag-panel-list" id="tpList"></div>
      <div class="tag-panel-add">
        <input id="tpName" class="ff-in" placeholder="新标签名" />
        <button class="q-add" id="tpAdd">添加</button>
      </div>
    </div>`;
    document.body.appendChild(mask);

    const close = () => {
      document.removeEventListener("keydown", onKeydown);
      mask.remove();
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    mask.addEventListener("mousedown", (e) => { if (e.target === mask) close(); });
    (mask.querySelector("#tpClose") as HTMLButtonElement).addEventListener("click", close);
    document.addEventListener("keydown", onKeydown);

    const renderList = () => {
      const box = mask.querySelector("#tpList") as HTMLElement;
      box.innerHTML = "";
      if (!store.tags.length) { box.innerHTML = `<div class="empty">还没有标签</div>`; return; }
      store.tags.forEach((tag, idx) => {
        const item = document.createElement("div");
        item.className = "tm-row";
        const swatches = PALETTE.map((c) =>
          `<button class="tm-swatch${c.toUpperCase() === tag.color.toUpperCase() ? " on" : ""}" data-c="${c}" style="background:${c}" title="${c}"></button>`
        ).join("") + `
          <input type="color" class="tm-color-input" value="${isHexColor(tag.color) ? tag.color : "#888888"}" title="调色板取色" />
          <input type="text" class="tm-hex-input" value="${esc(tag.color)}" placeholder="#RRGGBB" maxlength="7" />
        `;
        item.innerHTML = `
          <span class="tm-order">
            <button class="tx-op tm-up" title="上移" ${idx === 0 ? "disabled" : ""}>↑</button>
            <button class="tx-op tm-down" title="下移" ${idx === store.tags.length - 1 ? "disabled" : ""}>↓</button>
          </span>
          <input class="tm-name" value="${esc(tag.name)}" />
          <span class="tm-swatches">${swatches}</span>
          <button class="tx-op del" title="删除">${ICONS.del}</button>
        `;
        const nameInput = item.querySelector(".tm-name") as HTMLInputElement;
        const upBtn = item.querySelector(".tm-up") as HTMLButtonElement;
        const downBtn = item.querySelector(".tm-down") as HTMLButtonElement;
        upBtn.addEventListener("click", async () => { await store.moveTag(tag.id, idx - 1); renderList(); render(); });
        downBtn.addEventListener("click", async () => { await store.moveTag(tag.id, idx + 1); renderList(); render(); });
        nameInput.addEventListener("change", async () => {
          const v = nameInput.value.trim();
          if (v && v !== tag.name) await store.updateTag(tag.id, { name: v });
        });
        item.querySelectorAll<HTMLButtonElement>(".tm-swatch").forEach((sw) => {
          sw.addEventListener("click", async () => { await store.updateTag(tag.id, { color: sw.dataset.c! }); renderList(); render(); });
        });
        const colorInput = item.querySelector(".tm-color-input") as HTMLInputElement;
        const hexInput = item.querySelector(".tm-hex-input") as HTMLInputElement;
        colorInput.addEventListener("change", async () => {
          const val = colorInput.value;
          if (isHexColor(val)) {
            await store.updateTag(tag.id, { color: val });
            renderList();
            render();
          }
        });
        const commitHex = async () => {
          let val = hexInput.value.trim();
          if (val && val[0] !== "#") val = `#${val}`;
          if (isHexColor(val)) {
            await store.updateTag(tag.id, { color: val });
            renderList();
            render();
          } else {
            hexInput.value = tag.color;
          }
        };
        hexInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitHex();
          }
        });
        hexInput.addEventListener("blur", commitHex);
        (item.querySelector(".del") as HTMLButtonElement).addEventListener("click", async () => { await store.removeTag(tag.id); renderList(); render(); });
        box.appendChild(item);
      });
    };
    renderList();

    const nameInput = mask.querySelector("#tpName") as HTMLInputElement;
    const add = async () => {
      const v = nameInput.value.trim();
      if (!v) { nameInput.focus(); return; }
      await store.addTag(v, isHexColor(v) ? v : PALETTE[store.tags.length % PALETTE.length]);
      nameInput.value = "";
      renderList();
      render();
      nameInput.focus();
    };
    (mask.querySelector("#tpAdd") as HTMLButtonElement).addEventListener("click", add);
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  }

  render();
  return { render };
}

function periodRange(amount: number, unit: "month" | "year"): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end);
  if (unit === "month") start.setMonth(start.getMonth() - amount);
  else start.setFullYear(start.getFullYear() - amount);
  return { startDate: dateInputStr(start), endDate: dateInputStr(end) };
}

/** 基本面刷新默认取近 5 年报告期，保证多年财务序列不被短区间覆盖 */
function fundamentalRange(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 5);
  return { startDate: dateInputStr(start), endDate: dateInputStr(end) };
}

function dateInputStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 根据已有K线推算刷新范围：从最早日期到今天；无数据时回退默认1年 */
function klineRangeOrDefault(klines: { date: string; close: number }[]): { startDate: string; endDate: string } {
  if (klines.length) {
    const dates = klines.map((k) => k.date);
    const earliest = dates.reduce((a, b) => (a < b ? a : b));
    return { startDate: earliest, endDate: dateInputStr(new Date()) };
  }
  return defaultRefreshRange();
}

function showToast(message: string, type: "ok" | "err" = "ok"): void {
  if (!message) return;
  try {
    const parentSiyuan = (window.parent as any)?.siyuan;
    if (parentSiyuan && typeof parentSiyuan.showMessage === "function") {
      const syType = type === "err" ? "error" : "info";
      parentSiyuan.showMessage(message, type === "err" ? 6000 : 4000, syType);
      return;
    }
  } catch {
    // 忽略跨域错误，向下走 DOM fallback
  }
  document.querySelector(".sb-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = `sb-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), type === "err" ? 4200 : 2200);
}
