import { readWorkspaceFile, writeWorkspaceFile } from "./api";
import { Tag, StockData, Position, Fundamental, StockKline, MarketKline, MarketKind, defaultData, genId, normalizeColor, SortKey, SortDir } from "./model";

const FILE = "/data/storage/stock-block/data.json";
const BAK_FILE = "/data/storage/stock-block/data.json.bak";
const UNDO_LIMIT = 50;
const CHANNEL = "stock-block";

/** 全部股票块共享同一份数据；BroadcastChannel 让同时打开的多个块即时同步 */
export class StockStore {
  data: StockData = defaultData();
  onRemoteChange?: () => void;
  /** 数据未成功加载（文件损坏或读取失败）时禁止一切写入，防止覆盖原有数据 */
  loadFailed = false;
  private channel: BroadcastChannel | null = null;
  private undoStack: string[] = [];
  private lastGoodText: string | null = null;
  private persistLock: Promise<void> = Promise.resolve();
  private refreshTimer: number | null = null;
  private fileExisted = false;

  constructor() {
    try {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = async () => {
        try {
          await this.load();
        } catch {
          // 远端同步失败时保留 loadFailed 状态，下次写入会被拦截
        }
        this.undoStack = [];
        this.onRemoteChange?.();
      };
    } catch {
      this.channel = null;
    }
  }

  async load(): Promise<void> {
    let text: string | null;
    try {
      text = await readWorkspaceFile(FILE);
    } catch (err) {
      this.loadFailed = true;
      throw err;
    }
    if (!text) {
      if (this.fileExisted) {
        this.loadFailed = true;
        throw new Error("股票数据读取失败（返回空），已禁止保存以防覆盖");
      }
      this.data = defaultData();
      this.lastGoodText = null;
      this.loadFailed = false;
      return;
    }
    try {
      const parsed = JSON.parse(text) as StockData;
      if (!parsed || !Array.isArray(parsed.positions) || !Array.isArray(parsed.tags)) {
        throw new Error("缺少必要字段");
      }
      this.data = parsed;
      if (!this.data.sortBy) this.data.sortBy = "active";
      if (!this.data.sortOrder) this.data.sortOrder = "desc";
      this.normalize();
      this.lastGoodText = text;
      this.fileExisted = true;
      this.loadFailed = false;
    } catch {
      this.loadFailed = true;
      throw new Error("股票数据解析失败，已禁止保存以防覆盖（可检查 data/storage/stock-block/data.json）");
    }
  }

  // ── 记录（持仓/交易轮次） ─────────────────────────────
  get positions(): Position[] {
    return this.data.positions;
  }
  getPos(id: string): Position | undefined {
    return this.positions.find((p) => p.id === id);
  }
  async addPos(pos: Omit<Position, "id" | "created">): Promise<Position> {
    this.ensureWritable();
    this.snapshot();
    const full: Position = { ...pos, tagIds: [...pos.tagIds], id: genId(), created: Date.now() };
    this.data.positions.push(full);
    this.rememberTags(pos.tagIds);
    await this.persist();
    return full;
  }
  async updatePos(id: string, patch: Partial<Position>): Promise<void> {
    this.ensureWritable();
    const pos = this.getPos(id);
    if (!pos) return;
    this.snapshot();
    Object.assign(pos, patch);
    if (patch.tagIds) pos.tagIds = [...patch.tagIds];
    if (patch.tagIds !== undefined) this.rememberTags(pos.tagIds);
    await this.persist();
  }
  async removePos(id: string): Promise<void> {
    this.ensureWritable();
    if (!this.getPos(id)) return;
    this.snapshot();
    this.data.positions = this.positions.filter((p) => p.id !== id);
    await this.persist();
  }

