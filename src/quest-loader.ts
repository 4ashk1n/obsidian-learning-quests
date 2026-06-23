import { QuestPack, QuestTask } from "./models";

export function normalizeQuestPacks(input: unknown, source: string): QuestPack[] {
  const candidates = Array.isArray(input) ? input : [input];
  return candidates.map((candidate) => normalizeQuestPack(candidate, source));
}

function normalizeQuestPack(input: unknown, source: string): QuestPack {
  if (!isRecord(input)) {
    throw new Error(`${source}: quest pack must be an object`);
  }

  if (input.schemaVersion !== 1) {
    throw new Error(`${source}: only schemaVersion 1 is supported`);
  }

  const packId = requireString(input.packId, `${source}: packId`);
  const title = requireString(input.title, `${source}: title`);
  const chaptersInput = requireArray(input.chapters, `${source}: chapters`);

  return {
    schemaVersion: 1,
    packId,
    title,
    chapters: chaptersInput.map((chapterInput, chapterIndex) => {
      if (!isRecord(chapterInput)) {
        throw new Error(`${source}: chapter ${chapterIndex} must be an object`);
      }

      const chapterId = requireString(chapterInput.id, `${source}: chapter id`);
      const chapterTitle = requireString(chapterInput.title, `${source}: chapter title`);
      const questsInput = requireArray(chapterInput.quests, `${source}: chapter quests`);

      return {
        id: chapterId,
        title: chapterTitle,
        quests: questsInput.map((questInput, questIndex) => {
          if (!isRecord(questInput)) {
            throw new Error(`${source}: quest ${questIndex} must be an object`);
          }

          return {
            id: requireString(questInput.id, `${source}: quest id`),
            title: requireString(questInput.title, `${source}: quest title`),
            description: optionalString(questInput.description),
            icon: optionalString(questInput.icon),
            position: normalizePosition(questInput.position),
            requires: optionalStringArray(questInput.requires),
            tasks: requireArray(questInput.tasks, `${source}: tasks`).map((taskInput) =>
              normalizeTask(taskInput, source)
            ),
            rewards: normalizeRewards(questInput.rewards)
          };
        })
      };
    })
  };
}

function normalizeTask(input: unknown, source: string): QuestTask {
  if (!isRecord(input)) {
    throw new Error(`${source}: task must be an object`);
  }

  const id = requireString(input.id, `${source}: task id`);
  const type = requireString(input.type, `${source}: task type`);

  if (type === "markdown") {
    return {
      id,
      type,
      content: requireString(input.content, `${source}: markdown content`),
      reward: normalizeTaskReward(input.reward)
    };
  }

  if (type === "single-choice") {
    return {
      id,
      type,
      prompt: requireString(input.prompt, `${source}: prompt`),
      options: requireArray(input.options, `${source}: options`).map((option) => {
        if (!isRecord(option)) {
          throw new Error(`${source}: option must be an object`);
        }

        return {
          id: requireString(option.id, `${source}: option id`),
          text: requireString(option.text, `${source}: option text`)
        };
      }),
      answer: requireString(input.answer, `${source}: answer`),
      reward: normalizeTaskReward(input.reward)
    };
  }

  if (type === "note-exists") {
    return {
      id,
      type,
      prompt: requireString(input.prompt, `${source}: prompt`),
      path: requireString(input.path, `${source}: path`),
      reward: normalizeTaskReward(input.reward)
    };
  }

  if (type === "note-contains") {
    return {
      id,
      type,
      prompt: requireString(input.prompt, `${source}: prompt`),
      path: requireString(input.path, `${source}: path`),
      contains: optionalStringArray(input.contains),
      reward: normalizeTaskReward(input.reward)
    };
  }

  throw new Error(`${source}: unsupported task type ${type}`);
}

function normalizeRewards(input: unknown): { xp: number } {
  if (!isRecord(input)) {
    return { xp: 0 };
  }

  return {
    xp: typeof input.xp === "number" ? input.xp : 0
  };
}

function normalizeTaskReward(input: unknown): { xp: number } | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  return {
    xp: typeof input.xp === "number" ? input.xp : 0
  };
}

function normalizePosition(input: unknown): { x: number; y: number } | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  if (typeof input.x !== "number" || typeof input.y !== "number") {
    return undefined;
  }

  return {
    x: input.x,
    y: input.y
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function requireString(input: unknown, field: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }

  return input;
}

function optionalString(input: unknown): string | undefined {
  return typeof input === "string" ? input : undefined;
}

function requireArray(input: unknown, field: string): unknown[] {
  if (!Array.isArray(input)) {
    throw new Error(`${field} must be an array`);
  }

  return input;
}

function optionalStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter((item): item is string => typeof item === "string");
}
