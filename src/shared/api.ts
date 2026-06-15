/** 思源内核 API 封装。挂件与思源同源，凭会话即可调用；独立调试可在 URL 带 ?token=xxx */

const TOKEN = typeof window !== "undefined"
  ? new URLSearchParams(window.location.search).get("token") || ""
  : "";

function authHeaders(): Record<string, string> {
  return TOKEN ? { Authorization: `Token ${TOKEN}` } : {};
}

interface KernelResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
}

export async function kernel<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? "{}" : JSON.stringify(body)
  });
  const data = (await res.json()) as KernelResponse<T>;
  if (data.code !== 0) {
    throw new Error(data.msg || `${path} 调用失败`);
  }
  return data.data;
}

interface ForwardProxyResp {
  body: string;
  status: number;
  contentType: string;
}

/** 优先直连外部接口，失败时通过思源内核 forwardProxy 代理转发 */
export async function proxyGet(url: string, headers: Record<string, string> = {}, options: { skipProxy?: boolean } = {}): Promise<string> {
  // 1. 优先尝试直连 (Direct connection)
  try {
    const res = await fetch(url, {
      method: "GET"
    });
    if (res.ok) {
      const buffer = await res.arrayBuffer();
      const isGBK = url.includes("gtimg.cn") || res.headers.get("content-type")?.toLowerCase().includes("gbk");
      const text = new TextDecoder(isGBK ? "gbk" : "utf-8").decode(buffer);
      // 验证格式是否符合预期（JSON 或者腾讯接口的 v_ 格式）
      if (text.startsWith("v_") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
        console.log(`[stock-block] 直连获取成功: ${url}`);
        return text;
      }
      throw new Error("响应格式不合规");
    }
  } catch (err) {
    console.warn(`[stock-block] 直连失败，准备通过思源内核代理: ${url}`, err);
  }

  if (options.skipProxy) {
    throw new Error("直连请求失败，且该接口已跳过思源代理");
  }

  // 2. 直连失败，回退到思源内核代理 (Fallback to SiYuan kernel proxy)
  // 注意：GET 请求的 payload 必须为 "" 字符串而不能是 {}，否则某些严格的 Web 服务器（如 Eastmoney）会报 413 Payload Too Large
  const res = await kernel<ForwardProxyResp>("/api/network/forwardProxy", {
    url,
    method: "GET",
    timeout: 8000,
    contentType: "application/json",
    headers: [headers],
    payload: ""
  });
  if (res.status >= 400) {
    throw new Error(`请求失败（HTTP ${res.status}）`);
  }
  return res.body;
}

const BLOCK_ID_RE = /^\d{14}-[a-z0-9]{7}$/;
export function isBlockID(value: string): boolean {
  return BLOCK_ID_RE.test(value);
}

/** 读取块属性；非法 id 或失败时返回空对象 */
export async function getBlockAttrs(id: string): Promise<Record<string, string>> {
  if (!isBlockID(id)) return {};
  try {
    return await kernel<Record<string, string>>("/api/attr/getBlockAttrs", { id });
  } catch {
    return {};
  }
}

/** 写入块属性；非法 id 时静默跳过 */
export async function setBlockAttrs(id: string, attrs: Record<string, string>): Promise<void> {
  if (!isBlockID(id)) return;
  await kernel("/api/attr/setBlockAttrs", { id, attrs });
}

/** 读工作区文件，不存在时返回 null */
export async function readWorkspaceFile(path: string): Promise<string | null> {
  const res = await fetch("/api/file/getFile", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ path })
  });
  const text = await res.text();
  if (!res.ok) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && "code" in parsed && "msg" in parsed && parsed.code !== 0) {
      return null;
    }
  } catch {
    // 文件内容不是内核错误包装 —— 返回原文
  }
  return text;
}

export async function writeWorkspaceFile(path: string, content: string): Promise<void> {
  const form = new FormData();
  form.append("path", path);
  form.append("isDir", "false");
  form.append("modTime", String(Date.now()));
  form.append("file", new Blob([content], { type: "application/json" }), path.split("/").pop() || "file");
  const res = await fetch("/api/file/putFile", {
    method: "POST",
    headers: authHeaders(),
    body: form
  });
  const data = (await res.json()) as KernelResponse;
  if (data.code !== 0) {
    throw new Error(data.msg || "保存文件失败");
  }
}
