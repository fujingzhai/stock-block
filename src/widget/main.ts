import { StockStore } from "../shared/store";
import { watchTheme } from "./theme";
import { showError } from "./ui";
import { mountStockApp } from "./views/record";

export interface ViewHandle {
  /** 数据被其他块改写后的重绘；编辑中可自行跳过 */
  render(): void;
}

const root = document.getElementById("app") as HTMLElement;
const params = new URLSearchParams(location.search);
const panel = params.get("mode") === "panel";
const initialView = params.get("view") === "fundamentals" || params.get("view") === "market" || params.get("view") === "positions"
  ? params.get("view") as "positions" | "fundamentals" | "market"
  : undefined;
if (panel) document.body.dataset.mode = "panel";
else delete document.body.dataset.mode;

(async function init() {
  watchTheme();

  const store = new StockStore();
  try {
    await store.load();
  } catch (err) {
    showError(root, err);
    // 读取失败也继续挂载轮询，等待自愈
  }

  const handle = mountStockApp(root, store, { panel, initialView });
  store.onRemoteChange = () => handle.render();
  store.startAutoRefresh();

  // Cmd/Ctrl+Z 撤销最近一次操作
  document.addEventListener("keydown", async (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      e.preventDefault();
      try {
        if (await store.undo()) handle.render();
      } catch {
        // 数据未加载时忽略
      }
    }
  });
})();