  // ── 标签 ────────────────────────────────────────────
  get tags(): Tag[] {
    return this.data.tags;
  }
  tag(id: string): Tag | undefined {
    return this.tags.find((t) => t.id === id);
  }
  /** 记录上有效的标签（过滤掉已删除的） */
  posTags(pos: Position): Tag[] {
    return pos.tagIds.map((id) => this.tag(id)).filter((t): t is Tag => !!t);
  }
  get lastTagIds(): string[] {
    return (this.data.lastTagIds || []).filter((id) => this.tag(id));
  }
  async addTag(name: string, color: string): Promise<Tag> {
    this.ensureWritable();
    this.snapshot();
    const tag: Tag = { id: genId(), name, color: normalizeColor(color, this.tags.length) };
    this.data.tags.push(tag);
    await this.persist();
    return tag;
  }
  async updateTag(id: string, patch: Partial<Tag>): Promise<void> {
    this.ensureWritable();
    const tag = this.tag(id);
    if (!tag) return;
    this.snapshot();
    Object.assign(tag, patch);
    await this.persist();
  }
  async moveTag(id: string, toIndex: number): Promise<void> {
    this.ensureWritable();
    const idx = this.tags.findIndex((t) => t.id === id);
    if (idx < 0) return;
    this.snapshot();
    const [tag] = this.data.tags.splice(idx, 1);
    this.data.tags.splice(Math.max(0, Math.min(toIndex, this.data.tags.length)), 0, tag);
    await this.persist();
  }
  /** 删除标签，并从所有记录上摘掉它 */
  async removeTag(id: string): Promise<void> {
    this.ensureWritable();
    this.snapshot();
    this.data.tags = this.tags.filter((t) => t.id !== id);
    for (const pos of this.positions) {
      pos.tagIds = pos.tagIds.filter((tid) => tid !== id);
    }
    for (const f of this.data.fundamentals) {
      if (Array.isArray(f.tagIds)) f.tagIds = f.tagIds.filter((tid) => tid !== id);
    }
    for (const s of this.individualStocks) {
      if (Array.isArray(s.tagIds)) s.tagIds = s.tagIds.filter((tid) => tid !== id);
    }
    for (const s of this.marketSeries) {
      if (Array.isArray(s.tagIds)) s.tagIds = s.tagIds.filter((tid) => tid !== id);
    }
    this.data.lastTagIds = (this.data.lastTagIds || []).filter((tid) => tid !== id);
    await this.persist();
  }

  // ── 基本面 ──────────────────────────────────────────
  get fundamentals(): Fundamental[] {
    return this.data.fundamentals;
  }
  getFundamental(code: string): Fundamental | undefined {
    return this.fundamentals.find((f) => f.code === code);
  }
  /** 写入或更新某代码的基本面快照（刷新时保留已有标签） */
  async upsertFundamental(f: Fundamental): Promise<void> {
    this.ensureWritable();
    this.snapshot();
    const idx = this.fundamentals.findIndex((x) => x.code === f.code);
    if (idx >= 0) {
      const prev = this.data.fundamentals[idx];
      this.data.fundamentals[idx] = { ...f, tagIds: f.tagIds ?? prev.tagIds ?? [] };
    } else {
      this.data.fundamentals.push({ ...f, tagIds: f.tagIds ?? [] });
    }
    await this.persist();
  }
  /** 某代码上有效的标签（过滤掉已删除的） */
  fundTags(f: Fundamental): Tag[] {
    return (f.tagIds || []).map((id) => this.tag(id)).filter((t): t is Tag => !!t);
  }
  /** 给某代码设置标签 */
  async setFundamentalTags(code: string, tagIds: string[]): Promise<void> {
    this.ensureWritable();
    const f = this.getFundamental(code);
    const s = this.getStockKline(code);
    if (!f && !s) return;
    this.snapshot();
    if (f) f.tagIds = [...tagIds];
    if (s) s.tagIds = [...tagIds];
    this.rememberTags(tagIds);
    await this.persist();
  }
  async removeFundamental(code: string): Promise<void> {
    this.ensureWritable();
    if (!this.getFundamental(code)) return;
    this.snapshot();
    this.data.fundamentals = this.fundamentals.filter((f) => f.code !== code);
    await this.persist();
  }

  // ── 个股历史K线数据 ──────────────────────────────────
  get individualStocks(): StockKline[] {
    return this.data.individualStocks || [];
  }
  getStockKline(code: string): StockKline | undefined {
    return this.individualStocks.find((s) => s.code === code);
  }
  async upsertStockKline(s: StockKline): Promise<void> {
    this.ensureWritable();
    this.snapshot();
    if (!this.data.individualStocks) this.data.individualStocks = [];
    const idx = this.data.individualStocks.findIndex((x) => x.code === s.code);
    if (idx >= 0) {
      const prev = this.data.individualStocks[idx];
      this.data.individualStocks[idx] = { ...s, tagIds: s.tagIds ?? prev.tagIds ?? [] };
    }
    else this.data.individualStocks.push(s);
    await this.persist();
  }
  async removeStockKline(code: string): Promise<void> {
    this.ensureWritable();
    if (!this.getStockKline(code)) return;
    this.snapshot();
    this.data.individualStocks = this.individualStocks.filter((s) => s.code !== code);
    await this.persist();
  }

