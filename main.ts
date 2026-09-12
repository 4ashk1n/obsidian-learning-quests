import { App, Component, ItemView, MarkdownRenderer, Modal, Notice, Plugin, PluginSettingTab, requestUrl, setIcon, Setting, SuggestModal, TFile, WorkspaceLeaf } from "obsidian";
import { DEMO_PACKS } from "./src/demo-pack";
import {
  LearningQuestsSettings,
  PackBackgroundSettings,
  ProgressState,
  Quest,
  QuestNodePosition,
  QuestPack,
  QuestTask,
  SingleChoiceTask
} from "./src/models";
import { normalizeQuestPacks } from "./src/quest-loader";
import { isQuestUnlocked, isStreakActive, isTaskCompleted, isTaskSkipped, normalizeStreak, updateStreak } from "./src/quest-engine";

const VIEW_TYPE_LEARNING_QUESTS = "learning-quests-view";
const QUEST_FOLDER = "Learning Quests/quests";

const NODE_WIDTH = 176;
const NODE_HEIGHT = 148;
const GATE_WIDTH = 240;
const GATE_MIN_HEIGHT = 168;
const NODE_ICON_SIZE = 56;
const GATE_ICON_SIZE = 64;
const DEFAULT_PACK_BACKGROUND: PackBackgroundSettings = {
  mode: "grid",
  gradientStart: "rgba(0, 180, 165, 0.18)",
  gradientEnd: "rgba(210, 80, 120, 0.14)"
};

const DEFAULT_SETTINGS: LearningQuestsSettings = {
  trackedFolders: ["Learning Quests"],
  nodePositions: {},
  packBackgrounds: {},
  packTitleOverrides: {},
  progress: {
    xp: 0,
    completedQuests: [],
    completedTasks: {},
    skippedTasks: {},
    rewardedTasks: {},
    streak: {
      current: 0,
      best: 0
    },
    answers: {},
    selectedNotes: {}
  }
};

export default class LearningQuestsPlugin extends Plugin {
  settings!: LearningQuestsSettings;
  questPacks: QuestPack[] = [];

  async onload() {
    await this.loadSettings();
    await this.loadQuestPacks();
    this.registerQuestPackWatchers();

    this.registerView(
      VIEW_TYPE_LEARNING_QUESTS,
      (leaf) => new LearningQuestsView(leaf, this)
    );

    this.addRibbonIcon("trophy", "Learning Quests", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-learning-quests",
      name: "Open quest book",
      callback: () => void this.activateView()
    });

    this.addCommand({
      id: "reload-learning-quest-packs",
      name: "Reload quest packs",
      callback: async () => {
        await this.loadQuestPacks();
        this.refreshViews();
        new Notice("Learning quest packs reloaded");
      }
    });

    this.addCommand({
      id: "create-demo-quest-pack",
      name: "Create demo quest packs in vault",
      callback: () => void this.createDemoQuestPack()
    });

    this.addSettingTab(new LearningQuestsSettingTab(this.app, this));
    this.registerInterval(window.setInterval(() => {
      void this.expireInactiveStreak();
    }, 60_000));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.trackedFolders = this.settings.trackedFolders ?? DEFAULT_SETTINGS.trackedFolders;
    this.settings.nodePositions = normalizeNodePositions(this.settings.nodePositions);
    this.settings.packBackgrounds = normalizePackBackgrounds(this.settings.packBackgrounds);
    this.settings.packTitleOverrides = normalizeStringRecord(this.settings.packTitleOverrides);
    this.settings.progress = {
      ...DEFAULT_SETTINGS.progress,
      ...this.settings.progress,
      streak: {
        ...DEFAULT_SETTINGS.progress.streak,
        ...this.settings.progress?.streak
      },
      answers: this.settings.progress?.answers ?? {},
      completedTasks: this.settings.progress?.completedTasks ?? {},
      skippedTasks: this.settings.progress?.skippedTasks ?? {},
      rewardedTasks: this.settings.progress?.rewardedTasks ?? {},
      selectedNotes: this.settings.progress?.selectedNotes ?? {}
    };
    const normalizedStreak = normalizeStreak(this.settings.progress.streak, new Date());
    if (normalizedStreak.current !== this.settings.progress.streak.current) {
      this.settings.progress.streak = normalizedStreak;
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async expireInactiveStreak() {
    const normalized = normalizeStreak(this.settings.progress.streak, new Date());
    if (normalized.current === this.settings.progress.streak.current) {
      return;
    }

    this.settings.progress.streak = normalized;
    await this.saveSettings();
    this.refreshViews();
  }

  async loadQuestPacks() {
    const files = this.app.vault
      .getFiles()
      .filter((file) => file.path.startsWith(`${QUEST_FOLDER}/`) && file.extension === "json");

    const loaded: QuestPack[] = [];

    for (const file of files) {
      try {
        const raw = await this.app.vault.read(file);
        loaded.push(...normalizeQuestPacks(JSON.parse(raw), file.path));
      } catch (error) {
        console.error(`Failed to load quest pack ${file.path}`, error);
        new Notice(`Failed to load quest pack: ${file.name}`);
      }
    }

    this.questPacks = loaded.length > 0 ? loaded : DEMO_PACKS;
    await this.syncAutoCompletedTasks();
  }

  registerQuestPackWatchers() {
    const maybeReload = (file: unknown) => {
      if (!(file instanceof TFile)) {
        return;
      }

      if (!file.path.startsWith(`${QUEST_FOLDER}/`) || file.extension !== "json") {
        return;
      }

      void this.loadQuestPacks().then(() => this.refreshViews());
    };

    this.registerEvent(this.app.vault.on("create", maybeReload));
    this.registerEvent(this.app.vault.on("modify", maybeReload));
    this.registerEvent(this.app.vault.on("delete", maybeReload));
  }

  async createDemoQuestPack() {
    await this.ensureVaultFolder(QUEST_FOLDER);

    let created = 0;
    let skipped = 0;

    for (const pack of DEMO_PACKS) {
      const path = `${QUEST_FOLDER}/${pack.packId}.json`;
      const existing = this.app.vault.getAbstractFileByPath(path);

      if (existing instanceof TFile) {
        skipped += 1;
        continue;
      }

      await this.app.vault.create(path, JSON.stringify(pack, null, 2));
      created += 1;
    }

    await this.loadQuestPacks();
    this.refreshViews();
    new Notice(`Demo quest packs created: ${created}, skipped: ${skipped}`);
  }

  async ensureVaultFolder(path: string) {
    const parts = path.split("/");
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;

      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  getProgress(): ProgressState {
    return this.settings.progress;
  }

  getAllQuests(): Quest[] {
    return this.questPacks.flatMap((pack) =>
      pack.chapters.flatMap((chapter) =>
        chapter.quests.map((quest) => ({
          ...quest,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          packId: pack.packId
        }))
      )
    );
  }

  async markTaskCompleted(quest: Quest, task: QuestTask) {
    const completedTasks = this.settings.progress.completedTasks;
    const alreadyDone = completedTasks[quest.id]?.includes(task.id);

    if (!alreadyDone) {
      completedTasks[quest.id] = unique([...(completedTasks[quest.id] ?? []), task.id]);
      this.removeTaskState(this.settings.progress.skippedTasks, quest.id, task.id);
      this.awardTaskXp(quest, task);
      await this.saveSettings();
    }

    this.refreshViews();
  }

  async answerSingleChoice(quest: Quest, task: SingleChoiceTask, optionId: string) {
    this.settings.progress.answers[`${quest.id}:${task.id}`] = optionId;

    if (optionId === task.answer) {
      await this.markTaskCompleted(quest, task);
      new Notice("Correct answer");
      return;
    }

    await this.saveSettings();
    this.refreshViews();
    new Notice("Try another answer");
  }

  async checkVaultTask(quest: Quest, task: QuestTask) {
    if (task.type === "note-exists") {
      if (await this.isVaultTaskComplete(quest, task)) {
        await this.markTaskCompleted(quest, task);
        new Notice("Task completed");
      } else {
        new Notice(`Note not found: ${this.getSelectedNotePath(quest.id, task)}`);
      }
      return;
    }

    if (task.type === "note-contains") {
      const path = this.getSelectedNotePath(quest.id, task);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        new Notice(`Note not found: ${path}`);
        return;
      }

      if (await this.isVaultTaskComplete(quest, task)) {
        await this.markTaskCompleted(quest, task);
        new Notice("Task completed");
      }
    }
  }

  async skipTask(quest: Quest, task: QuestTask) {
    if (isTaskCompleted(this.settings.progress, quest.id, task.id)) {
      return;
    }

    const skippedTasks = this.settings.progress.skippedTasks;
    skippedTasks[quest.id] = unique([...(skippedTasks[quest.id] ?? []), task.id]);
    await this.saveSettings();
    this.refreshViews();
  }

  async syncAutoCompletedTasks(quest?: Quest): Promise<boolean> {
    const allQuests = this.getAllQuests();
    const quests = quest ? [quest] : allQuests;
    let changed = false;

    for (const currentQuest of quests) {
      const unlocked = isQuestUnlocked(currentQuest, this.settings.progress.completedQuests, allQuests);
      if (!unlocked) {
        continue;
      }

      for (const task of currentQuest.tasks) {
        if (isTaskCompleted(this.settings.progress, currentQuest.id, task.id)) {
          continue;
        }

        if (await this.isVaultTaskComplete(currentQuest, task)) {
          this.markTaskCompletedInMemory(currentQuest, task);
          changed = true;
        }
      }
    }

    if (changed) {
      await this.saveSettings();
      this.refreshViews();
    }

    return changed;
  }

  private async isVaultTaskComplete(quest: Quest, task: QuestTask): Promise<boolean> {
    if (task.type === "note-exists") {
      return this.app.vault.getAbstractFileByPath(this.getSelectedNotePath(quest.id, task)) instanceof TFile;
    }

    if (task.type === "note-contains") {
      return this.app.vault.getAbstractFileByPath(this.getSelectedNotePath(quest.id, task)) instanceof TFile;
    }

    return false;
  }

  private markTaskCompletedInMemory(quest: Quest, task: QuestTask) {
    const completedTasks = this.settings.progress.completedTasks;
    completedTasks[quest.id] = unique([...(completedTasks[quest.id] ?? []), task.id]);
    this.removeTaskState(this.settings.progress.skippedTasks, quest.id, task.id);
    this.awardTaskXp(quest, task);
  }

  private awardTaskXp(quest: Quest, task: QuestTask) {
    const rewardedTasks = this.settings.progress.rewardedTasks;

    if (rewardedTasks[quest.id]?.includes(task.id)) {
      return;
    }

    const xp = this.getTaskXp(quest, task);
    this.settings.progress.xp += xp;
    rewardedTasks[quest.id] = unique([...(rewardedTasks[quest.id] ?? []), task.id]);
  }

  getTaskXp(quest: Quest, task: QuestTask): number {
    if (task.reward) {
      return task.reward.xp;
    }

    const questXp = quest.rewards?.xp ?? 0;
    return quest.tasks.length > 0 ? Math.floor(questXp / quest.tasks.length) : 0;
  }

  private removeTaskState(tasks: Record<string, string[]>, questId: string, taskId: string) {
    tasks[questId] = (tasks[questId] ?? []).filter((id) => id !== taskId);
  }

  getTaskKey(questId: string, taskId: string): string {
    return `${questId}:${taskId}`;
  }

  getSelectedNotePath(questId: string, task: QuestTask): string {
    if (task.type !== "note-exists" && task.type !== "note-contains") {
      return "";
    }

    return this.settings.progress.selectedNotes[this.getTaskKey(questId, task.id)] ?? task.path;
  }

  getChosenNotePath(questId: string, taskId: string): string {
    return this.settings.progress.selectedNotes[this.getTaskKey(questId, taskId)] ?? "";
  }

  async setSelectedNotePath(questId: string, taskId: string, path: string) {
    this.settings.progress.selectedNotes[this.getTaskKey(questId, taskId)] = path;
    await this.saveSettings();
    this.refreshViews();
  }

  getNodePosition(layoutKey: string): QuestNodePosition | undefined {
    return this.settings.nodePositions[layoutKey];
  }

  async setNodePosition(layoutKey: string, position: QuestNodePosition) {
    this.settings.nodePositions[layoutKey] = {
      x: Math.round(position.x),
      y: Math.round(position.y)
    };
    await this.saveSettings();
  }

  getPackBackground(packId: string): PackBackgroundSettings {
    return this.settings.packBackgrounds[packId] ?? { ...DEFAULT_PACK_BACKGROUND };
  }

  getPackTitle(pack: QuestPack): string {
    return this.settings.packTitleOverrides[pack.packId] ?? pack.title;
  }

  async setPackTitle(pack: QuestPack, title: string) {
    const normalized = title.trim();
    if (!normalized || normalized === pack.title) {
      delete this.settings.packTitleOverrides[pack.packId];
    } else {
      this.settings.packTitleOverrides[pack.packId] = normalized;
    }
    await this.saveSettings();
    this.refreshViews();
  }

  async setPackBackground(packId: string, background: PackBackgroundSettings) {
    this.settings.packBackgrounds[packId] = background;
    await this.saveSettings();
    this.refreshViews();
  }

  async resetNodePositions(scopePrefix: string) {
    for (const key of Object.keys(this.settings.nodePositions)) {
      if (key.startsWith(scopePrefix)) {
        delete this.settings.nodePositions[key];
      }
    }

    await this.saveSettings();
    this.refreshViews();
  }

  getTrackedNotePaths(): string[] {
    const folders = this.settings.trackedFolders.map((folder) => normalizeVaultPath(folder)).filter(Boolean);

    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => folders.length === 0 || folders.some((folder) => file.path === folder || file.path.startsWith(`${folder}/`)))
      .map((file) => file.path)
      .sort((a, b) => a.localeCompare(b));
  }

