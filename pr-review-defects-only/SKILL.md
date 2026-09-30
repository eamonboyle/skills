---
name: pr-review-defects-only
description: Defects-only code review of a pull request, branch, or working diff. Flags only real problems (bugs, security holes, regressions and breaking changes, data loss or corruption, measurable performance issues, missing error handling that causes harm) and leaves working code alone - no refactors, style nits, renames, or "cleaner / more idiomatic" suggestions. Use this whenever the user asks to review a PR or PR number, review their branch, changes, or diff, check a PR for bugs before merge, sanity-check a change, or wants a go/no-go on a diff, even if they don't say "defects only". Not for refactoring or simplification passes, or architecture reviews where restructuring is the goal.
---

# PR Review - Defects Only

Review a PR for real problems only. Working code stays as it is unless something is actually broken or risky.

The reader wants one question answered: will anything break if this merges? Every non-defect comment costs them time to read, triage, and dismiss, and teaches them to skim, which is how real findings get missed. A short review that is all signal beats a long one that looks thorough.

**Core principle:** if you cannot name the exact input, state, or sequence that produces a wrong result, it is not a finding. Preference is not a defect.

## When to use

- Reviewing a pull request, branch, or working diff.
- The user wants defects surfaced, not a rewrite or a style pass.
- The code already works and should keep working, with only genuine risks flagged.

Not for: a refactoring or simplification pass, or an architecture review where restructuring is the goal.

## Procedure

### 1. Pick the base and get the diff

Diff against the current remote base, not a stale local copy. A stale base produces phantom findings (upstream commits that look like PR changes) and hides behavior the merge will actually produce.

Choose the base in this order:

1. Reviewing a GitHub PR: use the PR's own base branch - `gh pr view <n> --json baseRefName,headRefName,headRefOid`.
2. The user named a base: use it.
3. Otherwise: `staging` if `origin/staging` exists, else `main`, else `master`.

Then:

```
git fetch origin <base>
git diff origin/<base>...HEAD --stat
git diff origin/<base>...HEAD
git rev-list --count HEAD..origin/<base>    # greater than 0 means the branch is behind base
git rev-parse --short origin/<base>         # sha for the header
```

- If the branch is behind base, say so in the header. Findings may already be fixed upstream, or the merge may change behavior.
- If the user asked about uncommitted work, or `git status` shows uncommitted changes on the branch under review, also review `git diff HEAD` and note that uncommitted changes were included.
- If the PR is not the checked-out branch, do not check it out over the user's working tree without asking. Fetch it (`git fetch origin pull/<n>/head`) and read files at that commit with `git show <sha>:<path>`, or use `gh pr diff <n>`.
- If `gh` is unavailable or not authenticated, ask the user for the base branch rather than guessing.

### 2. Review the diff and its direct blast radius

Stay within the changed lines and what they directly touch: callers of changed code, callees whose contract the change relies on, data and schema that flow through the change, and config or DI registrations it depends on. Do not audit untouched code in the same file.

Where defects usually hide in a diff:

- **Changed signatures, return values, or semantics** - search for every caller and check each one still holds.
- **Removed or renamed things** - search for leftover references, including config, reflection, serialized names, raw SQL, and routes.
- **New conditions and branches** - walk the boundaries: null/undefined, empty, zero, negative, max, first and last item, duplicates.
- **Error paths** - what happens when the new call throws, times out, or returns nothing. Is state left half-written? Is a failure swallowed so the caller thinks it succeeded?
- **Concurrency** - shared state reachable from background jobs, parallel requests, or retries.
- **Schema and migrations** - dropped or narrowed columns, new non-null columns without a default, data that must be backfilled, irreversible steps.

Skim generated files (lock files, generated code, snapshot files, compiled output) only to confirm they match the source change.

### 3. Investigate suspicions before deciding

If something looks wrong but you can't yet state the failure, find out: read the caller, callee, route, or test. Drop it only once investigation shows the code is safe or the concern is pure speculation. Never drop a real suspicion just because confirming it takes work, and never report it unconfirmed either.

A conditional failure is reportable when the condition is concrete and realistic ("if the upstream API returns an empty list, line 40 throws"). State the condition as part of the failure.

### 4. Check each finding before writing it up

For every candidate finding, confirm all four:

1. You can name the trigger - the input, state, or sequence.
2. It can happen now, from the code as changed. A future-hypothetical doesn't count.
3. This diff introduced it or made it reachable or worse. Pre-existing issues in untouched code are out of scope.
4. The proposed fix is the smallest change that resolves it.

If any check fails, drop the finding or go back to step 3.

## What to report (priority order)

