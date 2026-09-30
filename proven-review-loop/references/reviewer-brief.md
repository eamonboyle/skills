# Reviewer and fixer briefs

Copy and fill these in. Keep the "report only" and "don't edit" lines: without them, reviewers pad the list with nits or start fixing things.

## Reviewer brief

```
<repo path>, branch <branch> vs <base>. Scope: <paths or lens>.
Context: <one line on what the branch does, e.g. "upgrades React 19 / MUI v9 / Router v8, migrates Recoil → Zustand + TanStack Query">.
Already fixed (don't re-report): <ledger lines>. Already dropped, with the reason (don't re-report): <ledger lines>. Go deeper than the surface.

Method: <lens-specific instructions: trace these flows end to end / hunt this bug class / drive these pages in the browser>.
Compare suspicious behaviour with the base (`git show <base>:<path>`) to confirm it's a regression, or a bug in new code.

Report ONLY real bugs that a user or caller would see: wrong data sent or stored, stale or lost state, crashes, hangs, stuck UI, wrong status codes or response bodies, auth gaps, silent failures where the base gave feedback. NO style, naming, refactor, nit or test-coverage findings. If unsure, leave it out.
For each finding: file:line, what breaks, the exact repro (UI steps at <app URL>, a request, or a test), expected vs actual, and evidence if you ran it.
Do NOT edit files. Max ~6 findings, highest confidence first.
If you use the browser: create your OWN tab (tabs_create), pass tabId on EVERY call, restore any data you change, close the tab and reset the viewport when done. Browser tools may need loading via ToolSearch first. If Bash fails to spawn, use PowerShell.
```

## Fixer brief

```
<repo path>, branch <branch>. Do NOT commit or push. Only edit <files>; other agents are editing <files>, so don't touch them.

Proven bug: <exact repro (UI steps, request, or test) and the observed evidence: request or response body, console error, DOM text, test output>. On <base> it <did X>.
Suspected cause (verify): <file:line and mechanism>.

Fix at the root, minimally, matching the surrounding style. <Requirements, e.g. "real unsaved edits must still be preserved">. Check other callers of anything you change.

Verify with the original repro: <browser steps (own tab via tabs_create; pass tabId on EVERY call; close it after) / request / test command>, and the expected result. If a failing repro test exists, keep it as the regression test: red before the fix, green after. Restore any data you change.
Run <type-check>, <lint on changed files> and <relevant tests>. Report the diff and the evidence.
```

## Lens snippets

- **Flow tracing:** "Pick the main user flows (search, open drawer, edit and save, delete, merge, back). For each, trace what state is read, what request is sent (path, method, body), what is invalidated afterwards, and what the user sees on success, on error, and on reopen or back."
- **Store migration:** "For each new store that replaced an old atom or context, check that the defaults match, that per-user data is cleared on logout, that selectors don't return new objects every render, and that derived state is computed the same way."
- **Silent failure:** "For every mutation followed by UI changes (close drawer, navigate, clear selection, success toast), check what happens on a 400 with a server message, a 500 with no body, and a network error. Force the failures by rewriting request URLs in the page."
- **Class hunt:** "Bug X was just found (<one-line mechanism>) and fixed in <file>; don't re-report it. Find the rest of this bug class: <grep hints>."
- **Never-exercised flows:** "These were only reviewed statically. EXERCISE them in the running app: <pages and steps>. Report only what you observe."
- **Working-tree review:** "Review ONLY the uncommitted fixes (`git diff`, plus untracked files). Find bugs they introduce or fail to fix, and fixes that interact badly. List the risky scenarios to check."
