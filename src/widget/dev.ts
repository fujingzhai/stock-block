// 独立调试入口：mock 思源内核 API，用演示数据挂载股票块。仅开发用，不进打包。
import demoText from "./_demo.json?raw";
import "./widget.css";
import { syncTheme } from "./theme";
import { mountStockApp } from "./views/record";
import { StockStore } from "../shared/store";

// 内存中的数据文件，putFile 写回这里，getFile 读这里
let fileStore = demoText;

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, msg: "", data }), { headers: { "Content-Type": "application/json" } });

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("/api/file/getFile")) {
    return new Response(fileStore, { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("/api/file/putFile")) {
    const form = init?.body as FormData | undefined;
    const blob = form?.get("file") as Blob | undefined;
    if (blob) fileStore = await blob.text();
    return ok(null);
  }
  if (url.includes("/api/attr/getBlockAttrs")) return ok({});
  if (url.includes("/api/attr/setBlockAttrs")) return ok(null);
  if (url.includes("/api/network/forwardProxy")) {
    const body = JSON.parse((init?.body as string) || "{}");
    const target: string = body.url || "";
    const code = (/(?:secid=\d\.|SECUCODE=%22|SECUCODE="?)(\d{6})/.exec(target) || [])[1] || "000977";
    let payload: unknown = {};
    if (target.includes("push2")) {
      payload = { data: { f43: 57.86, f57: code, f58: code === "600580" ? "卧龙电驱" : "样本股", f116: 84966059258.3, f162: 35.12, f167: 3.82 } };
    } else {
      payload = { result: { data: [
        { SECUCODE: `${code}.SZ`, REPORT_DATE: "2025-12-31 00:00:00", EPSJB: 1.639, ROEJQ: 11.55, XSMLL: 4.88, ZCFZL: 73.64, TOTALOPERATEREVETZ: 43.25, PARENTNETPROFITTZ: 5.2 },
        { SECUCODE: `${code}.SZ`, REPORT_DATE: "2026-03-31 00:00:00", EPSJB: 0.41, ROEJQ: 2.75, XSMLL: 6.64, ZCFZL: 73.21, TOTALOPERATEREVETZ: -24.3, PARENTNETPROFITTZ: 30.74 }
      ] } };
    }
    return ok({ body: JSON.stringify(payload), status: 200, contentType: "application/json" });
  }
  return realFetch(input as RequestInfo, init);
}) as typeof window.fetch;

(async function init() {
  syncTheme();
  const root = document.getElementById("app") as HTMLElement;
  const sp = new URLSearchParams(location.search);
  const dark = sp.get("dark") === "1";
  const panel = sp.get("mode") === "panel";
  const initialView = sp.get("view") === "fundamentals" || sp.get("view") === "market" || sp.get("view") === "positions"
    ? sp.get("view") as "positions" | "fundamentals" | "market"
    : undefined;
  if (panel) document.body.dataset.mode = "panel";
  else delete document.body.dataset.mode;
  if (dark) document.documentElement.classList.add("dark");
  const store = new StockStore();
  await store.load();
  const handle = mountStockApp(root, store, { panel, initialView });
  store.onRemoteChange = () => handle.render();
})();