  async completeQuest(quest: Quest) {
    const progress = this.settings.progress;

    if (progress.completedQuests.includes(quest.id)) {
      return;
    }

    const completedTasks = progress.completedTasks[quest.id] ?? [];
    const skippedTasks = progress.skippedTasks[quest.id] ?? [];
    const allTasksDone = quest.tasks.every((task) => completedTasks.includes(task.id) || skippedTasks.includes(task.id));

    if (!allTasksDone) {
      new Notice("Complete all tasks first");
      return;
    }

    progress.completedQuests = unique([...progress.completedQuests, quest.id]);
    progress.streak = updateStreak(progress.streak, new Date());

    await this.saveSettings();
    await this.syncAutoCompletedTasks();
    this.refreshViews();
    new Notice("Quest complete");
  }

  async activateView() {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_LEARNING_QUESTS, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  refreshViews() {
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_LEARNING_QUESTS)
      .forEach((leaf) => {
        const view = leaf.view;
        if (view instanceof LearningQuestsView) {
          view.render();
        }
      });
  }
}

class LearningQuestsView extends ItemView {
  private activePackId?: string;
  private activeChapterByPack: Record<string, string> = {};
  private viewportStates: Record<string, CanvasViewportState> = {};
  private iconSvgCache: Record<string, string | null> = {};
  private pendingFrameByViewport: Record<string, number | null> = {};
  private overviewRefreshByViewport: Record<string, (() => void) | undefined> = {};
  private overviewRebuildByViewport: Record<string, (() => void) | undefined> = {};

  constructor(leaf: WorkspaceLeaf, private plugin: LearningQuestsPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_LEARNING_QUESTS;
  }

  getDisplayText(): string {
    return "Learning Quests";
  }

  getIcon(): string {
    return "trophy";
  }

  async onOpen() {
    await this.plugin.loadQuestPacks();
    this.registerDomEvent(document, "pointerdown", (event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      this.containerEl.querySelectorAll<HTMLDetailsElement>(".lq-popover-menu[open]").forEach((menu) => {
        if (!menu.contains(target)) {
          menu.open = false;
        }
      });
    }, true);
    this.render();
  }

  render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("learning-quests-view");

    const activePack = this.getActivePack();
    if (!activePack) {
      container.createDiv({ cls: "lq-empty", text: "No quest packs loaded." });
      return;
    }

    const activeChapterId = this.activeChapterByPack[activePack.packId] ?? activePack.chapters[0]?.id;
    this.activeChapterByPack[activePack.packId] = activeChapterId;
    const activeChapter = activePack.chapters.find((chapter) => chapter.id === activeChapterId) ?? activePack.chapters[0];

    if (!activeChapter) {
      container.createDiv({ cls: "lq-empty", text: "No branches in this quest pack." });
      return;
    }

    const overlay = container.createDiv({ cls: "lq-overlay" });
    const progress = this.plugin.getProgress();
    const header = overlay.createDiv({ cls: "lq-header" });
    this.renderPackSelector(header, activePack);
    this.renderActionsMenu(header, activePack, activeChapter.id);

    const branchTabs = overlay.createDiv({ cls: "lq-branch-tabs" });
    for (const chapter of activePack.chapters) {
      const tab = branchTabs.createEl("button", {
        cls: chapter.id === activeChapterId ? "is-active" : "",
        text: chapter.title
      });
      tab.onclick = () => {
        this.activeChapterByPack[activePack.packId] = chapter.id;
        this.render();
      };
    }

    this.renderStatsDock(container, progress, activePack);

