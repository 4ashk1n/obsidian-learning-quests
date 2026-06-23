export type QuestTask = MarkdownTask | SingleChoiceTask | NoteExistsTask | NoteContainsTask;

export type TaskReward = {
  xp: number;
};

export type MarkdownTask = {
  id: string;
  type: "markdown";
  content: string;
  reward?: TaskReward;
};

export type SingleChoiceTask = {
  id: string;
  type: "single-choice";
  prompt: string;
  options: Array<{
    id: string;
    text: string;
  }>;
  answer: string;
  reward?: TaskReward;
};

export type NoteExistsTask = {
  id: string;
  type: "note-exists";
  prompt: string;
  path: string;
  reward?: TaskReward;
};

export type NoteContainsTask = {
  id: string;
  type: "note-contains";
  prompt: string;
  path: string;
  contains: string[];
  reward?: TaskReward;
};

export type QuestNodeKind = "quest" | "gate";

export type Quest = {
  id: string;
  title: string;
  description?: string;
  kind?: QuestNodeKind;
  icon?: string;
  position?: {
    x: number;
    y: number;
  };
  requires?: string[];
  tasks: QuestTask[];
  rewards?: {
    xp: number;
  };
  chapterId?: string;
  chapterTitle?: string;
  packId?: string;
};

export type QuestChapter = {
  id: string;
  title: string;
  quests: Quest[];
};

export type QuestPack = {
  schemaVersion: 1;
  packId: string;
  title: string;
  chapters: QuestChapter[];
};

export type StreakState = {
  current: number;
  best: number;
  lastCompletedDate?: string;
};

export type ProgressState = {
  xp: number;
  completedQuests: string[];
  completedTasks: Record<string, string[]>;
  skippedTasks: Record<string, string[]>;
  rewardedTasks: Record<string, string[]>;
  streak: StreakState;
  answers: Record<string, string>;
  selectedNotes: Record<string, string>;
};

export type LearningQuestsSettings = {
  trackedFolders: string[];
  progress: ProgressState;
};
