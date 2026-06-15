/** 判断宿主当前是否暗色：优先读思源 <html data-theme-mode>，跨源/独立调试时回退系统配色 */
function hostIsDark(): boolean {
  try {
    const mode = window.parent.document.documentElement.getAttribute("data-theme-mode");
    if (mode === "dark") return true;
    if (mode === "light") return false;
  } catch {
    // 非同源（独立调试）时落到系统判断
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** 跟随宿主思源的明暗主题与字体；独立打开时按系统配色兜底 */
export function syncTheme(): void {
  document.documentElement.classList.toggle("dark", hostIsDark());
  try {
    const pdoc = window.parent.document;
    const pstyle = window.parent.getComputedStyle(pdoc.body);
    document.documentElement.style.setProperty("--siyuan-font-family", pstyle.fontFamily);
    document.documentElement.style.setProperty("--siyuan-font-size", pstyle.fontSize);
  } catch {
    // 非同源（独立调试）时忽略字体同步
  }
}

/** 实时监听宿主主题切换（手动换肤 / 系统昼夜自动），保证已打开的挂件即时同步明暗 */
export function watchTheme(): void {
  syncTheme();
  // 1) 思源切换明暗会改写 <html data-theme-mode>
  try {
    new MutationObserver(syncTheme).observe(window.parent.document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme-mode"],
    });
  } catch {
    // 非同源忽略
  }
  // 2) 思源 modeOS 开启时，明暗随系统昼夜变化
  try {
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);
  } catch {
    // 旧环境忽略
  }
  // 3) 兜底：标签重新可见时再同步一次
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncTheme();
  });
}

/** 把当前挂件高度（含 iframe 与其所在块元素）设为指定像素值 */
export function setWidgetHeight(px: number): void {
  try {
    const frame = window.frameElement as HTMLElement | null;
    if (!frame) return;
    frame.style.height = `${px}px`;
    const blockEl = frame.closest("[data-node-id]") as HTMLElement | null;
    if (blockEl) blockEl.style.height = `${px}px`;
  } catch {
    // 忽略
  }
}
