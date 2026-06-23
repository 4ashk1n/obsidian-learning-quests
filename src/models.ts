export type LearningQuestsSettings = {
  trackedFolders: string[];
  progress: ProgressState;
};

export type ProgressState = {
  xp: number;
  completedQuests: string[];
  completedTasks: CompletedTasks;
  skippedTasks: CompletedTasks;
  rewardedTasks: CompletedTasks;
  streak: StreakState;
  answers: Record<string, string>;
  selectedNotes: Record<string, string>;
};

export type CompletedTasks = Record<string, string[]>;

export type StreakState = {
  current: number;
  best: number;
  lastCompletionDate?: string;
};

export type QuestPack = {
  schemaVersion: 1;
  packId: string;
  title: string;
  chapters: Chapter[];
};

export type Chapter = {
  id: string;
  title: string;
  quests: QuestDefinition[];
};

export type QuestDefinition = {
  id: string;
  title: string;
  description?: string;
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
};

export type Quest = QuestDefinition & {
  chapterId?: string;
  chapterTitle?: string;
  packId?: string;
};

export type QuestTask =
  | MarkdownTask
  | SingleChoiceTask
  | NoteExistsTask
  | NoteContainsTask;

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
  options: {
    id: string;
    text: string;
  }[];
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

export type TaskReward = {
  xp: number;
};