    const canvasHost = container.createDiv({ cls: "lq-canvas-host" });
    try {
      const snapshot = this.renderQuestCanvas(
        canvasHost,
        `${activePack.packId}:${activeChapter.id}`,
        activeChapter.title,
        activeChapter.quests.map((quest) => ({
          ...quest,
          chapterId: activeChapter.id,
          chapterTitle: activeChapter.title,
          packId: activePack.packId
        })),
        this.plugin.getAllQuests(),
        this.plugin.getPackBackground(activePack.packId)
      );
      this.renderMapNavigator(container, snapshot);
    } catch (error) {
      console.error("Failed to render Learning Quests canvas", error);
      canvasHost.empty();
      canvasHost.createDiv({
        cls: "lq-render-error",
        text: "Failed to render quest map. Check the console for details."
      });
      new Notice("Learning Quests: failed to render quest map");
    }
  }

  private getActivePack(): QuestPack | undefined {
    const activePack = this.plugin.questPacks.find((pack) => pack.packId === this.activePackId);
    const fallbackPack = this.plugin.questPacks[0];
    this.activePackId = activePack?.packId ?? fallbackPack?.packId;

    return activePack ?? fallbackPack;
  }

  private renderPackSelector(parent: HTMLElement, activePack: QuestPack) {
    const selector = parent.createEl("details", { cls: "lq-pack-selector lq-popover-menu" });
    const summary = selector.createEl("summary", { attr: { "aria-label": "Choose quest pack" } });
    const icon = summary.createSpan({ cls: "lq-control-icon" });
    setIcon(icon, "library-big");
    summary.createEl("h2", { text: this.plugin.getPackTitle(activePack) });
    const chevron = summary.createSpan({ cls: "lq-control-chevron" });
    setIcon(chevron, "chevron-down");

    const menu = selector.createDiv({ cls: "lq-popover-content lq-pack-list" });
    for (const pack of this.plugin.questPacks) {
      const button = menu.createEl("button", {
        cls: pack.packId === activePack.packId ? "is-active" : ""
      });
      button.createSpan({ cls: "lq-pack-item-label", text: this.plugin.getPackTitle(pack) });
      button.onclick = () => {
        this.activePackId = pack.packId;
        selector.open = false;
        this.render();
      };
    }
  }

  private renderActionsMenu(parent: HTMLElement, activePack: QuestPack, activeChapterId: string) {
    const actions = parent.createEl("details", { cls: "lq-actions-menu lq-popover-menu" });
    const summary = actions.createEl("summary", {
      attr: { "aria-label": "Quest map actions", title: "Quest map actions" }
    });
    setIcon(summary, "menu");
    const menu = actions.createDiv({ cls: "lq-popover-content lq-actions-list" });
    const closeAndRun = (action: () => void) => {
      actions.open = false;
      action();
    };

    this.createMenuAction(menu, "Reload packs", "refresh-cw", () => {
      void this.plugin.loadQuestPacks().then(() => this.render());
    }, closeAndRun);
    this.createMenuAction(menu, "Center map", "locate-fixed", () => {
      this.resetViewport(`${activePack.packId}:${activeChapterId}`);
      this.render();
    }, closeAndRun);
    this.createMenuAction(menu, "Reset node positions", "rotate-ccw", () => {
      void this.plugin.resetNodePositions(`${activePack.packId}:${activeChapterId}:`);
    }, closeAndRun);
    this.createMenuAction(menu, "Map background", "palette", () => {
      new PackBackgroundModal(this.plugin, activePack).open();
    }, closeAndRun);
  }

  private createMenuAction(
    parent: HTMLElement,
    label: string,
    iconName: string,
    action: () => void,
    run: (action: () => void) => void
  ) {
    const button = parent.createEl("button");
    const icon = button.createSpan({ cls: "lq-menu-item-icon" });
    setIcon(icon, iconName);
    button.createSpan({ cls: "lq-menu-item-label", text: label });
    button.onclick = () => run(action);
  }

  private renderStatsDock(parent: Element, progress: ProgressState, activePack: QuestPack) {
    const dock = parent.createDiv({ cls: "lq-status-dock" });
    this.createStatusItem(dock, "XP", String(progress.xp), "sparkles");
    this.createStatusItem(
      dock,
      "Streak",
      String(progress.streak.current),
      "flame",
      isStreakActive(progress.streak, new Date()) ? "is-streak-active" : "is-streak-inactive"
    );
    this.createStatusItem(dock, "Best", String(progress.streak.best), "medal");
    const packQuests = activePack.chapters.flatMap((chapter) => chapter.quests);
    const completed = packQuests.filter((quest) => progress.completedQuests.includes(quest.id)).length;
    const percent = packQuests.length > 0 ? Math.round(completed / packQuests.length * 100) : 0;
    this.createStatusItem(dock, "Progress", `${percent}%`, "chart-no-axes-column-increasing");
  }

  private createStatusItem(parent: HTMLElement, label: string, value: string, iconName: string, stateClass = "") {
    const item = parent.createDiv({ cls: `lq-status-item ${stateClass}`.trim(), attr: { title: label } });
    const icon = item.createSpan({ cls: "lq-status-icon" });
    setIcon(icon, iconName);
    item.createSpan({ cls: "lq-status-value", text: value });
    item.createSpan({ cls: "lq-status-label", text: label });
  }

  private renderQuestCanvas(
    parent: HTMLElement,
    viewportKey: string,
    chapterTitle: string,
    quests: Quest[],
    allQuests: Quest[],
    background: PackBackgroundSettings
  ): QuestMapSnapshot {
    const positions = new Map<string, { x: number; y: number }>();
    const nodeWidth = NODE_WIDTH;
    const nodeHeight = NODE_HEIGHT;
    const gateWidth = GATE_WIDTH;
    const gateHeight = this.getGateNodeHeight(chapterTitle);
    const gapX = 244;
    const gapY = 204;

    quests.forEach((quest, index) => {
      const row = Math.floor(index / 4);
      const fallback = {
        x: 36 + (index % 4) * gapX,
        y: (row - 1) * gapY
      };
      positions.set(quest.id, this.plugin.getNodePosition(this.getNodeLayoutKey(viewportKey, quest.id)) ?? quest.position ?? fallback);
    });

    const gatePosition = {
      x: Math.min(...Array.from(positions.values()).map((position) => position.x), 0) - 320,
      y: 0
    };
    const boundsPositions = [...Array.from(positions.values()), gatePosition];
    const minX = Math.min(...boundsPositions.map((position) => position.x), 0);
    const maxX = Math.max(...Array.from(positions.values()).map((position) => position.x), 0);
    const minY = Math.min(...boundsPositions.map((position) => position.y), 0);
    const maxY = Math.max(...boundsPositions.map((position) => position.y), 0);
    const padding = 120;
    const worldOffset = {
      x: padding - minX,
      y: padding - minY
    };
    const worldWidth = maxX - minX + Math.max(nodeWidth, gateWidth) + padding * 2;
    const worldHeight = maxY - minY + Math.max(nodeHeight, gateHeight) + padding * 2;
    const viewport = parent.createDiv({ cls: "lq-canvas-viewport" });
    applyPackBackground(viewport, background);
    const canvas = viewport.createDiv({ cls: "lq-canvas" });
    canvas.style.width = `${worldWidth}px`;
    canvas.style.height = `${worldHeight}px`;
    canvas.style.setProperty("--lq-axis-y", `${worldOffset.y + nodeHeight / 2}px`);

    this.applyViewportState(viewportKey, canvas, viewport);
    this.registerCanvasNavigation(viewport, canvas, viewportKey);
    this.renderGateNode(canvas, chapterTitle, {
      x: gatePosition.x + worldOffset.x,
      y: gatePosition.y + worldOffset.y
    });

    const svg = canvas.createSvg("svg", { cls: "lq-links" });
    svg.setAttr("width", "100%");
    svg.setAttr("height", "100%");
    this.renderArrowMarkers(svg);
    const canvasPositions = new Map<string, QuestNodePosition>();
    const nodeMetrics = new Map<string, { width: number; height: number }>();
    for (const quest of quests) {
      const position = positions.get(quest.id);
      if (!position) {
        continue;
      }

      canvasPositions.set(quest.id, {
        x: position.x + worldOffset.x,
        y: position.y + worldOffset.y
      });
      nodeMetrics.set(quest.id, this.getQuestNodeMetrics(quest, nodeWidth, nodeHeight, gateWidth, gateHeight));
    }

    const links: CanvasNodeLink[] = [];
    this.renderGateLinks(svg, canvasPositions, {
      x: gatePosition.x + worldOffset.x,
      y: gatePosition.y + worldOffset.y
    }, nodeHeight, gateWidth, gateHeight, quests, links);

    for (const quest of quests) {
      const to = canvasPositions.get(quest.id);
      if (!to) {
        continue;
      }

      const progress = this.plugin.getProgress();
      const toCompleted = progress.completedQuests.includes(quest.id);
      const toUnlocked = isQuestUnlocked(quest, progress.completedQuests, allQuests);
      const linkState = toCompleted ? "is-completed" : toUnlocked ? "is-available" : "is-locked";

      for (const requiredId of quest.requires ?? []) {
        const from = canvasPositions.get(requiredId);
        const fromQuest = quests.find((candidate) => candidate.id === requiredId);
        if (!from || !fromQuest) {
          continue;
        }

        const fromMetrics = nodeMetrics.get(requiredId) ?? this.getQuestNodeMetrics(fromQuest, nodeWidth, nodeHeight, gateWidth, gateHeight);
        const toMetrics = nodeMetrics.get(quest.id) ?? this.getQuestNodeMetrics(quest, nodeWidth, nodeHeight, gateWidth, gateHeight);
        const line = svg.createSvg("line", { cls: "lq-link" });
        line.addClass(linkState);
        this.positionLinkLine(line, { position: from, metrics: fromMetrics }, { position: to, metrics: toMetrics });
        line.setAttr("marker-end", `url(#lq-arrow-${linkState.replace("is-", "")})`);
        links.push({ line, fromId: requiredId, toId: quest.id });
      }
    }

    const dragContext: NodeDragContext = {
      viewport,
      canvas,
      viewportKey,
      worldOffset,
      canvasPositions,
      nodeMetrics,
      links,
      canvasWidth: worldWidth,
      canvasHeight: worldHeight
    };

    for (const quest of quests) {
      const position = canvasPositions.get(quest.id);
      if (!position) {
        continue;
      }

      this.renderQuestNode(canvas, quest, allQuests, position, dragContext);
    }

    return {
      viewportKey,
      chapterTitle,
      quests,
      allQuests,
      positions: canvasPositions,
      nodeMetrics,
      gatePosition: {
        x: gatePosition.x + worldOffset.x,
        y: gatePosition.y + worldOffset.y
      },
      gateMetrics: { width: gateWidth, height: gateHeight },
      worldWidth,
      worldHeight,
      viewport,
      background
    };
  }

  private renderMapNavigator(parent: Element, snapshot: QuestMapSnapshot) {
    const button = parent.createEl("button", {
      cls: "lq-map-navigator",
      attr: {
        "aria-label": "Open full quest map",
        title: "Open full quest map"
      }
    });
    const preview = button.createDiv({ cls: "lq-map-navigator-preview" });
    applyPackBackground(preview, snapshot.background);
    let focus: SVGRectElement | undefined;

    const refresh = () => {
      if (!button.isConnected) {
        return;
      }

      const state = this.getViewportState(snapshot.viewportKey);
      if (focus) {
        updateQuestMapFocus(focus, snapshot, state);
      }
    };

    const rebuild = () => {
      preview.empty();
      focus = renderQuestMapOverview(this.plugin, preview, snapshot, this.getViewportState(snapshot.viewportKey));
      refresh();
    };

    this.overviewRefreshByViewport[snapshot.viewportKey] = refresh;
    this.overviewRebuildByViewport[snapshot.viewportKey] = rebuild;
    rebuild();
    button.onclick = () => new QuestMapOverviewModal(this.plugin, snapshot).open();
  }

  private renderGateLinks(
    svg: SVGElement,
    positions: Map<string, QuestNodePosition>,
    gatePosition: QuestNodePosition,
    nodeHeight: number,
    gateWidth: number,
    gateHeight: number,
    quests: Quest[],
    links: CanvasNodeLink[]
  ) {
    const roots = quests.filter((quest) => (quest.requires ?? []).length === 0);

    for (const quest of roots) {
      const position = positions.get(quest.id);
      if (!position) {
        continue;
      }

      const line = svg.createSvg("line", { cls: "lq-link" });
      line.addClass("is-gate");
      const targetMetrics = this.getQuestNodeMetrics(quest, NODE_WIDTH, nodeHeight, gateWidth, gateHeight);
      const fromEndpoint = {
        position: gatePosition,
        metrics: { width: gateWidth, height: gateHeight }
      };
      this.positionLinkLine(line, fromEndpoint, { position, metrics: targetMetrics });
      line.setAttr("marker-end", "url(#lq-arrow-gate)");
      links.push({ line, staticFrom: fromEndpoint, toId: quest.id });
    }
  }


  private getQuestNodeMetrics(
    quest: Quest,
    nodeWidth: number,
    nodeHeight: number,
    gateWidth: number,
    gateHeight: number
  ): { width: number; height: number } {
    return isGateQuest(quest)
      ? { width: gateWidth, height: this.getGateNodeHeight(quest.title) }
      : { width: nodeWidth, height: nodeHeight };
  }

  private getGateNodeHeight(title: string): number {
    const extraLines = Math.max(0, Math.ceil(title.length / 22) - 1);
    return GATE_MIN_HEIGHT + extraLines * 22;
  }

  private applyGateLayout(gate: HTMLElement, title?: string) {
    gate.style.width = `${GATE_WIDTH}px`;
    gate.style.minHeight = `${this.getGateNodeHeight(title ?? "") || GATE_MIN_HEIGHT}px`;
    gate.style.height = "auto";
    gate.style.boxSizing = "border-box";
    gate.style.padding = "14px 16px";
    gate.style.display = "flex";
    gate.style.flexDirection = "column";
    gate.style.alignItems = "center";
    gate.style.justifyContent = "center";
    gate.style.gap = "4px";
    gate.style.overflow = "visible";
    gate.style.whiteSpace = "normal";
  }

  private styleGateTitle(titleEl: HTMLElement) {
    titleEl.style.maxWidth = "100%";
    titleEl.style.whiteSpace = "normal";
    titleEl.style.overflow = "visible";
    titleEl.style.textOverflow = "unset";
    titleEl.style.overflowWrap = "anywhere";
    titleEl.style.wordBreak = "normal";
    titleEl.style.lineHeight = "1.18";
    titleEl.style.textAlign = "center";
  }

  private renderGateNode(parent: HTMLElement, title: string, position: { x: number; y: number }) {
    const gate = parent.createDiv({ cls: "lq-gate-node is-virtual-gate" });
    gate.style.left = `${position.x}px`;
    gate.style.top = `${position.y}px`;
    this.applyGateLayout(gate, title);
    this.renderIcon(gate, "mdi:map-marker-path", "lq-gate-icon");
    gate.createDiv({ cls: "lq-gate-label", text: "Gate" });
    const titleEl = gate.createDiv({ cls: "lq-gate-title", text: title });
    this.styleGateTitle(titleEl);
  }

  private renderArrowMarkers(svg: SVGElement) {
    const defs = createSvgElement("defs");
    svg.appendChild(defs);
    const markers = [
      { id: "lq-arrow-locked", cls: "is-locked" },
      { id: "lq-arrow-available", cls: "is-available" },
      { id: "lq-arrow-completed", cls: "is-completed" },
      { id: "lq-arrow-gate", cls: "is-gate" }
    ];

    for (const markerConfig of markers) {
      const marker = createSvgElement("marker");
      marker.addClass("lq-arrow");
      marker.addClass(markerConfig.cls);
      marker.setAttribute("id", markerConfig.id);
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "9");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "7");
      marker.setAttribute("markerHeight", "7");
      marker.setAttribute("orient", "auto-start-reverse");

      const path = createSvgElement("path");
      path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
      marker.appendChild(path);
      defs.appendChild(marker);
    }
  }

  private registerCanvasNavigation(viewport: HTMLElement, canvas: HTMLElement, viewportKey: string) {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    viewport.onwheel = (event) => {
      event.preventDefault();

      const state = this.getViewportState(viewportKey);
      const rect = viewport.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const worldX = (pointerX - state.x) / state.scale;
      const worldY = (pointerY - state.y) / state.scale;
      const nextScale = clamp(state.scale * (event.deltaY < 0 ? 1.1 : 0.9), 0.2, 2.4);

      state.x = pointerX - worldX * nextScale;
      state.y = pointerY - worldY * nextScale;
      state.scale = nextScale;

      this.scheduleViewportTransform(viewportKey, canvas, viewport);
    };

    viewport.onpointerdown = (event) => {
      if (event.button !== 0) {
        return;
      }

      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      viewport.setPointerCapture(event.pointerId);
      viewport.addClass("is-panning");
    };

    viewport.onpointermove = (event) => {
      if (!dragging) {
        return;
      }

      const state = this.getViewportState(viewportKey);
      state.x += event.clientX - lastX;
      state.y += event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;

      this.scheduleViewportTransform(viewportKey, canvas, viewport);
    };

    viewport.onpointerup = (event) => {
      dragging = false;
      viewport.releasePointerCapture(event.pointerId);
      viewport.removeClass("is-panning");
    };

    viewport.onpointercancel = () => {
      dragging = false;
      viewport.removeClass("is-panning");
    };
  }

  private scheduleViewportTransform(viewportKey: string, canvas: HTMLElement, viewport?: HTMLElement) {
    if (this.pendingFrameByViewport[viewportKey] !== null && this.pendingFrameByViewport[viewportKey] !== undefined) {
      return;
    }

    this.pendingFrameByViewport[viewportKey] = requestAnimationFrame(() => {
      this.pendingFrameByViewport[viewportKey] = null;
      this.applyViewportState(viewportKey, canvas, viewport);
    });
  }

  private applyViewportState(viewportKey: string, canvas: HTMLElement, viewport?: HTMLElement) {
    const state = this.getViewportState(viewportKey);
    if (!state.initialized && viewport) {
      state.x = viewport.clientWidth / 2 - canvas.clientWidth / 2;
      state.y = viewport.clientHeight / 2 - canvas.clientHeight / 2;
      state.initialized = true;
    }

    canvas.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
    this.overviewRefreshByViewport[viewportKey]?.();
  }

  private getViewportState(viewportKey: string): CanvasViewportState {
    this.viewportStates[viewportKey] ??= {
      x: 24,
      y: 0,
      scale: 1,
      initialized: false
    };

    return this.viewportStates[viewportKey];
  }

  private resetViewport(viewportKey: string) {
    delete this.viewportStates[viewportKey];
  }

  private renderQuestNode(
    parent: HTMLElement,
    quest: Quest,
    allQuests: Quest[],
    position: QuestNodePosition,
    dragContext: NodeDragContext
  ) {
    const progress = this.plugin.getProgress();
    const completed = progress.completedQuests.includes(quest.id);
    const unlocked = isQuestUnlocked(quest, progress.completedQuests, allQuests);
    const completedTasks = progress.completedTasks[quest.id] ?? [];
    const skippedTasks = progress.skippedTasks[quest.id] ?? [];
    const possibleXp = quest.tasks.reduce((sum, task) => sum + this.plugin.getTaskXp(quest, task), 0);
    const gate = isGateQuest(quest);

    const node = parent.createEl("button", {
      cls: [
        gate ? "lq-gate-node" : "lq-node",
        gate ? "is-progress-gate" : "",
        completed ? "is-completed" : "",
        !completed && unlocked ? "is-available" : "",
        unlocked ? "is-unlocked" : "is-locked"
      ].filter(Boolean).join(" ")
    });
    node.style.left = "0";
    node.style.top = "0";
    node.style.transform = `translate(${position.x}px, ${position.y}px)`;
    if (gate) {
      this.applyGateLayout(node, quest.title);
    }
    node.disabled = false;
    this.registerNodeDrag(node, quest, dragContext);
    node.onclick = () => {
      if (node.hasClass("is-drag-suppressed")) {
        node.removeClass("is-drag-suppressed");
        return;
      }

      new QuestDetailsModal(this.plugin, quest, allQuests).open();
    };

    if (quest.icon) {
      this.renderIcon(node, quest.icon, gate ? "lq-gate-icon" : "lq-node-icon");
    }

    if (gate) {
      node.createDiv({ cls: "lq-gate-label", text: "Gate" });
      const titleEl = node.createDiv({ cls: "lq-gate-title", text: quest.title });
      this.styleGateTitle(titleEl);
      const meta = node.createDiv({ cls: "lq-gate-meta" });
      meta.createSpan({ cls: "lq-node-badge", text: `${completedTasks.length + skippedTasks.length}/${quest.tasks.length}` });
      const xpBadge = meta.createSpan({ cls: "lq-node-badge", text: `${possibleXp} XP` });
      xpBadge.addClass("lq-node-xp");
      return;
    }

    node.createSpan({ cls: "lq-node-title", text: quest.title });
    const meta = node.createSpan({ cls: "lq-node-meta" });
    meta.createSpan({
      cls: "lq-node-badge",
      text: `${completedTasks.length + skippedTasks.length}/${quest.tasks.length}`
    });
    const xpBadge = meta.createSpan({
      cls: "lq-node-badge",
      text: `${possibleXp} XP`
    });
    xpBadge.addClass("lq-node-xp");
  }

  private registerNodeDrag(node: HTMLElement, quest: Quest, context: NodeDragContext) {
    let pointerId: number | null = null;
    let activationTimer: number | null = null;
    let dragReady = false;
    let panningInstead = false;
    let startClientX = 0;
    let startClientY = 0;
    let lastClientX = 0;
    let lastClientY = 0;
    let startX = 0;
    let startY = 0;
    let nextX = 0;
    let nextY = 0;
    let moved = false;
    let pendingFrame: number | null = null;
    const dragThreshold = 4;
    const panThreshold = 6;
    const dragActivationDelay = 250;

    const clearActivation = () => {
      if (activationTimer !== null) {
        window.clearTimeout(activationTimer);
        activationTimer = null;
      }
      dragReady = false;
      node.removeClass("is-drag-ready");
      context.viewport.removeClass("is-node-drag-ready");
    };

    const panViewport = (event: PointerEvent) => {
      const state = this.getViewportState(context.viewportKey);
      state.x += event.clientX - lastClientX;
      state.y += event.clientY - lastClientY;
      lastClientX = event.clientX;
      lastClientY = event.clientY;
      this.scheduleViewportTransform(context.viewportKey, context.canvas, context.viewport);
    };

    const applyDragFrame = () => {
      pendingFrame = null;
      const metrics = context.nodeMetrics.get(quest.id) ?? this.getQuestNodeMetrics(quest, NODE_WIDTH, NODE_HEIGHT, GATE_WIDTH, GATE_MIN_HEIGHT);
      const clampedX = clamp(nextX, 0, Math.max(0, context.canvasWidth - metrics.width));
      const clampedY = clamp(nextY, 0, Math.max(0, context.canvasHeight - metrics.height));
      nextX = clampedX;
      nextY = clampedY;

      context.canvasPositions.set(quest.id, { x: clampedX, y: clampedY });
      node.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
      this.updateNodeLinks(quest.id, context);
    };

    const scheduleDragFrame = () => {
      if (pendingFrame !== null) {
        return;
      }

      pendingFrame = requestAnimationFrame(applyDragFrame);
    };

    node.onpointerdown = (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      pointerId = event.pointerId;
      startClientX = event.clientX;
      startClientY = event.clientY;
      lastClientX = event.clientX;
      lastClientY = event.clientY;
      const currentPosition = context.canvasPositions.get(quest.id) ?? { x: 0, y: 0 };
      startX = currentPosition.x;
      startY = currentPosition.y;
      nextX = startX;
      nextY = startY;
      moved = false;
      dragReady = false;
      panningInstead = false;
      node.setPointerCapture(event.pointerId);
      activationTimer = window.setTimeout(() => {
        activationTimer = null;
        if (pointerId !== event.pointerId || panningInstead) {
          return;
        }

        dragReady = true;
        node.addClass("is-drag-ready");
        context.viewport.addClass("is-node-drag-ready");
      }, dragActivationDelay);
    };

    node.onpointermove = (event) => {
      if (pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const screenDistance = Math.hypot(event.clientX - startClientX, event.clientY - startClientY);

      if (!dragReady) {
        if (!panningInstead && screenDistance >= panThreshold) {
          clearActivation();
          panningInstead = true;
          node.addClass("is-pan-through");
          context.viewport.addClass("is-panning");
        }

        if (panningInstead) {
          panViewport(event);
        }
        return;
      }

      const state = this.getViewportState(context.viewportKey);
      const deltaX = (event.clientX - startClientX) / state.scale;
      const deltaY = (event.clientY - startClientY) / state.scale;

      if (!moved && Math.hypot(deltaX, deltaY) < dragThreshold) {
        return;
      }

      moved = true;
      node.addClass("is-dragging");
      context.viewport.addClass("is-dragging-node");
      nextX = startX + deltaX;
      nextY = startY + deltaY;
      scheduleDragFrame();
    };

    const finishDrag = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      pointerId = null;
      if (node.hasPointerCapture(event.pointerId)) {
        node.releasePointerCapture(event.pointerId);
      }
      clearActivation();
      node.removeClass("is-dragging");
      node.removeClass("is-pan-through");
      context.viewport.removeClass("is-dragging-node");
      context.viewport.removeClass("is-panning");

      if (panningInstead) {
        node.addClass("is-drag-suppressed");
        panningInstead = false;
        return;
      }

      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame);
        applyDragFrame();
      }

      if (!moved) {
        return;
      }

      node.addClass("is-drag-suppressed");
      const savedPosition = context.canvasPositions.get(quest.id) ?? { x: nextX, y: nextY };
      void this.plugin.setNodePosition(this.getNodeLayoutKey(context.viewportKey, quest.id), {
        x: savedPosition.x - context.worldOffset.x,
        y: savedPosition.y - context.worldOffset.y
      });
      this.overviewRebuildByViewport[context.viewportKey]?.();
    };

    node.onpointerup = finishDrag;
    node.onpointercancel = (event) => {
      if (pointerId !== event.pointerId) {
        return;
      }

      pointerId = null;
      clearActivation();
      node.removeClass("is-dragging");
      node.removeClass("is-pan-through");
      context.viewport.removeClass("is-dragging-node");
      context.viewport.removeClass("is-panning");
      panningInstead = false;
      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame);
        pendingFrame = null;
      }
    };
  }

  private updateNodeLinks(questId: string, context: NodeDragContext) {
    for (const link of context.links) {
      if (link.fromId !== questId && link.toId !== questId) {
        continue;
      }

      const fromEndpoint = link.fromId
        ? this.getNodeEndpoint(link.fromId, context)
        : link.staticFrom;
      const toEndpoint = this.getNodeEndpoint(link.toId, context);

      if (fromEndpoint && toEndpoint) {
        this.positionLinkLine(link.line, fromEndpoint, toEndpoint);
      }
    }
  }

  private getNodeEndpoint(nodeId: string, context: NodeDragContext): CanvasLinkEndpoint | undefined {
    const position = context.canvasPositions.get(nodeId);
    const metrics = context.nodeMetrics.get(nodeId);
    if (!position || !metrics) {
      return undefined;
    }

    return { position, metrics };
  }

  private positionLinkLine(line: SVGLineElement, from: CanvasLinkEndpoint, to: CanvasLinkEndpoint) {
    const fromPoint = this.getNearestRectBoundaryPoint(from, this.getRectCenter(to));
    const toPoint = this.getNearestRectBoundaryPoint(to, this.getRectCenter(from));

    line.setAttr("x1", String(fromPoint.x));
    line.setAttr("y1", String(fromPoint.y));
    line.setAttr("x2", String(toPoint.x));
    line.setAttr("y2", String(toPoint.y));
  }

  private getNearestRectBoundaryPoint(rect: CanvasLinkEndpoint, targetCenter: QuestNodePosition): QuestNodePosition {
    const center = this.getRectCenter(rect);
    const halfWidth = rect.metrics.width / 2;
    const halfHeight = rect.metrics.height / 2;
    const dx = targetCenter.x - center.x;
    const dy = targetCenter.y - center.y;

    if (dx === 0 && dy === 0) {
      return { x: center.x + halfWidth, y: center.y };
    }

    const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx);
    const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy);
    const scale = Math.min(scaleX, scaleY);

    return {
      x: center.x + dx * scale,
      y: center.y + dy * scale
    };
  }

  private getRectCenter(rect: CanvasLinkEndpoint): QuestNodePosition {
    return {
      x: rect.position.x + rect.metrics.width / 2,
      y: rect.position.y + rect.metrics.height / 2
    };
  }

  private getNodeLayoutKey(viewportKey: string, questId: string): string {
    return `${viewportKey}:${questId}`;
  }

  private renderIcon(parent: HTMLElement, iconName: string, className: string) {
    const icon = parent.createSpan({ cls: className });
    icon.addClass("lq-iconify-inline");
    icon.setAttr("aria-hidden", "true");

    const iconSize = className === "lq-gate-icon" ? GATE_ICON_SIZE : NODE_ICON_SIZE;
    icon.style.width = `${iconSize}px`;
    icon.style.height = `${iconSize}px`;
    icon.style.maxWidth = `${iconSize}px`;
    icon.style.maxHeight = `${iconSize}px`;
    icon.style.minWidth = `${iconSize}px`;
    icon.style.minHeight = `${iconSize}px`;
    icon.style.display = "inline-flex";
    icon.style.flex = `0 0 ${iconSize}px`;
    icon.style.alignItems = "center";
    icon.style.justifyContent = "center";
    icon.style.lineHeight = "1";
    icon.style.marginBottom = className === "lq-gate-icon" ? "6px" : "8px";

    void this.loadIconSvg(iconName).then((svg) => {
      if (!icon.isConnected) {
        return;
      }

      if (!svg) {
        icon.remove();
        return;
      }

      svg.style.display = "block";
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.maxWidth = "100%";
      svg.style.maxHeight = "100%";
      icon.empty();
      icon.appendChild(svg);
    });
  }

  private async loadIconSvg(iconName: string): Promise<SVGSVGElement | null> {
    const url = getIconifySvgUrl(iconName);
    if (!url) {
      return null;
    }

    if (!(iconName in this.iconSvgCache)) {
      try {
        const response = await requestUrl({ url, method: "GET" });
        const text = response.text;

        if (response.status < 200 || response.status >= 300 || !text.includes("<svg")) {
          this.iconSvgCache[iconName] = null;
        } else {
          this.iconSvgCache[iconName] = text;
        }
      } catch (error) {
        console.warn(`Learning Quests: failed to load icon ${iconName}`, error);
        this.iconSvgCache[iconName] = null;
      }
    }

    const rawSvg = this.iconSvgCache[iconName];
    if (!rawSvg) {
      return null;
    }

    const documentSvg = new DOMParser().parseFromString(rawSvg, "image/svg+xml");
    const svg = documentSvg.documentElement;
    if (svg.tagName.toLowerCase() !== "svg") {
      return null;
    }

    svg.querySelectorAll("script, style").forEach((element) => element.remove());
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");

    return svg as unknown as SVGSVGElement;
  }

}