  /** 给个股K线设置标签 */
  async setStockKlineTags(code: string, tagIds: string[]): Promise<void> {
    return this.setSeriesTags("stock", code, tagIds);
  }

  /** 给各种行情系列（个股、指数、板块、基金等）设置标签 */
  async setSeriesTags(kind: string, code: string, tagIds: string[]): Promise<void> {
    this.ensureWritable();
    this.snapshot();
    if (kind === "stock") {
      const s = this.getStockKline(code);
      if (s) {
        s.tagIds = [...tagIds];
      }
      const f = this.getFundamental(code);
      if (f) {
        f.tagIds = [...tagIds];
      }
    } else if (kind === "index" || kind === "board" || kind === "fund") {
      let s = this.getMarketSeries(kind as MarketKind, code);
      if (!s) {
        s = {
          kind: kind as MarketKind,
          code: code,
          name: code,
          timeframe: "1Y",
          klines: [],
          fetchedAt: Date.now()
        };
        this.data.marketSeries = this.data.marketSeries || [];
        this.data.marketSeries.push(s);
      }
      if (s) {
        s.tagIds = [...tagIds];
      }
    }
    this.rememberTags(tagIds);
    await this.persist();
  }

  // ── 行业 / 概念 / 基金行情数据 ───────────────────────
  get marketSeries(): MarketKline[] {
    return this.data.marketSeries || [];
  }
  marketSeriesByKind(kind: MarketKind): MarketKline[] {
    return this.marketSeries.filter((s) => s.kind === kind);
  }
  getMarketSeries(kind: MarketKind, code: string): MarketKline | undefined {
    return this.marketSeries.find((s) => s.kind === kind && s.code === code);
  }
  async upsertMarketSeries(s: MarketKline): Promise<void> {
    this.ensureWritable();
    this.snapshot();
    if (!this.data.marketSeries) this.data.marketSeries = [];
    const idx = this.data.marketSeries.findIndex((x) => x.kind === s.kind && x.code === s.code);
    if (idx >= 0) {
      const prev = this.data.marketSeries[idx];
      this.data.marketSeries[idx] = { ...s, tagIds: s.tagIds ?? prev.tagIds ?? [] };
    }
    else this.data.marketSeries.push(s);
    await this.persist();
  }
  async removeMarketSeries(kind: MarketKind, code: string): Promise<void> {
    this.ensureWritable();
    if (!this.getMarketSeries(kind, code)) return;
    this.snapshot();
    this.data.marketSeries = this.marketSeries.filter((s) => !(s.kind === kind && s.code === code));
    await this.persist();
  }

  // ── 偏好 ────────────────────────────────────────────
  get sortBy(): SortKey {
    return this.data.sortBy || "active";
  }
  get sortOrder(): SortDir {
    return this.data.sortOrder || "desc";
  }
  async setSortSettings(by: SortKey, order: SortDir): Promise<void> {
    this.ensureWritable();
    if (this.sortBy === by && this.sortOrder === order) return;
    this.snapshot();
    this.data.sortBy = by;
    this.data.sortOrder = order;
    await this.persist();
  }

  // ── 撤销 ────────────────────────────────────────────
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  async undo(): Promise<boolean> {
    this.ensureWritable();
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.data = JSON.parse(prev);
    await this.persist();
    return true;
  }

