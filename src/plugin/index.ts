import { Menu, Plugin, Protyle, fetchPost, getActiveEditor, getAllEditor, openTab, showMessage } from "siyuan";

const BLOCK_HEIGHT = 460;
const PANEL_TAB = "stockBlockPanel";

interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
}

interface BlockOperation {
  doOperations?: Array<{ id?: string }>;
}

interface BlockRow {
  id: string;
  root_id: string;
  type: string;
}

interface InsertContext {
  blockID: string;
  docID: string;
}

export default class StockBlockPlugin extends Plugin {
  private topBarElement?: HTMLElement;

  onload() {
    this.addIcons(`
      <symbol id="iconStockBlock" viewBox="0 0 24 24">
        <path d="M3 3v18h18v-2H5V3H3Z"></path>
        <path d="M7.5 14.5l3.5-4 3 2.5 4.5-6 1.6 1.2-5.7 7.6-3-2.5-2.7 3.1-1.7-1.4Z"></path>
      </symbol>
    `);

    this.topBarElement = this.addTopBar({
      icon: "iconStockBlock",
      title: "股票块",
      position: "right",
      callback: (event) => this.openTopBarMenu(event)
    });

    // 独立面板：在标签页里放大显示同一套挂件（mode=panel）。
    this.addTab({
      type: PANEL_TAB,
      init() {
        this.element.innerHTML = `<div class="fn__flex fn__flex-column fn__flex-1">
          <iframe class="fn__flex-1" allowfullscreen src="/plugins/stock-block/widget/index.html?mode=panel&view=market&v=0.1.5"
            style="border:0;width:100%;min-height:0;display:block;background:transparent;"></iframe>
        </div>`;
      }
    });

    this.protyleSlash = [{
      id: "stock-block",
      filter: ["股票块", "股票", "持仓", "记录", "gupiao", "chicang", "stock"],
      html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconStockBlock"></use></svg><span class="b3-list-item__text">插入股票块</span></div>`,
      callback: (protyle: Protyle, nodeElement: HTMLElement) => {
        this.insertFromSlash(protyle, nodeElement);
      }
    }];

    this.addCommand({
      langKey: "insertStockBlock",
      langText: "插入股票块",
      hotkey: "",
      callback: () => this.insertAtCursor()
    });
    this.addCommand({
      langKey: "stockOpenPanel",
      langText: "打开股票面板",
      hotkey: "",
      callback: () => this.openPanel()
    });
  }

  private openPanel() {
    openTab({
      app: this.app,
      custom: {
        id: this.name + PANEL_TAB,
        icon: "iconStockBlock",
        title: "股票",
        data: { plugin: "stock-block", view: "market" }
      }
    });
  }

  private openTopBarMenu(event: MouseEvent) {
    const context = getCurrentContext();
    const menu = new Menu("stock-block-topbar");
    menu.addItem({
      icon: "iconStockBlock",
      label: "插入股票块",
      click: () => this.insertAtCursor(context)
    });
    menu.addSeparator();
    menu.addItem({
      icon: "iconStockBlock",
      label: "打开股票面板",
      click: () => this.openPanel()
    });
    const rect = this.menuAnchorRect(event);
    menu.open({ x: rect.left, y: rect.bottom, w: rect?.width, h: rect?.height });
  }

  private menuAnchorRect(event: MouseEvent): DOMRect {
    if (event.clientX > 0 && event.clientY > 0) {
      const size = 28;
      return new DOMRect(event.clientX - size / 2, event.clientY - size / 2, size, size);
    }
    const rect = this.topBarElement?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) return rect;
    const fallbackSize = 28;
    return new DOMRect(Math.max(window.innerWidth - fallbackSize - 12, 0), 8, fallbackSize, fallbackSize);
  }

  /** 斜杠菜单使用编辑器原生插入，避免先插入再延迟删除触发块造成闪烁 */
  private insertFromSlash(protyle: Protyle, nodeElement: HTMLElement) {
    const context = contextFromProtyle(protyle, nodeElement);
    try {
      protyle.insert(widgetMarkdown(), true, true);
    } catch (err) {
      console.error("stock-block: protyle.insert 失败，回退到内核插入", err);
      this.insertAtCursor(context);
    }
  }

  /** 在光标所在块下方插入挂件块；找不到光标时追加到当前文档末尾 */
  private async insertAtCursor(context = getCurrentContext()) {
    const docID = await resolveDocID(context);
    if (!docID) {
      showMessage("请先把光标放进文档", 5000, "error");
      return;
    }
    try {
      const previousID = context.blockID && context.blockID !== docID ? context.blockID : undefined;
      const operations = await insertWidgetBlock(docID, previousID);
      const insertedID = operations?.[0]?.doOperations?.[0]?.id || "";
      if (isBlockID(insertedID)) {
        await post("/api/attr/setBlockAttrs", {
          id: insertedID,
          attrs: { "custom-stock-block": "true", style: `height: ${BLOCK_HEIGHT}px;` }
        });
      }
    } catch (err) {
      showMessage(`插入失败：${err instanceof Error ? err.message : err}`, 6000, "error");
    }
  }
}