class QuestMapOverviewModal extends Modal {
  constructor(
    private plugin: LearningQuestsPlugin,
    private snapshot: QuestMapSnapshot
  ) {
    super(plugin.app);
  }

  onOpen() {
    this.modalEl.addClass("lq-map-overview-modal");
    this.contentEl.empty();
    const header = this.contentEl.createDiv({ cls: "lq-map-overview-header" });
    header.createEl("h2", { text: this.snapshot.chapterTitle });
    const overview = this.contentEl.createDiv({ cls: "lq-map-overview-full" });
    applyPackBackground(overview, this.snapshot.background);
    renderQuestMapOverview(this.plugin, overview, this.snapshot);
  }
}

class QuestDetailsModal extends Modal {
  private markdownComponent = new Component();

  constructor(
    private plugin: LearningQuestsPlugin,
    private quest: Quest,
    private allQuests: Quest[]
  ) {
    super(plugin.app);
  }

  onOpen() {
    this.markdownComponent.load();
    void this.plugin.syncAutoCompletedTasks(this.quest).then(() => this.renderContent());
  }

  onClose() {
    this.markdownComponent.unload();
  }

  renderContent() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lq-modal", "lq-quest-modal");

    const progress = this.plugin.getProgress();
    const completed = progress.completedQuests.includes(this.quest.id);
    const unlocked = isQuestUnlocked(this.quest, progress.completedQuests, this.allQuests);
    const completedTasks = progress.completedTasks[this.quest.id] ?? [];
    const skippedTasks = progress.skippedTasks[this.quest.id] ?? [];
    const allTasksDone = this.quest.tasks.every((task) => completedTasks.includes(task.id) || skippedTasks.includes(task.id));
    const canComplete = unlocked && !completed && allTasksDone;
    const possibleXp = this.quest.tasks.reduce((sum, task) => sum + this.plugin.getTaskXp(this.quest, task), 0);

