# Round playbook

## What produced real bugs

This is from a 10-round loop on a 831-file branch that upgraded React 19, MUI v9 and React Router v8 and migrated Recoil to Zustand and TanStack Query. It found 20 real bugs.

- **Round 1, broad per-area:** 11 candidates, 1 real. Most were pre-existing, unreachable or intentional.
- **Round 2, narrower flow tracing:** 4 real. These were in URL-synced table state, nested drawers merging into a parent store, and bulk actions looping an undoable mutation.
- **Round 3, a class hunt for each bug found:** 6 real. The worst of the loop, cross-tab pages hanging, turned up while *proving* another finding, because many tabs were open.
- **Rounds 4–9, working-tree review plus never-exercised flows plus fresh angles:** 1–2 real each. Some were bugs in earlier fixes. Others were found by finally driving rewritten shared components (drag-reorder, typeahead). Some came from library-swap semantics (moment → dayjs format tokens, TanStack's offline mutation default) and render-time throws.
- **Round 10:** clean, so the loop stopped.

The lesson: after round 1, stop sweeping by directory. Aim reviewers at **mechanisms**.

A lesson on test conditions: the cross-tab hang only appeared because many app tabs were open. Unusual but realistic environments (several tabs, offline, slow backend, a stale cache from an older version) are worth a round of their own.

## Bug classes worth a dedicated hunt

These classes come from a React frontend upgrade. For other stacks, seed round 3 from what you actually found. Backend starters: changed DI lifetimes, ORM tracking or query changes (N+1, lazy loading, tracking versus no-tracking), a lost `[Authorize]` or other auth attribute, unawaited tasks, serialization casing and null handling, route or model-binding changes, and transaction scope.

Add to this list as you find new ones. The frontend classes:

- **Controlled state moved into props:** a page or sort value held by a parent isn't reset on Clear or on a new search.
- **URL ↔ state sync:** decoding restores an id but not the label (a blank picker while the filter is still applied); asymmetric encode and decode; unvalidated values; Clear not updating the URL.
- **Nested drawer writes into a parent store:** the parent's baseline comes from a refetch, so the parent shows as falsely dirty, or real edits are lost on return.
- **Unsaved-changes baseline:** re-baselined from a stale render closure; not re-baselined after server refreshes (status actions, save response); a restored draft treated as clean; Discard leaving the draft behind.
- **Save error handling:** a function that catches and only logs, so callers treat the failure as success; the dialog navigates away; the asterisk clears.
- **Toasts:** a global error listener plus a local catch giving double toasts; bulk loops giving a toast per item; de-dupe hiding a repeat that's collapsed in the stack.
- **Cross-tab storage:** a write-through with changing timestamps plus a `storage` handler that always sets new state, so tabs ping-pong forever. That starves low-priority React renders (Suspense retries), so pages hang on the spinner.
- **Setting state during render:** parent callbacks (`getOptions`, `onLoaded`, `errorFunc`) called in render-phase blocks. Look for "Cannot update a component while rendering a different component".
- **Render-time throws on external data:** exhaustive `never` switches that throw, `JSON.parse('')`, non-null assertions on server data. The base usually had a fallback.
- **Library default changes:** TanStack mutation `networkMode`, `staleTime` caching old records into drawers, dayjs versus moment tokens (`yyyy` prints literally, parsing needs `customParseFormat`), router blocker semantics.
- **Rewritten shared components:** drag-reorder index conversion (up correct, down off by one), keyboard versus mouse pick in autocompletes, windowed versus native lists.
- **Lazy routes and error boundaries:** a cached rejected `React.lazy` means "Try again" never recovers.

## Stopping rule

Stop when a round's reviewers, including the working-tree reviewer, return nothing that survives triage and proof. One quiet reviewer isn't enough: the rest of the round must be clean too. Don't stop before at least one targeted round (class hunt, or never-exercised flows) has run. Check in with the user after about 5 rounds.
