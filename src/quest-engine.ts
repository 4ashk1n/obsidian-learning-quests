import { ProgressState, Quest, StreakState } from "./models";

export function isQuestUnlocked(
  quest: Quest,
  completedQuestIds: string[],
  allQuests: Quest[]
): boolean {
  const knownQuestIds = new Set(allQuests.map((item) => item.id));

  return (quest.requires ?? []).every((id) => {
    if (!knownQuestIds.has(id)) {
      return false;
    }

    return completedQuestIds.includes(id);
  });
}

export function isTaskCompleted(
  progress: ProgressState,
  questId: string,
  taskId: string
): boolean {
  return (progress.completedTasks[questId] ?? []).includes(taskId);
}

export function isTaskSkipped(
  progress: ProgressState,
  questId: string,
  taskId: string
): boolean {
  return (progress.skippedTasks[questId] ?? []).includes(taskId);
}

export function updateStreak(streak: StreakState, date: Date): StreakState {
  const today = toDateKey(date);

  if (streak.lastCompletedDate === today) {
    return streak;
  }

  const yesterday = toDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1));
  const current = streak.lastCompletedDate === yesterday ? streak.current + 1 : 1;

  return {
    current,
    best: Math.max(streak.best, current),
    lastCompletedDate: today
  };
}

export function normalizeStreak(streak: StreakState, date: Date): StreakState {
  if (isStreakActive(streak, date)) {
    return streak;
  }

  return {
    ...streak,
    current: 0
  };
}

export function isStreakActive(streak: StreakState, date: Date): boolean {
  if (streak.current <= 0 || !streak.lastCompletedDate) {
    return false;
  }

  const today = toDateKey(date);
  const yesterday = toDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1));
  return streak.lastCompletedDate === today || streak.lastCompletedDate === yesterday;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