    const header = contentEl.createDiv({ cls: "lq-modal-header" });
    header.createEl("h2", { text: this.quest.title });

    const summary = contentEl.createDiv({ cls: "lq-quest-summary" });
    summary.createDiv({ cls: "lq-description", text: this.quest.description ?? "" });
    summary.createSpan({ cls: "lq-xp", text: `${possibleXp} XP` });

    const tasksEl = contentEl.createDiv({ cls: "lq-tasks" });
    for (const task of this.quest.tasks) {
      this.renderTask(tasksEl, task, unlocked);
    }

    const footer = contentEl.createDiv({ cls: "lq-quest-footer" });
    footer.createSpan({
      cls: "lq-progress",
      text: `${completedTasks.length}/${this.quest.tasks.length} done, ${skippedTasks.length} skipped`
    });

    const footerActions = footer.createDiv({ cls: "lq-quest-footer-actions" });
    if (!completed && !canComplete) {
      const missing = (this.quest.requires ?? []).filter((id) => !progress.completedQuests.includes(id));
      const explanation = !unlocked
        ? `Complete prerequisites: ${missing.join(", ")}`
        : "Complete or skip every task first.";
      const info = footerActions.createSpan({
        cls: "lq-complete-info",
        attr: { tabindex: "0", "aria-label": explanation, "data-tooltip": explanation }
      });
      setIcon(info, "info");
    }

