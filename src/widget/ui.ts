import { StockStore } from "../shared/store";

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export const ICONS = {
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  del: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>`,
  cog: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.4 13c.04-.33.06-.66.06-1s-.02-.67-.06-1l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.73-1l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.62.25-1.2.59-1.73 1l-2.39-.96a.5.5 0 0 0-.6.22L2.45 8.78a.5.5 0 0 0 .12.64L4.6 11c-.04.33-.06.66-.06 1s.02.67.06 1l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.53.41 1.11.75 1.73 1l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.62-.25 1.2-.59 1.73-1l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64L19.4 13ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"/></svg>`,
  grip: `<svg viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.3 6.4"/><path d="M3 12a9 9 0 0 1 15.3-6.4"/><path d="M18 3v5h-5"/><path d="M6 21v-5h5"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2.5" x2="8" y2="6"/><line x1="16" y1="2.5" x2="16" y2="6"/></svg>`
};

export function showError(root: HTMLElement, err: unknown): void {
  root.innerHTML = `<div class="load-error">⚠ ${esc(err instanceof Error ? err.message : String(err))}</div>`;
}

/** 多选标签选择器。按钮展示已选标签色点摘要；下拉里点选切换；返回 wrap 元素，选中变化经 onChange 回调 */
export function tagPicker(store: StockStore, initial: string[], onChange: (ids: string[]) => void, options: { noColor?: boolean; noName?: boolean } = {}): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "cat-pick";
  let selected = [...initial];

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cat-pick-btn tag-pick-btn";

  const menu = document.createElement("div");
  menu.className = "cat-menu";

  const paint = () => {
    const tags = selected.map((id) => store.tag(id)).filter((t) => t);
    if (!tags.length) {
      btn.innerHTML = `<span class="tag-pick-empty">标签</span> <span style="color:var(--fg-faint)">▾</span>`;
      return;
    }
    const dots = options.noColor ? "" : tags.map((t) => `<span class="dot" style="background:${t!.color}" title="${esc(t!.name)}"></span>`).join("");
    const names = options.noName ? "" : `<span class="tag-pick-names">${tags.map((t) => esc(t!.name)).join("、")}</span> `;
    btn.innerHTML = `${dots}${names}<span style="color:var(--fg-faint)">▾</span>`;
  };
  paint();
  wrap.appendChild(btn);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = menu.parentElement !== null;
    document.querySelectorAll(".cat-menu").forEach((m) => m.remove());
    if (isOpen) return;

    menu.innerHTML = "";
    if (!store.tags.length) {
      const empty = document.createElement("div");
      empty.className = "cat-menu-empty";
      empty.textContent = "还没有标签，去「标签管理」新建";
      menu.appendChild(empty);
    } else {
      for (const tag of store.tags) {
        menu.appendChild(item(tag.id, tag.name, tag.color));
      }
      const footer = document.createElement("div");
      footer.className = "cat-menu-footer";
      footer.innerHTML = `<button type="button" class="cat-menu-btn confirm">确定</button>`;
      footer.querySelector(".confirm")!.addEventListener("click", (ev) => {
        ev.stopPropagation();
        cleanup();
      });
      menu.appendChild(footer);
    }

    const cleanup = () => {
      menu.remove();
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" || ev.key === "Enter") {
        ev.preventDefault();
        ev.stopPropagation();
        cleanup();
      }
    };

    const close = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node) && !btn.contains(ev.target as Node)) {
        cleanup();
      }
    };

    menu.addEventListener("mousedown", (ev) => ev.stopPropagation());
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    const mh = Math.min(menu.scrollHeight, 290);
    const below = window.innerHeight - r.bottom;
    menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = below > mh + 8 || below > r.top
      ? `${r.bottom + 4}px`
      : `${Math.max(4, r.top - mh - 4)}px`;

    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", onKeyDown, true);

    function item(id: string, name: string, color: string): HTMLElement {
      const el = document.createElement("button");
      el.type = "button";
      const on = selected.includes(id);
      el.className = `cat-menu-item${on ? " on" : ""}`;
      const dotHtml = options.noColor ? "" : `<span class="dot" style="background:${color}"></span>`;
      el.innerHTML = `${dotHtml}<span class="cat-menu-name">${esc(name)}</span>${on ? `<span class="cat-menu-tick">${ICONS.check}</span>` : ""}`;
      el.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
        // 重绘菜单项勾选态
        menu.querySelectorAll<HTMLButtonElement>(".cat-menu-item").forEach((node, idx) => {
          const tid = store.tags[idx]?.id;
          const isOn = tid ? selected.includes(tid) : false;
          node.classList.toggle("on", isOn);
          const tick = node.querySelector(".cat-menu-tick");
          if (isOn && !tick) {
            const s = document.createElement("span");
            s.className = "cat-menu-tick";
            s.innerHTML = ICONS.check;
            node.appendChild(s);
          } else if (!isOn && tick) {
            tick.remove();
          }
        });
        paint();
        onChange([...selected]);
      });
      return el;
    }
  });

  return wrap;
}
