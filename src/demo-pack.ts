import { QuestPack } from "./models";

export const DEMO_PACK: QuestPack = {
  schemaVersion: 1,
  packId: "demo-programming",
  title: "Demo: Programming Basics",
  chapters: [
    {
      id: "javascript",
      title: "JavaScript",
      quests: [
        {
          id: "js-variables",
          title: "Variables",
          description: "Start with constants and mutable variables.",
          position: { x: 48, y: 72 },
          tasks: [
            {
              id: "read-intro",
              type: "markdown",
              content: "Read about let and const, then mark this task as read."
            },
            {
              id: "constant-question",
              type: "single-choice",
              prompt: "Which keyword declares a constant?",
              options: [
                { id: "let", text: "let" },
                { id: "const", text: "const" },
                { id: "var", text: "var" }
              ],
              answer: "const"
            }
          ],
          rewards: {
            xp: 10
          }
        },
        {
          id: "js-functions",
          title: "Functions",
          description: "Create a note and write a tiny summary.",
          position: { x: 284, y: 72 },
          requires: ["js-variables"],
          tasks: [
            {
              id: "create-note",
              type: "note-exists",
              prompt: "Create a note named JavaScript/Functions.md.",
              path: "JavaScript/Functions.md"
            },
            {
              id: "write-summary",
              type: "note-contains",
              prompt: "Add the words function and return to JavaScript/Functions.md.",
              path: "JavaScript/Functions.md",
              contains: ["function", "return"]
            }
          ],
          rewards: {
            xp: 15
          }
        }
      ]
    }
  ]
};

export const DEPENDENCY_DEMO_PACK: QuestPack = {
  schemaVersion: 1,
  packId: "demo-dependencies",
  title: "Demo: Dependencies",
  chapters: [
    {
      id: "dependency-map",
      title: "Dependency Map",
      quests: [
        {
          id: "dep-start",
          title: "Start",
          description: "Root quest with no dependencies.",
          position: { x: 48, y: 160 },
          tasks: [
            {
              id: "read-start",
              type: "markdown",
              content: "This root quest unlocks two parallel branches."
            }
          ],
          rewards: { xp: 5 }
        },
        {
          id: "dep-left",
          title: "Left Branch",
          description: "Unlocked after Start.",
          position: { x: 280, y: 72 },
          requires: ["dep-start"],
          tasks: [
            {
              id: "left-question",
              type: "single-choice",
              prompt: "Which quest unlocked this branch?",
              options: [
                { id: "start", text: "Start" },
                { id: "join", text: "Join" }
              ],
              answer: "start"
            }
          ],
          rewards: { xp: 10 }
        },
        {
          id: "dep-right",
          title: "Right Branch",
          description: "Also unlocked after Start.",
          position: { x: 280, y: 248 },
          requires: ["dep-start"],
          tasks: [
            {
              id: "right-note",
              type: "note-exists",
              prompt: "Create a note named Learning Quests/Dependency Right.md.",
              path: "Learning Quests/Dependency Right.md"
            }
          ],
          rewards: { xp: 10 }
        },
        {
          id: "dep-join",
          title: "Join",
          description: "Requires both branches, testing multiple dependencies.",
          position: { x: 524, y: 160 },
          requires: ["dep-left", "dep-right"],
          tasks: [
            {
              id: "join-summary",
              type: "note-contains",
              prompt: "Add left and right to Learning Quests/Dependency Right.md.",
              path: "Learning Quests/Dependency Right.md",
              contains: ["left", "right"]
            }
          ],
          rewards: { xp: 20 }
        },
        {
          id: "dep-final",
          title: "Final",
          description: "A simple chain after the join.",
          position: { x: 768, y: 160 },
          requires: ["dep-join"],
          tasks: [
            {
              id: "final-read",
              type: "markdown",
              content: "This quest tests a longer dependency chain."
            }
          ],
          rewards: { xp: 25 }
        },
        {
          id: "dep-broken",
          title: "Broken Lock",
          description: "Intentionally depends on a missing quest id.",
          position: { x: 524, y: 344 },
          requires: ["missing-quest-id"],
          tasks: [
            {
              id: "broken-read",
              type: "markdown",
              content: "This should remain locked because its dependency does not exist."
            }
          ],
          rewards: { xp: 1 }
        }
      ]
    }
  ]
};