  /** 周期性重读数据，兜底跨设备云同步带来的文件变化 */
  startAutoRefresh(intervalMs = 60000): void {
    this.stopAutoRefresh();
    this.refreshTimer = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const before = this.lastGoodText;
        await this.load();
        if (this.lastGoodText !== before) {
          this.undoStack = [];
          this.onRemoteChange?.();
        }
      } catch {
        // 读取失败时保留 loadFailed 状态，写入会被拦截
      }
    }, intervalMs);
  }
  stopAutoRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private ensureWritable(): void {
    if (this.loadFailed) {
      throw new Error("股票数据未正确加载，已禁止修改以防覆盖原有数据");
    }
  }
  private snapshot(): void {
    this.undoStack.push(JSON.stringify(this.data));
    if (this.undoStack.length > UNDO_LIMIT) {
      this.undoStack.shift();
    }
  }

  private normalize(): void {
    if (!Array.isArray(this.data.fundamentals)) this.data.fundamentals = [];
    if (!Array.isArray(this.data.individualStocks)) this.data.individualStocks = [];
    if (!Array.isArray(this.data.marketSeries)) this.data.marketSeries = [];
    this.migrateLegacy();
    this.data.tags = this.data.tags.map((tag, idx) => ({
      ...tag,
      color: normalizeColor(tag.color, idx)
    }));
    const ids = new Set(this.data.tags.map((t) => t.id));
    for (const pos of this.data.positions) {
      if (!Array.isArray(pos.tagIds)) pos.tagIds = [];
      pos.tagIds = pos.tagIds.filter((id) => ids.has(id));
    }
    for (const s of this.data.individualStocks) {
      if (!Array.isArray(s.tagIds)) s.tagIds = [];
      s.tagIds = s.tagIds.filter((id) => ids.has(id));
    }
    for (const f of this.data.fundamentals) {
      if (!Array.isArray(f.tagIds)) f.tagIds = [];
      f.tagIds = f.tagIds.filter((id) => ids.has(id));
    }
    for (const s of this.data.marketSeries) {
      if (!Array.isArray(s.tagIds)) s.tagIds = [];
      s.tagIds = s.tagIds.filter((id) => ids.has(id));
    }
    for (const s of this.data.individualStocks) {
      const f = this.getFundamental(s.code);
      if (f) f.tagIds = [...(s.tagIds || [])];
    }
    this.data.lastTagIds = (this.data.lastTagIds || []).filter((id) => ids.has(id));
  }

  private rememberTags(tagIds: string[]): void {
    this.data.lastTagIds = tagIds.filter((id) => this.tag(id));
  }

  /** 兼容旧版数据：单期基本面→多报告期、行业/概念→合并板块 */
  private migrateLegacy(): void {
    for (const f of this.data.fundamentals as any[]) {
      if (Array.isArray(f.periods)) continue;
      f.periods = f.reportDate
        ? [{
            reportDate: f.reportDate,
            roe: f.roe, grossMargin: f.grossMargin, debtRatio: f.debtRatio,
            profitGrowth: f.profitGrowth, revGrowth: f.revGrowth, eps: f.eps
          }]
        : [];
      delete f.roe; delete f.grossMargin; delete f.debtRatio;
      delete f.profitGrowth; delete f.revGrowth; delete f.eps;
      delete f.reportDate; delete f.peg;
    }
    for (const f of this.data.fundamentals as any[]) {
      if (!Array.isArray(f.tagIds)) f.tagIds = [];
    }
    for (const s of this.data.marketSeries as any[]) {
      if (s.kind === "industry" || s.kind === "concept") {
        s.boardType = s.kind;
        s.kind = "board";
      }
    }
    const builtinIds = new Set([
      "sh000001", "sh000002", "sh000003", "sh000016", "sh000300", "sh000905", "sh000852", "sh000688",
      "sz399001", "sz399005", "sz399006", "sz399300"
    ]);
    for (const s of this.data.marketSeries || []) {
      if (s.kind === "index" && !builtinIds.has(s.code)) {
        s.kind = "board";
      }
    }
  }

  private async persist(): Promise<void> {
    this.ensureWritable();
    const run = async () => {
      this.data.updated = new Date().toISOString();
      const text = JSON.stringify(this.data, null, 2);
      if (this.lastGoodText && this.lastGoodText !== text) {
        try {
          await writeWorkspaceFile(BAK_FILE, this.lastGoodText);
        } catch {
          // 备份失败不阻塞正常保存
        }
      }
      await writeWorkspaceFile(FILE, text);
      this.lastGoodText = text;
      this.fileExisted = true;
    };
    // 串行化写入；前一次失败不阻塞本次，错误只抛给各自调用方
    const task = this.persistLock.then(run, run);
    this.persistLock = task.then(() => undefined, () => undefined);
    await task;
    this.channel?.postMessage("changed");
  }
}