    const completeButton = footerActions.createEl("button", {
      cls: `lq-complete-quest ${canComplete ? "mod-cta" : ""}`.trim(),
      text: completed ? "Completed" : "Complete quest"
    });
    completeButton.disabled = !canComplete;
    completeButton.onclick = () => {
      void this.plugin.completeQuest(this.quest).then(() => this.renderContent());
    };
  }

  private renderTask(parent: HTMLElement, task: QuestTask, canInteract: boolean) {
    const done = isTaskCompleted(this.plugin.getProgress(), this.quest.id, task.id);
    const skipped = isTaskSkipped(this.plugin.getProgress(), this.quest.id, task.id);
    const taskEl = parent.createDiv({ cls: `lq-task ${done ? "is-done" : ""} ${skipped ? "is-skipped" : ""}` });

    const heading = taskEl.createDiv({ cls: "lq-task-heading" });
    if (done) {
      const doneIcon = heading.createSpan({
        cls: "lq-task-status lq-task-done-icon",
        attr: { "aria-label": "Done", title: "Done" }
      });
      setIcon(doneIcon, "square-check");
    } else if (skipped) {
      heading.createSpan({ cls: "lq-task-status", text: "Skipped" });
    }
    const taskDescription = heading.createDiv({ cls: "lq-task-description" });
    heading.createSpan({ cls: "lq-task-reward", text: `${this.plugin.getTaskXp(this.quest, task)} XP` });

    if (task.type === "markdown") {
      taskDescription.addClass("lq-task-content", "markdown-rendered");
      const sourcePath = this.plugin.app.workspace.getActiveFile()?.path ?? "";
      void MarkdownRenderer.render(this.plugin.app, task.content, taskDescription, sourcePath, this.markdownComponent).catch((error) => {
        console.error("Learning Quests: failed to render Markdown task", error);
        taskDescription.setText(task.content);
      });
      const button = taskEl.createEl("button", { cls: "lq-task-primary", text: done ? "Read" : "Mark read" });
      button.disabled = !canInteract || done || skipped;
      button.onclick = () => {
        void this.plugin.markTaskCompleted(this.quest, task).then(() => this.renderContent());
      };
      this.renderSkipButton(taskEl, task, canInteract, done, skipped);
      return;
    }

    taskDescription.addClass("lq-task-prompt");
    taskDescription.setText(task.prompt);

    if (task.type === "single-choice") {
      const options = taskEl.createDiv({ cls: "lq-options" });
      const selected = this.plugin.getProgress().answers[`${this.quest.id}:${task.id}`];

      for (const option of task.options) {
        const isCorrect = done && option.id === task.answer;
        const isWrongSelected = selected === option.id && selected !== task.answer;
        const button = options.createEl("button", {
          cls: [
            selected === option.id ? "is-selected" : "",
            isCorrect ? "is-correct" : "",
            isWrongSelected ? "is-wrong" : ""
          ].join(" "),
          text: option.text
        });
        button.disabled = !canInteract || done || skipped;
        button.onclick = () => {
          void this.plugin.answerSingleChoice(this.quest, task, option.id).then(() => this.renderContent());
        };
      }
      this.renderSkipButton(taskEl, task, canInteract, done, skipped);
      return;
    }

    if (task.type === "note-exists" || task.type === "note-contains") {
      this.renderNotePicker(taskEl, task, canInteract && !done && !skipped);
      const button = taskEl.createEl("button", { cls: "lq-task-primary", text: done ? "Checked" : "Check" });
      button.disabled = !canInteract || done || skipped;
      button.onclick = () => {
        void this.plugin.checkVaultTask(this.quest, task).then(() => this.renderContent());
      };
      this.renderSkipButton(taskEl, task, canInteract, done, skipped);
    }
  }

  private renderNotePicker(parent: HTMLElement, task: QuestTask, enabled: boolean) {
    if (task.type !== "note-exists" && task.type !== "note-contains") {
      return;
    }

    const wrapper = parent.createDiv({ cls: "lq-note-picker" });
    wrapper.createSpan({ cls: "lq-note-label", text: "Note" });

    const selectedPath = this.plugin.getChosenNotePath(this.quest.id, task.id);
    const selectButton = wrapper.createEl("button", {
      cls: "lq-note-select",
      text: selectedPath ? getNoteBasename(selectedPath) : "Select a note"
    });
    selectButton.disabled = !enabled;
    selectButton.onclick = () => {
      new NotePickerSuggestModal(this.plugin, selectedPath, async (path) => {
        await this.plugin.setSelectedNotePath(this.quest.id, task.id, path);
        this.renderContent();
      }).open();
    };
  }

  private renderSkipButton(parent: HTMLElement, task: QuestTask, canInteract: boolean, done: boolean, skipped: boolean) {
    const skipButton = parent.createEl("button", { cls: "lq-skip-button", text: skipped ? "Skipped" : "Skip" });
    skipButton.disabled = !canInteract || done || skipped;
    skipButton.onclick = () => {
      void this.plugin.skipTask(this.quest, task).then(() => this.renderContent());
    };
  }
}

class NotePickerSuggestModal extends SuggestModal<TFile> {
  constructor(
    private plugin: LearningQuestsPlugin,
    private selectedPath: string,
    private onChoosePath: (path: string) => void | Promise<void>
  ) {
    super(plugin.app);
    this.setPlaceholder("Search all notes...");
  }

  getSuggestions(query: string): TFile[] {
    const normalizedQuery = query.trim().toLowerCase();
    return this.plugin.app.vault
      .getMarkdownFiles()
      .filter((file) => {
        if (!normalizedQuery) {
          return true;
        }

        return file.path.toLowerCase().includes(normalizedQuery) || file.basename.toLowerCase().includes(normalizedQuery);
      })
      .sort((a, b) => {
        if (a.path === this.selectedPath) {
          return -1;
        }
        if (b.path === this.selectedPath) {
          return 1;
        }
        return a.path.localeCompare(b.path);
      })
      .slice(0, 50);
  }