function widgetMarkdown(): string {
  const src = "/plugins/stock-block/widget/index.html?v=0.1.5";
  return `<iframe src="${src}" data-subtype="widget" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>`;
}

async function insertWidgetBlock(docID: string, previousID?: string): Promise<BlockOperation[]> {
  const payload: Record<string, unknown> = {
    dataType: "markdown",
    data: widgetMarkdown(),
    parentID: docID
  };
  if (previousID) {
    payload.previousID = previousID;
  }
  return post<BlockOperation[]>("/api/block/insertBlock", payload);
}

function post<T>(url: string, data?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    fetchPost(url, data, (response: ApiResponse<T>) => {
      if (response.code !== 0) {
        reject(new Error(response.msg || `${url} 调用失败`));
        return;
      }
      resolve(response.data);
    });
  });
}

async function resolveDocID(context: InsertContext): Promise<string> {
  const candidates = [context.blockID, context.docID].filter(isBlockID);
  for (const id of candidates) {
    const rows = await post<BlockRow[]>("/api/query/sql", {
      stmt: `SELECT id, root_id, type FROM blocks WHERE id='${id}' LIMIT 1`
    });
    const row = rows?.[0];
    if (!row) continue;
    if (row.type === "d" && isBlockID(row.id)) return row.id;
    if (isBlockID(row.root_id)) return row.root_id;
  }
  return "";
}

function contextFromProtyle(protyle: Protyle | undefined, nodeElement?: HTMLElement | null): InsertContext {
  const blockID = nodeElement?.dataset?.nodeId || "";
  const docID = protyle?.protyle?.block?.rootID || "";
  return {
    blockID: isBlockID(blockID) ? blockID : "",
    docID: isBlockID(docID) ? docID : ""
  };
}

function getCurrentContext(): InsertContext {
  let activeEditor: Protyle | undefined;
  try {
    activeEditor = getActiveEditor(false) || getAllEditor()?.[0];
  } catch {
    activeEditor = undefined;
  }
  const activeDocID = activeEditor?.protyle?.block?.rootID || "";
  const blockID = getCurrentBlockID(activeEditor);
  return {
    blockID,
    docID: isBlockID(activeDocID) ? activeDocID : ""
  };
}

function getBlockIDFromRange(range: Range | null | undefined): string {
  if (!range) return "";
  const node = range.startContainer;
  const element = node instanceof Element ? node : node?.parentElement;
  const blockEl = element?.closest?.("[data-node-id]") as HTMLElement | null;
  const blockID = blockEl?.getAttribute("data-node-id") || "";
  return isBlockID(blockID) ? blockID : "";
}

function getCurrentBlockID(activeEditor?: any): string {
  if (activeEditor) {
    const range = activeEditor.protyle?.toolbar?.range;
    const rangeBlockID = getBlockIDFromRange(range);
    if (isBlockID(rangeBlockID)) return rangeBlockID;
    const wysiwyg = activeEditor.protyle?.wysiwyg?.element;
    if (wysiwyg) {
      const selectors = [
        ".protyle-wysiwyg--active",
        ".protyle-wysiwyg--select",
        "[contenteditable='true']:focus",
        ":focus-within"
      ];
      for (const selector of selectors) {
        const el = wysiwyg.querySelector(selector);
        const block = el?.closest("[data-node-id]");
        const blockID = block?.getAttribute("data-node-id") || "";
        if (isBlockID(blockID)) return blockID;
      }
    }
    const docID = activeEditor.protyle?.block?.rootID || "";
    const blockID = activeEditor.protyle?.block?.id || "";
    if (isBlockID(blockID) && blockID !== docID) return blockID;
  }
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const selBlockID = getBlockIDFromRange(selection.getRangeAt(0));
    if (isBlockID(selBlockID)) return selBlockID;
  }
  const active = document.activeElement instanceof HTMLElement
    ? (document.activeElement.closest("[data-node-id]") as HTMLElement | null)
    : null;
  const activeID = active?.dataset?.nodeId || "";
  return isBlockID(activeID) ? activeID : "";
}

function isBlockID(value: string): boolean {
  return /^\d{14}-[a-z0-9]{7}$/.test(value);
}