1. **Bugs and correctness** - logic errors, off-by-one, wrong conditions, unhandled null/undefined, race conditions, incorrect state updates.
2. **Security** - injection, exposed secrets, missing auth checks, unsafe input handling.
3. **Breaking changes and regressions** - anything that alters existing behavior callers depend on.
4. **Data loss or corruption risks.**
5. **Performance** - real and measurable, not theoretical (for example an N+1 inside a loop over unbounded rows, or an unindexed scan on a large table in a hot path).
6. **Missing error handling** where a failure would actually cause harm.

## What not to report

None of the following, unless it directly causes one of the six categories above:

- Style, formatting, or naming preferences.
- "This could be cleaner / more idiomatic / more elegant" suggestions.
- Refactors that restructure working code without changing behavior.
- Design-pattern swaps or abstraction changes on code that already works.
- Renaming variables, extracting functions, or reorganizing for taste.
- Adding tests, comments, or docs, unless the absence hides a real bug.
- Anything you would hedge with "not strictly necessary" or "consider maybe".

## Rules

- If the code works and is safe, say so plainly. An approval with zero findings is a valid, complete review.
- Rank findings by severity. Don't pad the list to look thorough.
- Never rewrite working code into a different structure. If you show a fix, make it the minimal change that resolves the specific defect.
- Match the conventions of the surrounding code. Don't impose a different style in a fix.
- Line numbers refer to the new version of the file.
- Don't post comments to GitHub unless the user asks. If they do, the same format and writing style apply.

## Severity

- **Critical** - data loss or corruption, a security hole, or a crash or outage on a common path.
- **High** - wrong results or a crash on a realistic path, or a breaking change for existing callers.
- **Medium** - wrong behavior on an edge case that will realistically occur, missing error handling with contained impact, or a measurable performance regression.
- **Low** - a real defect with a narrow trigger and small impact.

Verdict is CHANGES NEEDED if any finding is Medium or above. APPROVE if there are no findings or only Low ones.

## Output format

Produce exactly this shape:

```
Verdict: APPROVE | CHANGES NEEDED
Base compared: origin/<branch> @ <short-sha> (behind base? yes/no)
Checked: <one line - what you verified, and against what>

Findings (most severe first):
1. [severity] file:line - <one-line defect>
   Failure: <exact input/state/sequence that produces the wrong result>
   Minimal fix: <the smallest change that resolves it, or "none proposed">

(If none: "No defects found. Code works and is safe as written.")
```

The Checked line is there so an approval reads as a verified result rather than a rubber stamp, and so the author can see what the review covered. Keep it to one concrete line naming what you traced and what you compared it against, for example `Checked: date filter against both report callers and the spec in docs/reports.md; migration drops no columns that hold data.` Don't list every file you opened.

Optional last line, only for a Critical or High issue you came across in untouched code within the blast radius: `Pre-existing (not introduced here): file:line - <one line>`. Leave it out otherwise.

Example finding:

```
1. [High] src/Reports/SalesReport.cs:54 - The date filter uses `< to` where `to` has no time part, so the last day of the range is dropped.
   Failure: a report for 1-30 June with `to = 2026-06-30` excludes every sale made on 30 June.
   Minimal fix: `o.CreatedAt < to.AddDays(1)`.
```

## Writing style

This applies to every review, including anything posted to a GitHub PR. Colleagues read these reviews, and text that sounds machine-written gets discounted or ignored.

- Never use em-dashes or en-dashes. Use a plain hyphen (-).
- Write like a terse human engineer reviewing a colleague's code.
- No praise padding ("Great work!"), no "Let me...", no "I've analyzed...", no emoji, no headers restating the obvious, no hedging filler ("it's worth noting", "as a best practice"), no summary of the summary.
- State what breaks, when it breaks, and the fix. Cut every word that carries no information.
- Don't sign off as, or refer to yourself as, an AI, a model, an assistant, or a review tool.

## Red flags - you are about to report a non-defect

Stop if you catch yourself writing any of these. They mean you are suggesting a change for its own sake:

- "This would be cleaner if..."
- "Consider extracting / renaming / restructuring..."
- "It works, but a more idiomatic approach would be..."
- "Not strictly necessary, but..."
- "For consistency you could..."
- You are proposing a fix but cannot name the input that breaks the current code.

## Common mistakes

| Mistake | Correction |
|---------|------------|
| Flagging a refactor because it "would prevent future bugs" | A future-hypothetical is not a current defect. Only flag a bug that can happen now, with the trigger named. |
| Reviewing the whole file | Stay within the diff and its direct blast radius. |
| Padding an approval with minor suggestions | Zero findings is a valid, complete review. |
| Rewriting a working block to show a fix | Show the minimal targeted change, or propose no code. |
| Diffing against a stale local base | Fetch first, then diff against `origin/<base>`. |
| Reporting a pre-existing issue as if the PR caused it | Check the change introduced it or made it reachable. Otherwise leave it out, or use the optional pre-existing line if it is Critical or High. |
| Dropping a suspicion because you can't immediately state the failure | Investigate first. Drop it only after confirming the code is safe, not because confirming took effort. |
