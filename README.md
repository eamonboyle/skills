# eamonboyle/skills

Agent skills for Cursor and other AI-assisted workflows—reusable instructions, scripts, and prompts that agents load on demand. This repository is a **catalog**: it will grow beyond the first skill; each top-level directory (with a `SKILL.md`) is one installable skill bundle.

## Install

From your machine or project directory:

```bash
npx skills add eamonboyle/skills
```

That pulls skills from this repo into your environment according to the `skills` CLI you use. Re-run when you want updates after new skills land here.

## Skills in this repo

| Skill | Summary |
|--------|---------|
| [**interactive-pr-canvas**](interactive-pr-canvas/SKILL.md) | Build a Cursor canvas for GitHub PR review: chapters, narrative, unified diff excerpts, file navigation, and a Node generator script. |
| [**pr-review-defects-only**](pr-review-defects-only/SKILL.md) | Defects-only review of a PR, branch, or diff: flags bugs, security holes, regressions, data loss, and real performance issues, with no style nits or refactor suggestions. |
| [**proven-review-loop**](proven-review-loop/SKILL.md) | Looping review-and-fix cycle for a branch. Reviewer subagents find candidate bugs, each one is reproduced by running the real code (browser for web UIs, requests or failing tests for APIs and libraries) before a fixer subagent changes anything, and rounds repeat until one comes back clean. Built for Claude Code subagents; add per-project notes under `references/projects/`. |

## Layout

Each skill lives in its own folder next to this README:

- `SKILL.md` — frontmatter (`name`, `description`) plus instructions for agents.
- Optional `scripts/`, `references/`, etc. — bundled tooling per [Agent Skills](https://agentskills.io/) conventions.

## Contributing / forking

Fork or vendor individual skill folders into `.cursor/skills/` (or your tool’s equivalent) if you prefer not to use the CLI. The interactive PR canvas skill documents manual copying in its SKILL.
