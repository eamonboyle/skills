---
name: proven-review-loop
description: Run a looping, reproduction-proven PR review-and-fix cycle on the current branch. Reviewer subagents find candidate bugs. Each candidate is reproduced by running the real code before anything is changed (in the browser for web UIs; a live request, script or failing test for APIs, libraries and CLIs). Fixer subagents apply minimal fixes, each fix is re-proven, and rounds repeat until a round comes back with nothing real; then optionally open a PR with the fixes. Use this whenever the user asks to "loop" a review, "keep reviewing until clean", "review, prove the bugs, then fix", run /pr-review-toolkit:review-pr (or any review command) repeatedly, or harden a large branch (package upgrade, migration, refactor) before merge, even if they don't say "loop". Not for a single one-off review with no fixing, and not for style or refactor passes.
---

# Proven review loop

This is a repeated review of a branch. A bug gets fixed only once it has been **reproduced by running the real code**. Fixes are delegated to subagents, and every fix is re-proven before the next round. The loop ends when a round comes back with nothing real, and that round has to include a review of your own fixes.

Proving first matters because on large branches most static findings are plausible but wrong, unreachable, or already on the base branch. `references/round-playbook.md` explains which kinds of round actually find bugs.

## 0. Set up (once)

Ask only for what you can't find out yourself.

- **Branch and baseline.**
  - Confirm `git branch --show-current` is the branch the user means, and find its base.
  - Confirm `git status` is clean, or note the files that were already changed.
  - Check the size with `git diff --stat <base>...HEAD`.
  - Run the project's type-check, lint and unit tests once, and record anything that already fails. Without that baseline you can't tell pre-existing failures from ones your fixes caused.
- **The user's rules.**
  - The defaults: real bugs only (no nits, style or refactors); **no commits or pushes** until asked; data may be changed but must be restored.
  - Check memory and project instruction files for saved preferences.
  - If the user named a review command (e.g. `/pr-review-toolkit:review-pr`), use its agents as the round-1 reviewers, but tell them the bugs-only rules.
- **Models.**
  - Use the ones the user asked for; otherwise use Sonnet for reviewers and fixers.
  - Fixers: prefer an effort-pinned agent type if one exists (e.g. `pstack:effort-medium` with `model: sonnet`), else `general-purpose`.
  - Reviewers: `pr-review-toolkit:code-reviewer` / `silent-failure-hunter` if available, else `general-purpose`. These review agents lean towards guideline and style findings, so the brief's "bugs only" line is essential.
- **Proof harness.** Decide how bugs get proven in this project, and confirm it works now.
  - **Web UI:** the dev server is up and the built-in browser is signed in (`tabs_context`, then one screenshot). If it isn't signed in, ask the user to sign in, and never type credentials yourself. Techniques are in `references/browser-proof.md`.
  - **API or service:** run it locally in the background and call it with curl or a script; or use integration tests that drive the real pipeline, such as an in-memory host with a test database.
  - **Library or CLI:** a failing test or a small script against the real code.
  - **Authentication:** use the signed-in session, a test auth handler, or a token the user gives you. Don't read `.env` or secrets.
  - **If nothing can run** (the server is down, or dependencies are missing), tell the user and ask. Don't quietly fall back to static review.
  - Find the code on the other side of each boundary (the backend for a UI, the callers for an API) so you can check whether a failure can actually happen.
- **Project specifics.** If a file under `references/projects/` matches this repo, read it now. You can add one per project: its URLs and routes, check commands, where the backends live, local-data quirks, safe test records, and anything that can't be undone through the app.
- **The ledger.**
  - Keep `<scratchpad>/review-ledger.md`, not a list in your head: it has to survive many rounds and context compaction.
  - Add one row per candidate: `id | round | file:line | summary | status (proven / fixed / re-verified / dropped / decision / open) | evidence | reason`.
  - Add a **Data changes** section: what you changed and how you restored it.
  - Update the ledger before each progress message to the user.

## 1. Run a round

### Launch reviewers in parallel, in the background

- Give each reviewer a slice, a lens, and the brief in `references/reviewer-brief.md`.
- **Slices:** cut the diff into roughly equal file counts, about 25–40 files each, along directory boundaries.
- **Size:** about 7 or fewer reviewers per round.
- **Every brief says:**
  - bugs only;
  - compare against the base (`git show <base>:<path>`);
  - give concrete repro steps;
  - don't edit;
  - report at most about 6 findings;
  - use its own tab or process when running things;
  - don't re-report what's listed as already fixed or dropped (paste the relevant ledger lines).

Choosing lenses:

| Round | Lenses |
|---|---|
| 1 | Broad: one code-reviewer per slice, plus one silent-failure hunter across the changed code. |
| 2 | Narrower slices; trace user or caller flows end to end (open → edit → save → refresh → back; request → validation → persistence → response). |
| 3+ | One "hunt the rest of this class" reviewer for each bug class found so far. "Drive the flows nobody has exercised yet" reviewers. Fresh angles, such as library-default changes and throws on unexpected data. |
| Every round after the first fix | Add one reviewer on the **uncommitted working tree**: bugs introduced by earlier fixes, and fixes that interact badly. |