export const OBSIDIAN_TASKS_DEMO_PACK: QuestPack = {
  schemaVersion: 1,
  packId: "demo-obsidian-tasks",
  title: "Demo: Obsidian Tasks",
  chapters: [
    {
      id: "vault-actions",
      title: "Vault Actions",
      quests: [
        {
          id: "vault-note-create",
          title: "Create Note",
          description: "Tests note-exists.",
          position: { x: 48, y: 96 },
          tasks: [
            {
              id: "create-lab-note",
              type: "note-exists",
              prompt: "Create a note named Learning Quests/Lab.md.",
              path: "Learning Quests/Lab.md"
            }
          ],
          rewards: { xp: 10 }
        },
        {
          id: "vault-note-fill",
          title: "Fill Note",
          description: "Tests note-contains with multiple required strings.",
          position: { x: 292, y: 96 },
          requires: ["vault-note-create"],
          tasks: [
            {
              id: "fill-lab-note",
              type: "note-contains",
              prompt: "Add quest, xp, and streak to Learning Quests/Lab.md.",
              path: "Learning Quests/Lab.md",
              contains: ["quest", "xp", "streak"]
            }
          ],
          rewards: { xp: 15 }
        },
        {
          id: "vault-mixed",
          title: "Mixed Tasks",
          description: "Tests several task types inside one quest.",
          position: { x: 536, y: 96 },
          requires: ["vault-note-fill"],
          tasks: [
            {
              id: "mixed-read",
              type: "markdown",
              content: "A quest can contain more than one task type."
            },
            {
              id: "mixed-question",
              type: "single-choice",
              prompt: "Where is progress stored in this prototype?",
              options: [
                { id: "save-data", text: "Plugin data" },
                { id: "database", text: "External database" },
                { id: "cookies", text: "Browser cookies" }
              ],
              answer: "save-data"
            },
            {
              id: "mixed-note",
              type: "note-contains",
              prompt: "Add complete to Learning Quests/Lab.md.",
              path: "Learning Quests/Lab.md",
              contains: ["complete"]
            }
          ],
          rewards: { xp: 30 }
        }
      ]
    }
  ]
};

export const MULTI_CHAPTER_DEMO_PACK: QuestPack = {
  schemaVersion: 1,
  packId: "demo-multi-chapter",
  title: "Demo: Multi Chapter Pack",
  chapters: [
    {
      id: "chapter-a",
      title: "Chapter A",
      quests: [
        {
          id: "a-start",
          title: "A Start",
          description: "Root quest in chapter A.",
          position: { x: 48, y: 80 },
          tasks: [
            {
              id: "a-read",
              type: "markdown",
              content: "Complete this to unlock another quest in the same chapter."
            }
          ],
          rewards: { xp: 5 }
        },
        {
          id: "a-next",
          title: "A Next",
          description: "Same-chapter dependency.",
          position: { x: 284, y: 80 },
          requires: ["a-start"],
          tasks: [
            {
              id: "a-next-read",
              type: "markdown",
              content: "This quest unlocks a cross-chapter quest."
            }
          ],
          rewards: { xp: 10 }
        }
      ]
    },
    {
      id: "chapter-b",
      title: "Chapter B",
      quests: [
        {
          id: "b-cross",
          title: "Cross Chapter",
          description: "Depends on a quest from Chapter A.",
          position: { x: 48, y: 80 },
          requires: ["a-next"],
          tasks: [
            {
              id: "b-cross-question",
              type: "single-choice",
              prompt: "Can dependencies point across chapters?",
              options: [
                { id: "yes", text: "Yes" },
                { id: "no", text: "No" }
              ],
              answer: "yes"
            }
          ],
          rewards: { xp: 20 }
        }
      ]
    }
  ]
};

export const DEMO_PACKS: QuestPack[] = [
  DEMO_PACK,
  DEPENDENCY_DEMO_PACK,
  OBSIDIAN_TASKS_DEMO_PACK,
  MULTI_CHAPTER_DEMO_PACK
];
