---
name: interactive-pr-canvas
description: >-
  Builds a Cursor IDE canvas for a GitHub PR: thematic chapters (optional
  multi-file groups), narrative copy per chapter, scrollable unified diff
  excerpts, file tabs/sidebar, and keyboard navigation (chapters: ← → / footer only).
  Use for /interactive-pr-canvas, interactive PR review canvases, or gh pr
  diff walkthroughs beside chat.
---

# Interactive PR canvas

Produce a **standalone `.canvas.tsx` artifact** (not chat-only prose) so the user can step through a PR beside the conversation. Follow **`~/.cursor/skills-cursor/canvas/SKILL.md`** for where to write the file, imports (`cursor/canvas` only for UI), embed policy, and the self-check (no gradients, emoji-as-icons, box-shadow slop).

The **`scripts/generate-interactive-pr-canvas.mjs`** generator emits a **guided-review** layout: full-width shell, top strip (**GUIDED REVIEW**, chapter index, PR intro, segmented progress), **two columns** (left: chapter label, `H1` headline, takeaway, **clickable file list** for every file in the chapter; right: optional **`Pill` tabs** when there are multiple files, then diff card with path row, **FOCUS** line range from the first `@@` hunk, **Copy excerpt**, scrollable `DiffView`), and a **footer** (Back, padded step counter, **Next chapter** on non-final chapters—chapters are only navigated with ← → and the footer, no chapter list). Styling uses **`useHostTheme()`** and **`mergeStyle`** only—no hardcoded hex.

## Available scripts