  renderSuggestion(file: TFile, el: HTMLElement) {
    el.createDiv({ cls: "lq-note-suggest-title", text: file.basename });
    el.createDiv({ cls: "lq-note-suggest-path", text: file.path });
  }

  onChooseSuggestion(file: TFile) {
    void this.onChoosePath(file.path);
  }
}

class PackBackgroundModal extends Modal {
  constructor(private plugin: LearningQuestsPlugin, private pack: QuestPack) {
    super(plugin.app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lq-modal", "lq-background-modal");
    contentEl.createEl("h2", { text: "Map background" });
    contentEl.createDiv({ cls: "lq-description", text: this.plugin.getPackTitle(this.pack) });

    const current = this.plugin.getPackBackground(this.pack.packId);
    const modeRow = contentEl.createDiv({ cls: "lq-background-control" });
    modeRow.createEl("label", { text: "Style" });
    const mode = modeRow.createEl("select");
    mode.createEl("option", { value: "none", text: "No pattern" });
    mode.createEl("option", { value: "grid", text: "Grid" });
    mode.createEl("option", { value: "dots", text: "Dot grid" });
    mode.createEl("option", { value: "gradient", text: "Gradient" });
    mode.value = current.mode;

    const colors = contentEl.createDiv({ cls: "lq-background-colors" });
    const startInput = this.createColorInput(colors, "Start", current.gradientStart);
    const endInput = this.createColorInput(colors, "End", current.gradientEnd);
    const preview = contentEl.createDiv({ cls: "lq-background-preview" });

    const updatePreview = () => {
      const previewBackground: PackBackgroundSettings = {
        mode: isPackBackgroundMode(mode.value) ? mode.value : "grid",
        gradientStart: colorControlToRgba(startInput),
        gradientEnd: colorControlToRgba(endInput)
      };
      colors.toggleClass("is-hidden", previewBackground.mode !== "gradient");
      startInput.alphaValue.setText(`${Math.round(Number(startInput.alpha.value) * 100)}%`);
      endInput.alphaValue.setText(`${Math.round(Number(endInput.alpha.value) * 100)}%`);
      applyPackBackground(preview, previewBackground);
    };

    mode.onchange = updatePreview;
    startInput.color.oninput = updatePreview;
    startInput.alpha.oninput = updatePreview;
    endInput.color.oninput = updatePreview;
    endInput.alpha.oninput = updatePreview;
    updatePreview();

    const footer = contentEl.createDiv({ cls: "lq-quest-footer" });
    const save = footer.createEl("button", { cls: "mod-cta", text: "Save" });
    save.onclick = () => {
      void this.plugin.setPackBackground(this.pack.packId, {
        mode: isPackBackgroundMode(mode.value) ? mode.value : "grid",
        gradientStart: colorControlToRgba(startInput),
        gradientEnd: colorControlToRgba(endInput)
      }).then(() => this.close());
    };
  }

  private createColorInput(parent: HTMLElement, label: string, value: string): ColorInputControl {
    const parsed = parseRgbaComponents(value) ?? parseRgbaComponents(DEFAULT_PACK_BACKGROUND.gradientStart)!;
    const row = parent.createDiv({ cls: "lq-background-control" });
    row.createEl("label", { text: label });
    const controls = row.createDiv({ cls: "lq-color-controls" });
    const color = controls.createEl("input", { type: "color", value: rgbToHex(parsed.red, parsed.green, parsed.blue) });
    const alpha = controls.createEl("input", { type: "range", value: String(parsed.alpha) });
    alpha.min = "0";
    alpha.max = "1";
    alpha.step = "0.05";
    const alphaValue = controls.createSpan({ cls: "lq-alpha-value", text: `${Math.round(parsed.alpha * 100)}%` });
    return { color, alpha, alphaValue };
  }
}

class TrackedFoldersModal extends Modal {
  constructor(private plugin: LearningQuestsPlugin) {
    super(plugin.app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lq-modal");

    contentEl.createEl("h2", { text: "Tracked folders" });
    contentEl.createDiv({
      cls: "lq-description",
      text: "Markdown notes from these vault folders can be selected for note tasks. Use one folder per line."
    });

    const textarea = contentEl.createEl("textarea", {
      cls: "lq-tracked-folders-input"
    });
    textarea.value = this.plugin.settings.trackedFolders.join("\n");
    textarea.rows = 6;

    const footer = contentEl.createDiv({ cls: "lq-quest-footer" });
    footer.createEl("button", { text: "Save" }, (button) => {
      button.onclick = () => {
        this.plugin.settings.trackedFolders = textarea.value
          .split(/\r?\n/)
          .map((line) => normalizeVaultPath(line))
          .filter(Boolean);
        void this.plugin.saveSettings().then(() => {
          this.plugin.refreshViews();
          this.close();
          new Notice("Tracked folders saved");
        });
      };
    });
  }
}

class LearningQuestsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: LearningQuestsPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Learning Quests" });

    new Setting(containerEl)
      .setName("Tracked folders")
      .setDesc("Markdown notes from these vault folders can be selected for note tasks. Use one folder per line.")
      .addTextArea((text) => {
        text
          .setPlaceholder("Learning Quests\nStudy Notes")
          .setValue(this.plugin.settings.trackedFolders.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.trackedFolders = value
              .split(/\r?\n/)
              .map((line) => normalizeVaultPath(line))
              .filter(Boolean);
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          });

        text.inputEl.rows = 5;
        text.inputEl.addClass("lq-settings-textarea");
      });

    new Setting(containerEl)
      .setName("Demo quest packs")
      .setDesc("Create the bundled demo packs in Learning Quests/quests without overwriting existing files.")
      .addButton((button) => {
        button.setButtonText("Create demo packs").onClick(() => {
          void this.plugin.createDemoQuestPack();
        });
      });

    if (this.plugin.questPacks.length > 0) {
      let selectedPack = this.plugin.questPacks[0];
      let titleInput!: HTMLInputElement;
      new Setting(containerEl)
        .setName("Edit pack")
        .setDesc("Override pack metadata locally. Imported JSON files are not modified.")
        .addDropdown((dropdown) => {
          for (const pack of this.plugin.questPacks) {
            dropdown.addOption(pack.packId, this.plugin.getPackTitle(pack));
          }
          dropdown.setValue(selectedPack.packId).onChange((packId) => {
            selectedPack = this.plugin.questPacks.find((pack) => pack.packId === packId) ?? selectedPack;
            titleInput.value = this.plugin.getPackTitle(selectedPack);
          });
        })
        .addText((text) => {
          text.setPlaceholder("Pack title").setValue(this.plugin.getPackTitle(selectedPack));
          titleInput = text.inputEl;
        })
        .addButton((button) => {
          button.setButtonText("Save title").setCta().onClick(async () => {
            await this.plugin.setPackTitle(selectedPack, titleInput.value);
            titleInput.value = this.plugin.getPackTitle(selectedPack);
            new Notice("Pack title saved");
          });
        });
    }
  }
}

function isGateQuest(quest: Quest): boolean {
  const typedQuest = quest as Quest & { kind?: string; type?: string };
  return typedQuest.kind === "gate" || typedQuest.type === "gate";
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function normalizeVaultPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function getNoteBasename(path: string): string {
  const filename = path.split("/").pop() ?? path;
  return filename.replace(/\.md$/i, "");
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
      .map(([key, text]) => [key, text.trim()])
  );
}

function normalizeNodePositions(value: unknown): Record<string, QuestNodePosition> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, QuestNodePosition> = {};
  for (const [key, position] of Object.entries(value)) {
    if (!position || typeof position !== "object" || Array.isArray(position)) {
      continue;
    }

    const rawPosition = position as Record<string, unknown>;
    if (typeof rawPosition.x !== "number" || typeof rawPosition.y !== "number") {
      continue;
    }

    if (!Number.isFinite(rawPosition.x) || !Number.isFinite(rawPosition.y)) {
      continue;
    }

    normalized[key] = {
      x: Math.round(rawPosition.x),
      y: Math.round(rawPosition.y)
    };
  }

  return normalized;
}

function normalizePackBackgrounds(value: unknown): Record<string, PackBackgroundSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, PackBackgroundSettings> = {};
  for (const [packId, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }

    const candidate = raw as Partial<PackBackgroundSettings>;
    result[packId] = {
      mode: isPackBackgroundMode(candidate.mode) ? candidate.mode : DEFAULT_PACK_BACKGROUND.mode,
      gradientStart: parseRgbaColor(candidate.gradientStart) ?? DEFAULT_PACK_BACKGROUND.gradientStart,
      gradientEnd: parseRgbaColor(candidate.gradientEnd) ?? DEFAULT_PACK_BACKGROUND.gradientEnd
    };
  }
  return result;
}

function isPackBackgroundMode(value: unknown): value is PackBackgroundSettings["mode"] {
  return value === "none" || value === "grid" || value === "dots" || value === "gradient";
}

function parseRgbaColor(value: unknown): string | null {
  const parsed = parseRgbaComponents(value);
  return parsed ? `rgba(${parsed.red}, ${parsed.green}, ${parsed.blue}, ${parsed.alpha})` : null;
}

