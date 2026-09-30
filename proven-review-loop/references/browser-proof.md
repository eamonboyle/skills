# Browser proof techniques

These work with the built-in browser tools (`mcp__Claude_Browser__*`): `javascript_tool`, `read_network_requests` (pass `requestId` to get a response body), `read_console_messages` (`onlyErrors`), `find`, `read_page`, `computer`.

## Etiquette

- Use your own tab: `tabs_create`, then pass `tabId` on every call. Front it with `tabs_select` if it matters, because background tabs are throttled.
- The dev server can take 10–40 seconds to load a page cold. Poll for a known element in `javascript_tool` (for example, loop until a button with the text "Search" exists) rather than taking screenshots repeatedly. Keep each script under the tool's roughly 45-second timeout.
- If a page hangs or is blank, first rule out HMR from a fixer's edits and the tab count (see "Hung pages" below).

## Capture what the app sends

```js
window.__bodies = [];
const O = XMLHttpRequest.prototype.open, S = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function (m, u, ...r) { this.__m = m; this.__u = String(u); return O.call(this, m, u, ...r); };
XMLHttpRequest.prototype.send = function (b) {
  if (/movehistory\/table/.test(this.__u)) { window.__bodies.push(b); this.addEventListener('loadend', () => window.__bodies.push('status ' + this.status)); }
  return S.call(this, b);
};
```

Patch after the page has loaded, then trigger the action in the same script (for example, click a button by its text) and read `window.__bodies`. A full page load wipes the patch.

## Force a failure through a real code path

- **404 with no message:** rewrite the URL in `open`, for example `u = u.replace(/MusicCueSheet\/\d+/, 'MusicCueSheet/__forcefail__')`.
- **400 with a server message:** redirect the request to an endpoint that validates and rejects the body (for example, POST a task body to a create-production endpoint). This exercises the real server-message path.
- **Offline:** `window.dispatchEvent(new Event('offline'))`, then `'online'`. Query libraries listen for these events.
- **Stubbed response shape** (only when the backend code proves it sends that shape): on the instance, override `responseText`, `response` and `status` with `Object.defineProperty`.

## Count and inspect

- **Storage ping-pong:** add a `storage` event listener and count events over 3 seconds. Thousands means a loop.
- **Toasts:** use a `MutationObserver` on `document.body` and collect the `innerText` of added nodes, because toasts disappear fast. Or read the toast store directly: importing a Vite module gives a **separate instance** unless you use the page's current `?t=` suffix, so prefer the DOM.
- **Tooltips:** real hover (`computer` hover), then read the text of `[role=tooltip]`. You can also read the `aria-label` on the trigger.
- **Dirty state:** read the drawer or page heading text and look for a trailing `*`.
- **React warnings:** use `read_console_messages` with `onlyErrors`. Clear context by reloading before a repro so old errors don't mislead you.

## Hung pages (Suspense starvation and render loops)

1. Find the element with `[aria-busy=true]`. Walk up from its `__reactFiber$…` key via `.return` to see which lazy or Suspense boundary it sits under.
2. Check the `React.lazy` payload (`_payload._status === 1` means resolved). If it's resolved but still showing the fallback, React is starving or looping.
3. Sample `suspenseFiber.alternate.child.child` every 100ms. A new object each time means the work-in-progress render keeps restarting.
4. Find what's restarting it: count `storage` events and timers (wrap `setTimeout`, `setInterval` and `requestAnimationFrame`), and look for "Cannot update a component" warnings.
5. Isolate: close other tabs, hard-reload, and stash the working tree to see whether the branch itself causes it.

## Input quirks

- The harness `type` action inserts text without keyup. Components that search on keyup need real `key` presses (for example `key "Backspace u"`) to fire. Don't report that as a bug.
- A scripted `.click()` doesn't blur the focused field. Fields that commit on blur then send stale values. Use a real `computer` click for saves.
- MUI menu items go stale between separate tool calls. Open the menu and click the item in one `javascript_tool` script: find `[role=menuitem]` by its text.