Tell the user in one line what's running. Don't predict the results.

### Triage each finding as it arrives

Drop a finding, and record why in the ledger, if any of these hold:

- **Pre-existing:** the base behaves the same.
- **Unreachable:** the other side of the boundary never produces the input. For example, no backend returns that status, no caller sends that value, or a DB constraint forbids it. Proofs that only work with a response shape the real system can't produce count as unreachable.
- **Intentional:** a commit message or a code comment shows the change was deliberate.
- **Cosmetic or nit.**
- **Not reproducible:** a realistic repro behaves correctly.

If a finding is a **behaviour change the user must decide on**, don't fix it. Give the options with a recommendation, mark it as a *decision* in the ledger, and carry on.

### Prove the survivors

- **Reproduce each one yourself**, or accept a reviewer's proof if it carries concrete evidence: a captured request or response, console text, DOM state, or a failing test's output.
- **What counts as proof:** you observed the wrong behaviour by running the real code. That can be the browser, a real request, or a test that drives the real path.
- **Forced failures:** when you need a failure you can't trigger for real, force it at the transport, e.g. rewrite the request URL, cut the network, or stop the dependency.
- **Mocks and stubbed responses:** acceptable only for behaviour the real dependency is known to have. Check its code.
- **Repro tests:** a failing test written as proof becomes the regression test (red before the fix, green after). The fixer owns it.

### Delegate fixes

- **Timing:** dispatch fixers once **every reviewer in the round has reported**. Edits made while reviewers are still reading shift their diff. On hot-reloading dev servers they also disturb the reviewers' browser checks.
- **Grouping:** one fixer per bug, or per cluster of bugs in the same files. Run fixers in parallel only when their files don't overlap, and tell each one which files it owns.
- **Fixer prompt** (template in `references/reviewer-brief.md`):
  - the proof;
  - what the base did;
  - the suspected cause with file:line, marked "verify";
  - constraints: a minimal root-cause fix, match the style, no commit or push;
  - **how to verify:** the exact original repro, the check commands, and "restore any data you change".
- **If a fix fails re-verification twice,** revert its files (`git checkout -- <files>`), mark the bug *open* in the ledger, and tell the user rather than looping on it.

### Re-verify, then close the round

1. **Re-prove each fix yourself** with the original repro. If a fixer only checked with synthetic input or a stubbed response, do one real check where you can, such as a real click or drag, or a real request.
2. **Run the whole-repo checks** (type-check, lint, unit tests) and compare against the baseline. If old tests now fail, read them first: some guard an earlier deliberate fix. In that case narrow your fix so both hold, rather than rewriting the test.
3. **Give the user a short update:** what was fixed, what was dropped and why, and what runs next.

## 2. Decide whether to loop

- **Run another round** if this one proved any real bug. Each fix can introduce a new bug, and each bug class usually has more instances.
- **Stop** when a round, including its working-tree review, comes back with nothing real. But don't stop before at least one targeted round has run (a class hunt, or a never-exercised-flows round). A clean broad round alone proves little.
- **Check in with the user after about 5 rounds** with a one-line cost and yield summary, and ask whether to continue. Stop at any time if the user says so.
- **If the user interrupts or redirects,** stop running agents (`TaskStop`), check `git status` for half-applied edits, and report them.

## 3. Guardrails

- **Shared harness.**
  - Parallel subagents share the same browser pane or machine. Browser users must `tabs_create` their own tab, pass `tabId` on every call, then close it and reset the viewport. The pane has a tab cap.
  - For compiled stacks, run builds one at a time or give fixers separate worktrees: parallel `dotnet build` and `cargo build` fight over output locks. Restart the running service after a fix, unless it's in watch mode.
  - In subagent briefs, mention that browser tools may need loading through ToolSearch, and that PowerShell works when Bash fails to spawn.
- **Dev-server reloads.**
  - A page that's stuck or blank while fixers are editing is probably a reload. Retry in a fresh tab before calling it a bug.
  - To test whether the branch itself causes something, use `git stash push -u`, test, then `git stash pop`. Only do this **when no fixer is running**, or you'll pull their edits out from under them.
- **Data.**
  - Change as little as possible, and revert right after proving or verifying.
  - Never confirm irreversible operations (merges, moves, deletes, sends, emails) unless you can undo them.
  - Prefer tests or a disposable database over shared data.
  - Log anything you couldn't restore, and tell the user.
- **Honesty.**
  - Use "proven", "reproduced", "not reproduced" and "static only" precisely.
  - Say what wasn't exercised, both in the report and in the PR.

## 4. Wrap up

Send a final report in plain language:

- bugs fixed, grouped by severity or area;
- decisions the user made;
- what wasn't exercised;
- test data the user needs to clean up;
- open or dropped items they might still care about.

The ledger has all of this.

If the user wants a PR, follow `references/pr-wrapup.md`: a new branch off the reviewed branch, area-grouped commits with their tests, and a PR into the reviewed branch with a fixes table. Use `pstack:make-pr-easy-to-review` if it's available.

Save one or two durable, non-obvious lessons to memory. Examples: which backends never return a status, or which kind of round found the most.