function parseRgbaComponents(value: unknown): RgbaColorParts | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.trim().match(/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*\)$/i);
  if (!match) {
    return null;
  }

  const red = Number(match[1]);
  const green = Number(match[2]);
  const blue = Number(match[3]);
  const alpha = Number(match[4]);
  if ([red, green, blue].some((channel) => channel > 255) || alpha < 0 || alpha > 1) {
    return null;
  }

  return { red, green, blue, alpha };
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function colorControlToRgba(control: ColorInputControl): string {
  const match = control.color.value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) {
    return DEFAULT_PACK_BACKGROUND.gradientStart;
  }

  const red = Number.parseInt(match[1], 16);
  const green = Number.parseInt(match[2], 16);
  const blue = Number.parseInt(match[3], 16);
  const alpha = clamp(Number(control.alpha.value), 0, 1);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function applyPackBackground(element: HTMLElement, background: PackBackgroundSettings) {
  element.removeClass("lq-background-none", "lq-background-grid", "lq-background-dots", "lq-background-gradient");
  element.addClass(`lq-background-${background.mode}`);
  element.style.setProperty("--lq-gradient-start", background.gradientStart);
  element.style.setProperty("--lq-gradient-end", background.gradientEnd);
}

let questMapOverviewSequence = 0;

function renderQuestMapOverview(
  plugin: LearningQuestsPlugin,
  parent: HTMLElement,
  snapshot: QuestMapSnapshot,
  viewportState?: CanvasViewportState
): SVGRectElement | undefined {
  const svg = createSvgElement("svg");
  svg.addClass("lq-map-overview-svg");
  svg.setAttribute("viewBox", `0 0 ${snapshot.worldWidth} ${snapshot.worldHeight}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Overview of ${snapshot.chapterTitle}`);
  parent.appendChild(svg);

  const markerPrefix = `lq-overview-${++questMapOverviewSequence}`;
  appendOverviewMarkers(svg, markerPrefix);
  const progress = plugin.getProgress();
  const gateEndpoint: CanvasLinkEndpoint = {
    position: snapshot.gatePosition,
    metrics: snapshot.gateMetrics
  };

  for (const quest of snapshot.quests) {
    const target = getOverviewEndpoint(snapshot, quest.id);
    if (!target) {
      continue;
    }

    const state = getOverviewNodeState(quest, progress, snapshot.allQuests);
    const requirements = quest.requires ?? [];
    if (requirements.length === 0) {
      appendOverviewLine(svg, gateEndpoint, target, "is-gate", `${markerPrefix}-gate`);
    }

    for (const requiredId of requirements) {
      const source = getOverviewEndpoint(snapshot, requiredId);
      if (source) {
        appendOverviewLine(svg, source, target, state, `${markerPrefix}-${state.replace("is-", "")}`);
      }
    }
  }

  appendOverviewNode(svg, snapshot.gatePosition, snapshot.gateMetrics, snapshot.chapterTitle, "is-gate");
  for (const quest of snapshot.quests) {
    const endpoint = getOverviewEndpoint(snapshot, quest.id);
    if (endpoint) {
      appendOverviewNode(
        svg,
        endpoint.position,
        endpoint.metrics,
        quest.title,
        getOverviewNodeState(quest, progress, snapshot.allQuests)
      );
    }
  }

  if (viewportState) {
    const focus = createSvgElement("rect");
    focus.addClass("lq-map-focus");
    updateQuestMapFocus(focus, snapshot, viewportState);
    svg.appendChild(focus);
    return focus;
  }

  return undefined;
}

function updateQuestMapFocus(focus: SVGRectElement, snapshot: QuestMapSnapshot, state: CanvasViewportState) {
  const visibleWidth = Math.min(snapshot.worldWidth, snapshot.viewport.clientWidth / state.scale);
  const visibleHeight = Math.min(snapshot.worldHeight, snapshot.viewport.clientHeight / state.scale);
  focus.setAttribute("x", String(clamp(-state.x / state.scale, 0, snapshot.worldWidth - visibleWidth)));
  focus.setAttribute("y", String(clamp(-state.y / state.scale, 0, snapshot.worldHeight - visibleHeight)));
  focus.setAttribute("width", String(visibleWidth));
  focus.setAttribute("height", String(visibleHeight));
}

function appendOverviewMarkers(svg: SVGSVGElement, prefix: string) {
  const defs = createSvgElement("defs");
  svg.appendChild(defs);
  for (const state of ["locked", "available", "completed", "gate"]) {
    const marker = createSvgElement("marker");
    marker.setAttribute("id", `${prefix}-${state}`);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "7");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("orient", "auto-start-reverse");
    marker.addClass("lq-overview-arrow");
    marker.addClass(`is-${state}`);
    const path = createSvgElement("path");
    path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    marker.appendChild(path);
    defs.appendChild(marker);
  }
}

function appendOverviewLine(
  svg: SVGSVGElement,
  from: CanvasLinkEndpoint,
  to: CanvasLinkEndpoint,
  state: string,
  markerId: string
) {
  const source = getOverviewBoundaryPoint(from, getOverviewCenter(to));
  const target = getOverviewBoundaryPoint(to, getOverviewCenter(from));
  const line = createSvgElement("line");
  line.addClass("lq-overview-link");
  line.addClass(state);
  line.setAttribute("x1", String(source.x));
  line.setAttribute("y1", String(source.y));
  line.setAttribute("x2", String(target.x));
  line.setAttribute("y2", String(target.y));
  line.setAttribute("marker-end", `url(#${markerId})`);
  svg.appendChild(line);
}

function appendOverviewNode(
  svg: SVGSVGElement,
  position: QuestNodePosition,
  metrics: { width: number; height: number },
  title: string,
  state: string
) {
  const group = createSvgElement("g");
  group.addClass("lq-overview-node");
  group.addClass(state);

  const rect = createSvgElement("rect");
  rect.setAttribute("x", String(position.x));
  rect.setAttribute("y", String(position.y));
  rect.setAttribute("width", String(metrics.width));
  rect.setAttribute("height", String(metrics.height));
  rect.setAttribute("rx", state === "is-gate" ? "12" : "8");
  group.appendChild(rect);

  const fullTitle = createSvgElement("title");
  fullTitle.textContent = title;
  group.appendChild(fullTitle);

  const lines = splitOverviewTitle(title);
  const text = createSvgElement("text");
  text.setAttribute("x", String(position.x + metrics.width / 2));
  text.setAttribute("y", String(position.y + metrics.height / 2 - ((lines.length - 1) * 9)));
  for (const [index, lineText] of lines.entries()) {
    const line = createSvgElement("tspan");
    line.setAttribute("x", String(position.x + metrics.width / 2));
    line.setAttribute("dy", index === 0 ? "0" : "18");
    line.textContent = lineText;
    text.appendChild(line);
  }
  group.appendChild(text);
  svg.appendChild(group);
}

function splitOverviewTitle(title: string): string[] {
  const maxLength = 22;
  const words = title.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const candidate = lines.length === 0 ? word : `${lines[lines.length - 1]} ${word}`;
    if (lines.length === 0 || candidate.length <= maxLength) {
      lines[lines.length === 0 ? 0 : lines.length - 1] = candidate;
    } else if (lines.length < 2) {
      lines.push(word);
    } else {
      lines[1] = `${lines[1].slice(0, Math.max(0, maxLength - 3))}...`;
      break;
    }
  }
  return lines.length > 0 ? lines : [title.slice(0, maxLength)];
}

function getOverviewNodeState(quest: Quest, progress: ProgressState, allQuests: Quest[]): string {
  if (progress.completedQuests.includes(quest.id)) {
    return "is-completed";
  }
  return isQuestUnlocked(quest, progress.completedQuests, allQuests) ? "is-available" : "is-locked";
}

function getOverviewEndpoint(snapshot: QuestMapSnapshot, questId: string): CanvasLinkEndpoint | undefined {
  const position = snapshot.positions.get(questId);
  const metrics = snapshot.nodeMetrics.get(questId);
  return position && metrics ? { position, metrics } : undefined;
}

function getOverviewCenter(endpoint: CanvasLinkEndpoint): QuestNodePosition {
  return {
    x: endpoint.position.x + endpoint.metrics.width / 2,
    y: endpoint.position.y + endpoint.metrics.height / 2
  };
}

function getOverviewBoundaryPoint(endpoint: CanvasLinkEndpoint, target: QuestNodePosition): QuestNodePosition {
  const center = getOverviewCenter(endpoint);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) {
    return center;
  }
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : endpoint.metrics.width / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : endpoint.metrics.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", tagName);
}

function getIconifySvgUrl(iconName: string): string {
  const [prefix, ...nameParts] = iconName.split(":");
  const name = nameParts.join(":");

  if (!prefix || !name || !/^[a-z0-9-]+$/i.test(prefix) || !/^[a-z0-9-]+$/i.test(name)) {
    return "";
  }

  return `https://api.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg?height=56`;
}

type CanvasViewportState = {
  x: number;
  y: number;
  scale: number;
  initialized: boolean;
};

type RgbaColorParts = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

type ColorInputControl = {
  color: HTMLInputElement;
  alpha: HTMLInputElement;
  alphaValue: HTMLElement;
};

type QuestMapSnapshot = {
  viewportKey: string;
  chapterTitle: string;
  quests: Quest[];
  allQuests: Quest[];
  positions: Map<string, QuestNodePosition>;
  nodeMetrics: Map<string, { width: number; height: number }>;
  gatePosition: QuestNodePosition;
  gateMetrics: { width: number; height: number };
  worldWidth: number;
  worldHeight: number;
  viewport: HTMLElement;
  background: PackBackgroundSettings;
};

type CanvasNodeLink = {
  line: SVGLineElement;
  fromId?: string;
  staticFrom?: CanvasLinkEndpoint;
  toId: string;
};

type CanvasLinkEndpoint = {
  position: QuestNodePosition;
  metrics: {
    width: number;
    height: number;
  };
};

type NodeDragContext = {
  viewport: HTMLElement;
  canvas: HTMLElement;
  viewportKey: string;
  worldOffset: QuestNodePosition;
  canvasPositions: Map<string, QuestNodePosition>;
  nodeMetrics: Map<string, { width: number; height: number }>;
  links: CanvasNodeLink[];
  canvasWidth: number;
  canvasHeight: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
