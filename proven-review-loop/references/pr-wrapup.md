# PR wrap-up

Do this only when the user asks for a branch or PR. The request itself authorises the commit and push.

1. **Match the house style.** Look at earlier fix branches and PRs for naming and structure (`git branch -a --list "*review*"`, `gh pr view <n> --json title,body`), and follow them. For example: branch `fix/<ticket>-pr-review-findings-N`; PR title "<ticket>: fix defects from the Nth review loop on #<pr>".
2. **Get everything green first.** Run type-check, lint and the unit tests. If old tests fail:
   - Read them. A test may guard an earlier deliberate fix. For example, "two identical success toasts both show" conflicted with a toast de-dupe, so the de-dupe was narrowed to error toasts.
   - Otherwise update the test to the new contract.
   - Add small behavioural tests for the fixed bugs, delegated to a subagent, then confirm the results yourself.
3. **Branch** off the reviewed branch: `git switch -c <branch>`.
4. **Commit by area**, one logical fix group per commit, each with its tests. Use the repo's message style, e.g. `fix(area): <what the user saw> ` plus a one-paragraph body on the cause and the fix. Before pushing, check the tree is clean and that `git diff --stat <base-commit> HEAD` matches the expected file count.
5. **Push** with `-u`, then open the PR **into the reviewed branch**. Write the body to a scratch file and use `gh pr create --body-file`. The body contains:
   - An opening line on which loop this is and the target branch.
   - **TL;DR:** the count of fixes and commits, how they were verified, and the worst one.
   - **Fixes table:** Sev | Area | Problem | Fix. Note any row that wasn't proven by running the real code.
   - **Agreed behaviour changes** the user decided on.
   - **Reviewer guide:** the files worth a close look, the mechanical files, and any new files.
   - **Behaviour changes to be aware of.**
   - **Testing:** the commands and counts, the new tests, and what wasn't exercised by running.
   - **Known and not fixed:** pre-existing or unreachable issues.
6. After creating the PR, bind or check it with the session's PR tools if they exist. Report CI status, and offer auto-fix rather than polling CI yourself.
