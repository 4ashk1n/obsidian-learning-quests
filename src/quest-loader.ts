import { QuestPack } from "./models";

export function normalizeQuestPacks(raw: unknown, sourcePath = "unknown"): QuestPack[] {
  const candidates = Array.isArray(raw) ? raw : [raw];
  return candidates.map((candidate, index) => normalizeQuestPack(candidate, `${sourcePath}#${index}`));
}

function normalizeQuestPack(raw: unknown, sourceId: string): QuestPack {
  if (!isRecord(raw)) {
    throw new Error(`Quest pack must be an object: ${sourceId}`);
  }

  const packId = readString(raw.packId, "quest-pack");
  const title = readString(raw.title, packId);
  const chaptersRaw = Array.isArray(raw.chapters) ? raw.chapters : [];

  if (chaptersRaw.length === 0) {
    throw new Error(`Quest pack has no chapters: ${sourceId}`);
  }

  return {
    schemaVersion: 1,
    packId,
    title,
    chapters: chaptersRaw.map((chapterRaw, chapterIndex) => {
      if (!isRecord(chapterRaw)) {
        throw new Error(`Chapter must be an object: ${sourceId}:${chapterIndex}`);
      }

      const id = readString(chapterRaw.id, `chapter-${chapterIndex + 1}`);
      const questsRaw = Array.isArray(chapterRaw.quests) ? chapterRaw.quests : [];

      return {
        id,
        title: readString(chapterRaw.title, id),
        quests: questsRaw.map((questRaw, questIndex) => {
          if (!isRecord(questRaw)) {
            throw new Error(`Quest must be an object: ${sourceId}:${id}:${questIndex}`);
          }

          const questId = readString(questRaw.id, `quest-${questIndex + 1}`);
          const position = isRecord(questRaw.position)
            ? {
                x: readNumber(questRaw.position.x, questIndex * 240),
                y: readNumber(questRaw.position.y, 0)
              }
            : undefined;

          return {
            id: questId,
            title: readString(questRaw.title, questId),
            description: typeof questRaw.description === "string" ? questRaw.description : undefined,
            kind: questRaw.kind === "gate" ? "gate" : "quest",
            icon: typeof questRaw.icon === "string" ? questRaw.icon : undefined,
            position,
            requires: Array.isArray(questRaw.requires) ? questRaw.requires.filter((value): value is string => typeof value === "string") : [],
            tasks: Array.isArray(questRaw.tasks) ? questRaw.tasks as any : [],
            rewards: isRecord(questRaw.rewards) ? { xp: readNumber(questRaw.rewards.xp, 0) } : { xp: 0 }
          };
        })
      };
    })
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
