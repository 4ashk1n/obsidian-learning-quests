# Learning Quests

Learning Quests is an Obsidian plugin for turning study materials into a visual quest map. It supports JSON quest packs, dependency graphs, XP, streaks, task completion, note-based tasks, draggable nodes, gates, and generated learning roadmaps.

## Installation

Clone this repository into the plugins folder of your Obsidian vault:

```bash
cd /path/to/YourVault/.obsidian/plugins
git clone https://github.com/4ashk1n/obsidian-learning-quests.git obsidian-learning-quests
```

The final path should look like this:

```text
YourVault/.obsidian/plugins/obsidian-learning-quests/
```

If you are developing from source or need to rebuild the plugin:

```bash
cd /path/to/YourVault/.obsidian/plugins/obsidian-learning-quests
npm install
npm run build
```

## Enable The Plugin In Obsidian

1. Open Obsidian.
2. Open `Settings`.
3. Go to `Community plugins`.
4. If needed, turn off `Restricted mode`.
5. Open `Installed plugins`.
6. Find `Learning Quests`.
7. Enable it.

After enabling the plugin, a trophy icon appears in the left ribbon. Click it to open the Learning Quests view.

## Creating Quest Packs With An LLM

Take a learning material, such as a textbook, manual, lecture notes, article, or PDF, and give it to your preferred LLM. ChatGPT 5.5 is recommended.

Use this prompt from the plugin repository:

```text
prompts/learning-quests-json-generator-updated.md
```

Ask the LLM to generate a Learning Quests JSON file from the material. The output should be valid raw JSON and should follow the schema described in the prompt.

## Loading Generated JSON Into Obsidian

1. In Obsidian, click the trophy icon to open Learning Quests.
2. Click `Create demo JSON packs`.
3. The plugin creates this folder inside your vault:

```text
Learning Quests/quests/
```

4. Move or save the LLM-generated `.json` quest pack into that folder.
5. The plugin should reload quest packs automatically.
6. If it does not appear, click `Reload packs`.

Quest pack files must be valid `.json` files.

## Basic Usage

- Click a quest node to open its tasks.
- Complete markdown reading tasks manually.
- Answer single-choice questions.
- Complete note tasks by creating or selecting an Obsidian note.
- Use `Skip` when a generated task is not appropriate; skipped tasks do not grant XP.
- Complete all required tasks in a quest to mark the quest complete.
- Completed quests unlock dependent quests.

## Features

- Visual quest map with dependencies.
- Gates for major sections, milestones, or synthesis checkpoints.
- XP and streak tracking.
- Supported task types: markdown, single-choice, note-exists, and note-contains.
- Tracked note folders for note-based tasks.
- Note picker for selecting existing notes.
- Pan and zoom on the quest map.
- Draggable quest nodes with saved custom positions.
- Smart edge anchors: arrows connect to the nearest side of each node.
- `Center map` and `Reset node positions` controls.
- Automatic quest pack reload when JSON files change.

## Quest Pack Location

Generated or custom quest packs should be placed here inside the vault:

```text
Learning Quests/quests/
```

Example:

```text
YourVault/Learning Quests/quests/linear-algebra-quests.json
```

## Prompt Location

Use this prompt to generate new packs:

```text
obsidian-learning-quests/prompts/learning-quests-json-generator-updated.md
```

If the repository is installed directly in your vault plugin folder, the full path is typically:

```text
YourVault/.obsidian/plugins/obsidian-learning-quests/prompts/learning-quests-json-generator-updated.md
```
