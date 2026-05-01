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

## Cross-platform (Windows, macOS, Linux)

The generator is **plain Node** (`.mjs`)—paths use **`path.join`** / **`path.resolve`** so drives and separators follow the OS where **`node`** runs.

| Topic | Notes |
|--------|--------|
| **Home / Cursor dirs** | Default canvas output resolves under **`os.homedir()`** → Windows **`%USERPROFILE%\.cursor\projects\<workspace-key>\canvases\`**, Unix **`~/.cursor/projects/...`**. **`CURSOR_CANVAS_OUT`** overrides entirely if slug guessing is awkward. |
| **`git` / `gh`** | **`execFileSync`** looks up **`git`** and **`gh`** on **`PATH`**. Install [Git for Windows](https://git-scm.com/download/win) and the GitHub CLI; use the **same environment** Cursor uses (native Windows vs WSL)—mixed setups may need **`CURSOR_CANVAS_OUT`** pointed at the folder Cursor actually reads. |
| **Unified diff paths** | `git` / `gh pr diff` emit `a/…` and `b/…` paths with forward slashes; parsing stays consistent on Windows checkouts. |
| **Shell examples** | Bash **` < ./tmp/specs.json`** is Unix-centric. **Portable:** set **`INTERACTIVE_PR_CANVAS_SPECS_JSON`** from your runner, or **`INTERACTIVE_PR_CANVAS_SPECS`** to a file path. PowerShell stdin: **`Get-Content .\tmp\pr-123-specs.json -Raw \| node ... --specs -`** (pipe UTF-8 text). |

## Before you start

1. Read the canvas SDK exports in `~/.cursor/skills-cursor/canvas/sdk/index.d.ts` when you need exact prop types (`DiffView`, `useCanvasState`, `Pill`, etc.).
2. **PR source of truth**: `gh pr diff <ref>` from a repo where `gh` is authenticated. If the user did not give a PR URL, number, or branch resolvable by `gh`, **ask**—do not guess from an arbitrary local `git diff`.
3. **Emit path (matches Cursor exactly):** Canvases are stored under **`~/.cursor/projects/<workspace-key>/canvases/<name>.canvas.tsx`**. Cursor’s **`<workspace-key>`** encodes your machine/workspace path as a hyphenated segment (paths like **`/home/eamon/code/skills`** often become **`home-eamon-code-skills`**), **not necessarily** **`basename`** of git’s **`toplevel`** (e.g. `skills`). **Example:** **`/home/eamon/.cursor/projects/home-eamon-code-skills/canvases/codebase-overview.canvas.tsx`**. If unsure, **`list`** **`~/.cursor/projects/`** and pick the folder for this workspace—then set **`--project-slug`** / **`CURSOR_PROJECT_SLUG`** to match that directory name (**`CURSOR_CANVAS_OUT`** still overrides **`--out`** when needed).
4. **Specs JSON and sandbox prompts:** Writes under **`~/.../canvases/`** trigger Cursor permission even for **`pr-N-specs.json`** — that folder is guarded. **You do not need any `*-specs.json` file:** pass the same JSON via **`INTERACTIVE_PR_CANVAS_SPECS_JSON`** (often as a single-quoted env value in the shell) and the generator never reads or creates a specs path. **`mkdir tmp` / `./tmp/`** or creating files under OS **`/tmp`** can also trigger **Allow** prompts—**agents should use `INTERACTIVE_PR_CANVAS_SPECS_JSON` + `--pr`** so nothing in the workspace (or system temp) is created for specs, and diff comes from **`gh`** in memory. Only the final **`.canvas.tsx`** write (under **`~/.cursor/.../canvases/`** or **`CURSOR_CANVAS_OUT`**) remains. If a file-based flag is unavoidable, **`--specs -`** with a pipe avoids a named specs file but still uses stdin. Default **`INTERACTIVE_PR_CANVAS_DIFF`** is **`(git-repo-root)/tmp/interactive-pr-canvas.diff`** when you rely on a on-disk diff without **`--pr`**—that path does **not** imply the generator creates **`tmp/`**; it only **reads** if present.

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
3. Run **`scripts/generate-interactive-pr-canvas.mjs`** with **`INTERACTIVE_PR_CANVAS_SPECS_JSON`** (**agents:** avoids writing specs anywhere), **`--specs`** path (**prefer workspace `./tmp/...`**), or **`--specs -`** (stdin).
4. Tell the user where the `.canvas.tsx` lives.

### Intermediate specs (sandbox: avoid needless prompts)

The **artifact** MUST land at **`~/.../canvases/<name>.canvas.tsx`**. Putting **`pr-*-specs.json`** in that same **`canvases/`** folder still triggers the **Allow canvases/** gate—Cursor treats writes there uniformly.

**Recommended for agents (no specs file, no `./tmp`):**

1. **`INTERACTIVE_PR_CANVAS_SPECS_JSON`** — JSON in the environment only (**best default**); pair with **`--pr`** so diff never touches disk either.
2. **`--specs -`** — stdin (`pipe` / redirect); still no persisted **`specs.json`** if you stream JSON only once.

**Optional file paths** (may prompt to create **`tmp/`** or write paths Cursor guards):

3. **`--specs ./tmp/pr-<n>-specs.json`** — workspace-relative (**needs `./tmp`** unless it already exists).

After success, **`generate-interactive-pr-canvas.mjs`** deletes the **`--specs`** disk file automatically when its path resolves inside the git repo’s **`tmp/`** subtree (when not in git: under **`cwd/tmp/`**) so stray JSON does not linger. Preserve it with **`--keep-specs`** or **`INTERACTIVE_PR_CANVAS_KEEP_SPECS=1`**. (**`INTERACTIVE_PR_CANVAS_SPECS_JSON`** and **`--specs -`** imply nothing named by **`--specs`** alone to unlink.)

The generator’s fallback diff path (**when neither `--pr` nor explicit `--diff`**) is **`(git-repo-root)/tmp/interactive-pr-canvas.diff`**—see **`INTERACTIVE_PR_CANVAS_DIFF`**.

Canvas output: **`CURSOR_CANVAS_OUT`**, else default **`~/.cursor/projects/<workspace-key>/canvases/*.canvas.tsx`** (that write may prompt once—it is the deliverable). The **workspace-key** subdirectory must match **`~/.cursor/projects/`** (run **`ls`** there)—do **not** assume it equals **`$(basename "$(git rev-parse --show-toplevel)")`** (often it does **not**).

**Typical workflow (env-only specs — no `spec.json`, no `mkdir tmp`):**

```bash
export INTERACTIVE_PR_CANVAS_SPECS_JSON='{"meta":{"pr":"123"},"chunks":[{"headline":"Theme","takeaway":"Change: …","files":[{"path":"src/example.ts"}]}]}'
SLUG="home-eamon-code-skills"   # ls ~/.cursor/projects/
node .cursor/skills/interactive-pr-canvas/scripts/generate-interactive-pr-canvas.mjs \
  --pr 123 \
  --project-slug "$SLUG"
```

**Alternative — specs file under `./tmp`** (requires creating **`tmp/`** first if missing):

```bash
mkdir -p tmp
SLUG="home-eamon-code-skills"
node .cursor/skills/interactive-pr-canvas/scripts/generate-interactive-pr-canvas.mjs \
  --pr 123 \
  --specs ./tmp/pr-123-specs.json \
  --project-slug "$SLUG"
```

Stdin (still no persistent **`specs.json`** if you pipe without saving):

```bash
SLUG="home-eamon-code-skills"
node .cursor/skills/interactive-pr-canvas/scripts/generate-interactive-pr-canvas.mjs \
  --pr 123 \
  --specs - < ./tmp/pr-123-specs.json \
  --project-slug "$SLUG"
```

Use **`CURSOR_CANVAS_OUT`** for a literal output path regardless of **`--project-slug`**.

**Env:** **`INTERACTIVE_PR_CANVAS_DIFF`**, **`INTERACTIVE_PR_CANVAS_SPECS`**, **`INTERACTIVE_PR_CANVAS_SPECS_JSON`**, **`INTERACTIVE_PR_CANVAS_KEEP_SPECS`** (equals **`1`** to keep ephemeral **`--specs`** files under **`tmp/`**), **`CURSOR_PROJECT_SLUG`**, **`CURSOR_CANVAS_OUT`**.

## Tone

Reviewer-facing **`takeaway`** text: focus on **why** and **what to verify**, not changelog bullets—the same bar as **`pr-review-canvas`** commentary.