Paths are **relative to this skill directory** (the folder containing `SKILL.md`), which is how [Agent Skills bundles scripts](https://agentskills.io/skill-creation/using-scripts) for agents—run commands with that folder as cwd, or use the path from repo root shown in the workflow below.

| Path | Purpose |
|------|---------|
| **`scripts/generate-interactive-pr-canvas.mjs`** | Unified diff + specs JSON → one `.canvas.tsx` with embedded chapter payload. Supports `--help`. |
| **`scripts/prompts/chapter-grouping.md`** | Repo-agnostic instructions for an LLM to output specs JSON with thematic **`files`** lists (paste as system/developer prompt). |

**Sharing:** Copy **`.cursor/skills/interactive-pr-canvas/`** (whole tree, including **`scripts/`**) into another repo under `.cursor/skills/`. Only `gh`, Node, and Cursor canvas support are required—no application code.

## Before you start

1. Read the canvas SDK exports in `~/.cursor/skills-cursor/canvas/sdk/index.d.ts` when you need exact prop types (`DiffView`, `useCanvasState`, `Pill`, etc.).
2. **PR source of truth**: `gh pr diff <ref>` from a repo where `gh` is authenticated. If the user did not give a PR URL, number, or branch resolvable by `gh`, **ask**—do not guess from an arbitrary local `git diff`.
3. Resolve the Cursor canvases directory: **`~/.cursor/projects/<workspace-folder-name>/canvases/`** (same rule as the canvas skill). Write **one** `.canvas.tsx` file with a descriptive kebab-case name (e.g. `pr-123-narrative-review.canvas.tsx`).

## What to build

### Data model (embedded payload)

Serialize an array of **chapters** as **base64(utf8(JSON))** split into string parts (~7–8k chars each) joined at runtime; decode with `atob` + `TextDecoder` + `JSON.parse` in the canvas module.

Each **chapter** has:

| Field | Purpose |
|--------|--------|
| `headline` | Short theme label (chapter title in header / strip) |
| `takeaway` | Multi-sentence narrative: what changed, what to verify, how it fits the PR |
| `files` | Array of `{ path, lines, additions, deletions }` after the generator resolves slices (see specs below) |
| `callouts` | Optional tagged review notes for subtle or risky behavior |
| `pseudocode` | Optional compact control-flow sketch for dense logic |
| `trace` | Optional concrete before/after behavior walkthrough |
| `mechanicalSummary` | Optional compact table for boilerplate, tests, config, or other low-signal churn |

**Thematic grouping**: Prefer **one chapter = one theme** with **`files`** listing every path in that theme (e.g. three tests + helper). The UI lets the reviewer switch files **without** leaving the chapter.

**Reviewer-first order** (same spirit as Cursor’s **`pr-review-canvas`** skill): order **`chunks`** by **signal**, not file-tree or alphabetical order. Lead with **core behavior** (new logic, APIs, state). Then **wiring & integration** (routes, proxies, env, cron hooks). Put **boilerplate & mechanical** churn last—or one short chapter whose **`takeaway`** summarizes filenames and stats with minimal/no diff slices. In **`takeaway`**, mention **cross-file interactions** (e.g. “`purge-deleted` is invoked only from the cron route; proxy must expose `/api/cron`.”).

**Large single files**: Split into **multiple chapters** or multiple **`files`** entries with different `start`/`end` slices on the same `path`—each slice is its own row in the sidebar/tabs for that chapter.

**Dense or surprising logic**: Add optional review aids only when they materially improve comprehension. Use **`callouts`** for genuinely subtle or risky changes, **`pseudocode`** for dense control flow, **`trace`** for a concrete before/after example, and **`mechanicalSummary`** for boilerplate/test/config chapters that are better scanned as a table than read as full diffs.

**Left rail scanability**: The left column is narrow. Keep **`takeaway`** as short newline-separated scan lines (`Change:`, `Why:`, `Verify:`, optional `Risk:`), not paragraphs. Move supporting explanation into review aids: a short warning callout, a 3-6 line invariant-focused pseudocode block, or one concrete trace.

**Header discipline**: The top strip is persistent. Keep **`meta.title`** short (4-9 words) and **`meta.introSuffix`** to one compact scope note, ideally under 120 characters. Put end-to-end behavior summaries in chapter 1 instead of the header.

Omit or compress noise (`issues/*.md`, huge generated snapshots, tests if needed for size) and say so in the intro.

**Custom canvases**: For reorganizations that need charts, DAG layout, tables, or tagged callouts on hunks, author a **hand-built** `.canvas.tsx` using **`~/.cursor/skills-cursor/canvas/SKILL.md`** and the **`pr-review-canvas`** skill’s patterns—this skill stays **guided-review + generator** focused.

### Specs JSON (generator input)

Author **`chunks`** (each chunk = one chapter) for **`scripts/generate-interactive-pr-canvas.mjs`**:

**Thematic (preferred)**

```json
{
  "headline": "Testing framework",
  "takeaway": "Change: …\nWhy: …\nVerify: …",
  "callouts": [{ "tone": "warning", "title": "Behavior change", "body": "Worth confirming …" }],
  "pseudocode": "if incoming is blank -> keep current\nif current is blank -> attach incoming\notherwise -> log conflict and keep current",
  "trace": { "title": "Example trace", "body": "Before: row B overwrites the stored ID.\nAfter: row B creates a review conflict and the stored ID remains." },
  "mechanicalSummary": { "headers": ["Path", "Role"], "rows": [["tests/foo.test.ts", "Covers X"]] },
  "files": [
    { "path": "tests/test_a.py", "start": 0, "end": 200 },
    { "path": "tests/test_b.py" }
  ]
}
```

- **`start`** / **`end`**: optional half-open `[start, end)` indices into the **parsed unified diff lines** for that path (same as before). Omit both to use the full diff for that file.

**Legacy (single file per chapter)**

```json
{ "headline": "…", "takeaway": "…", "path": "foo.ts", "start": 0, "end": 150 }
```

Either a **JSON array** of chapters, or **`{ "meta": { … }, "chunks": [ … ] }`**.

**Optional `meta`**: **`pr`**, **`title`**, **`prUrl`**, **`stateKey`** (chapter index; file index uses `${stateKey}::file`), **`introSuffix`**, **`footerStats`** (`[{ "value", "label" }]`), **`componentName`**.

### LLM-assisted grouping (repo-agnostic)

To have a model propose chapters and `files` lists from a PR description + diff text, use **`scripts/prompts/chapter-grouping.md`** as the system (or system+developer) prompt. Output must be **specs JSON** as above—not Meridian’s API schema. The prompt is **self-contained**; copy the whole skill folder (including **`scripts/`**) to any repo.

### UI layout (generator output)

1. **Header** — **GUIDED REVIEW**, chapter `x of n`, intro (`Link` + optional suffix), segmented progress.
2. **Main grid** — fixed band height **`clamp(420px, 72vh, 760px)`** so the layout does not jump when diff size changes.
3. **Left column** — `CHAPTER` label + **`H1`** (pinned); takeaway, optional review aids (**`Callout`**, pseudocode block, trace note, mechanical table), then **FILES IN THIS CHAPTER** in a **scrollable** middle section; keyboard hints at the bottom.
4. **Right column** — reserved **`Pill`** strip height so tabs do not shift the card; **`Card`** fills remaining height; toolbar row + **`DiffView`** in a **flex-filled** scroll region (same viewport height for every excerpt).
5. **Footer** — Back, **`01 / N`**, **Next chapter** (hidden on the final chapter).
6. **How to read this** — **Callout** below the footer row.
7. Optional **`footerStats`** (**At a glance**) — `Divider` + `H2` + `Grid` of `Stat` **last** (below the Callout).

### Keyboard

- `import { useEffect, useRef } from "react"`.
- **ArrowLeft** / **ArrowRight** → previous / next **chapter**; **`preventDefault`** when handling.
- When the current chapter has **more than one file**: **ArrowUp** / **ArrowDown** → previous / next **file**.
- **Do not** handle those keys when `document.activeElement` is `INPUT`, or `TEXTAREA`.

### State

- `useCanvasState("<unique-key>", 0)` for **chapter** index.
- `useCanvasState("<unique-key>::file", 0)` for **file** index within the chapter (generator wires this automatically). When the chapter changes, the file index resets to `0` (except first mount).

### Imports

- UI: **only** `cursor/canvas` (and `import type { DiffLineData } from "cursor/canvas"`).
- **`react`**: `useEffect`, `useRef` as above.

## Implementation recipe

1. Resolve unified diff: **`gh pr diff`** via **`--pr <ref>`**, or **`--diff`** file.
2. Optionally use **`scripts/prompts/chapter-grouping.md`** + model to produce **`chunks`** JSON (thematic `files` arrays).
3. Run **`scripts/generate-interactive-pr-canvas.mjs`** with **`--specs -`** (stdin), **`INTERACTIVE_PR_CANVAS_SPECS_JSON`**, or **`/tmp/...json`**.
4. Tell the user where the `.canvas.tsx` lives.

### Keep specs out of the git repo

Canvas output: **`~/.cursor/projects/.../canvases/`**. Prefer **`/tmp`** or stdin for specs; avoid committing `*-specs.json` unless the user wants tracked examples.

**Typical workflow** (from repo root; adjust `--project-slug` if needed):

```bash
node .cursor/skills/interactive-pr-canvas/scripts/generate-interactive-pr-canvas.mjs \
  --pr 123 \
  --specs - < /tmp/pr-123-specs.json \
  --project-slug "$(basename "$(git rev-parse --show-toplevel)")"
```

If you `cd` to the skill directory instead:

```bash
cd .cursor/skills/interactive-pr-canvas
node scripts/generate-interactive-pr-canvas.mjs --pr 123 --specs - < /tmp/pr-123-specs.json \
  --project-slug "$(basename "$(git rev-parse --show-toplevel)")"
```

Use **`CURSOR_CANVAS_OUT`** when the Cursor project folder name does not match `git`’s repo basename.

**Env:** **`INTERACTIVE_PR_CANVAS_DIFF`**, **`INTERACTIVE_PR_CANVAS_SPECS`**, **`INTERACTIVE_PR_CANVAS_SPECS_JSON`**, **`CURSOR_PROJECT_SLUG`**, **`CURSOR_CANVAS_OUT`**.

## Tone

Reviewer-facing **`takeaway`** text: focus on **why** and **what to verify**, not changelog bullets—the same bar as **`pr-review-canvas`** commentary.
