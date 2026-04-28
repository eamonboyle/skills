/**
 * Generic narrative interactive PR canvas generator for Cursor IDE.
 * Reads a unified diff + JSON specs → emits a single .canvas.tsx with embedded chunks.
 *
 * Usage (cwd = skill directory, or pass full path to this file):
 *   node scripts/generate-interactive-pr-canvas.mjs --pr 11 --specs - < /tmp/pr-11-specs.json
 *   node scripts/generate-interactive-pr-canvas.mjs --diff /tmp/pr.diff --specs ./review-specs.json
 *
 * Stdin:
 *   --specs -  reads specs JSON from stdin (keeps specs out of the repo; use /tmp or a pipe).
 *   --diff -   reads unified diff from stdin (cannot combine with --specs -; use --pr for diff).
 *
 * Env:
 *   INTERACTIVE_PR_CANVAS_DIFF        — default diff path (default: /tmp/interactive-pr-canvas.diff)
 *   INTERACTIVE_PR_CANVAS_SPECS       — default specs JSON path
 *   INTERACTIVE_PR_CANVAS_SPECS_JSON  — inline specs JSON (skip --specs; avoids any specs file)
 *   CURSOR_CANVAS_OUT                 — output file (overrides default below)
 *   CURSOR_PROJECT_SLUG               — ~/.cursor/projects/<slug>/canvases/ when --out omitted
 *
 * Specs JSON — either:
 *   [ chapter, ... ]  or  { "meta": { ... }, "chunks": [ ... ] }
 *
 * Chapter object:
 *   { headline, takeaway, files: [ { path, start?, end? }, ... ] }
 * Legacy single-file chapter:
 *   { headline, takeaway, path, start?, end? }
 *
 * Meta fields (all optional except as noted):
 *   pr — PR number string/int for default paths/titles/state keys when omitted elsewhere
 *   title, prUrl, stateKey, introSuffix,
 *   footerStats: [{ value, label }],
 *   componentName — valid JS identifier for default export (default: InteractivePrReviewCanvas)
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const DEFAULT_DIFF = "/tmp/interactive-pr-canvas.diff";
const STRIP_DEFAULT = 7500;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--include-tests") out.includeTests = true;
    else if (a === "--diff") {
      out.diff = argv[++i];
      out.diffExplicit = true;
    } else if (a === "--specs") out.specs = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--pr") out.pr = argv[++i];
    else if (a === "--project-slug") out.projectSlug = argv[++i];
    else if (a === "--strip") out.strip = Number(argv[++i]);
    else console.warn("Unknown arg:", a);
  }
  return out;
}

function gitWorkspaceSlug(cwd = process.cwd()) {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
    }).trim();
    return path.basename(root);
  } catch {
    return path.basename(cwd);
  }
}

function readStdinUtf8() {
  return fs.readFileSync(0, "utf8");
}

/** @param {string} raw */
function parseSpecsJson(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return { meta: {}, chunks: parsed };
  }
  const chunks = parsed.chunks ?? parsed.specs;
  if (!Array.isArray(chunks)) {
    throw new Error("Specs must be an array or include chunks/specs array");
  }
  return { meta: parsed.meta ?? {}, chunks };
}

function loadSpecsFromPath(specPath) {
  const raw = fs.readFileSync(specPath, "utf8");
  return parseSpecsJson(raw);
}

/**
 * Unified diff text for the PR. Uses gh in PATH.
 * @param {string} prRef — number, branch, or URL accepted by `gh pr diff`
 */
function diffFromGh(prRef) {
  const ref = String(prRef).trim();
  if (!ref) throw new Error("Empty --pr ref");
  try {
    return execFileSync("gh", ["pr", "diff", ref], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`gh pr diff failed (${ref}): ${msg}`);
  }
}

function skipPath(relPath, includeTests) {
  if (relPath.includes("/issues/") || /^issues\//.test(relPath)) return true;
  if (relPath.includes("drizzle/meta/") && relPath.endsWith("_snapshot.json"))
    return true;
  if (!includeTests && /\.test\.tsx?$/.test(relPath)) return true;
  return false;
}

function parseChunkLines(chunkLines) {
  const out = [];
  for (const line of chunkLines) {
    if (!line.length && out.length) {
      out.push({ type: "unchanged", content: "" });
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("diff --git")) continue;
    if (line.startsWith("index ")) continue;
    if (line.startsWith("@@")) {
      out.push({ type: "unchanged", content: line });
      continue;
    }
    if (line.startsWith("+"))
      out.push({ type: "added", content: line.slice(1) });
    else if (line.startsWith("-"))
      out.push({ type: "removed", content: line.slice(1) });
    else if (line.startsWith(" "))
      out.push({ type: "unchanged", content: line.slice(1) });
    else if (line.startsWith("\\"))
      out.push({ type: "unchanged", content: line });
    else out.push({ type: "unchanged", content: line });
  }
  return out;
}

function statsFor(lines) {
  let additions = 0;
  let deletions = 0;
  for (const l of lines) {
    if (l.type === "added") additions += 1;
    else if (l.type === "removed") deletions += 1;
  }
  return { additions, deletions };
}

function loadFilesMap(raw, includeTests) {
  const sections = raw.split(/^diff --git /m).filter(Boolean);
  const byPath = {};
  for (const sec of sections) {
    const firstLine = sec.split("\n")[0];
    const m = firstLine.match(/^a\/(.+?) b\/(.+)$/);
    const relPath = m ? m[2].trim() : firstLine.trim();
    if (skipPath(relPath, includeTests)) continue;
    const lines = ("diff --git " + sec).split("\n").slice(1);
    byPath[relPath] = parseChunkLines(lines);
  }
  return byPath;
}

/**
 * @param {Record<string, ReturnType<parseChunkLines>>} byPath
 * @param {string} path
 * @param {number} [start]
 * @param {number} [end]
 * @param {string} label - for error messages
 */
function sliceDiffForPath(byPath, path, start, end, label) {
  const all = byPath[path];
  if (!all) {
    console.error("Missing path in diff:", path, label);
    process.exit(1);
  }
  const s = start ?? 0;
  const e = end ?? all.length;
  const lines = all.slice(s, e);
  if (lines.length === 0) {
    console.error("Empty slice:", path, s, e, label);
    process.exit(1);
  }
  const { additions, deletions } = statsFor(lines);
  return { path, lines, additions, deletions };
}

/**
 * @param {object} spec
 * @param {number} idx
 * @returns {{ path: string, start?: number, end?: number }[]}
 */
function fileSpecsFromChapterSpec(spec, idx) {
  if (
    spec.headline === undefined ||
    spec.headline === null ||
    spec.takeaway === undefined
  ) {
    throw new Error(`Invalid spec at index ${idx}: need headline, takeaway`);
  }
  if (Array.isArray(spec.files) && spec.files.length > 0) {
    return spec.files.map((f, j) => {
      if (!f || !f.path) {
        throw new Error(`Invalid spec at index ${idx}, files[${j}]: need path`);
      }
      return { path: f.path, start: f.start, end: f.end };
    });
  }
  if (spec.path) {
    return [{ path: spec.path, start: spec.start, end: spec.end }];
  }
  throw new Error(
    `Invalid spec at index ${idx}: need non-empty files[] or legacy path (with headline, takeaway)`
  );
}

function stringValue(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeCalloutTone(tone) {
  return ["info", "success", "warning", "danger", "neutral"].includes(tone)
    ? tone
    : "info";
}

function normalizeCallouts(callouts) {
  if (!Array.isArray(callouts)) return undefined;
  const normalized = callouts
    .map((callout) => {
      if (!callout || typeof callout !== "object") return undefined;
      const body = stringValue(callout.body ?? callout.text);
      if (!body) return undefined;
      return {
        tone: normalizeCalloutTone(callout.tone),
        title: stringValue(callout.title) ?? "Review note",
        body,
      };
    })
    .filter(Boolean);
  return normalized.length ? normalized : undefined;
}

function normalizePseudocode(pseudocode) {
  if (Array.isArray(pseudocode)) {
    return stringValue(pseudocode.map((line) => String(line)).join("\n"));
  }
  return stringValue(pseudocode);
}

function normalizeTrace(trace) {
  if (typeof trace === "string") {
    const body = stringValue(trace);
    return body ? { title: "Example trace", body } : undefined;
  }
  if (!trace || typeof trace !== "object") return undefined;
  const body = stringValue(trace.body ?? trace.text);
  if (!body) return undefined;
  return {
    title: stringValue(trace.title) ?? "Example trace",
    body,
  };
}

function normalizeMechanicalSummary(summary) {
  if (!summary || typeof summary !== "object" || !Array.isArray(summary.rows))
    return undefined;
  const rows = summary.rows
    .filter(Array.isArray)
    .map((row) => row.map((cell) => String(cell)))
    .filter((row) => row.length > 0);
  if (!rows.length) return undefined;
  const headers = Array.isArray(summary.headers)
    ? summary.headers.map((header) => String(header)).filter(Boolean)
    : undefined;
  return {
    ...(headers?.length ? { headers } : {}),
    rows,
  };
}

function reviewAidsFromSpec(spec) {
  const callouts = normalizeCallouts(spec.callouts);
  const pseudocode = normalizePseudocode(spec.pseudocode);
  const trace = normalizeTrace(spec.trace);
  const mechanicalSummary = normalizeMechanicalSummary(spec.mechanicalSummary);

  return {
    ...(callouts ? { callouts } : {}),
    ...(pseudocode ? { pseudocode } : {}),
    ...(trace ? { trace } : {}),
    ...(mechanicalSummary ? { mechanicalSummary } : {}),
  };
}

function sanitizeExportName(name) {
  const s = String(name).replace(/[^a-zA-Z0-9_$]/g, "_");
  if (/^[0-9]/.test(s)) return "_" + s;
  return s || "InteractivePrReviewCanvas";
}

function renderFooterStats(stats) {
  if (!stats?.length) return "";
  const lines = stats
    .map(
      (s) =>
        `        <Stat value={${JSON.stringify(String(s.value))}} label={${JSON.stringify(String(s.label))}} />`
    )
    .join("\n");
  return `
      <H2>At a glance</H2>
      <Grid columns={3} gap={14}>
${lines}
      </Grid>`;
}

/** JSX snippet for intro line under H1 */
function introParagraphJsx(meta) {
  const title = meta.title ?? "PR narrative review";
  const prUrl = meta.prUrl ?? "";
  const suffix = meta.introSuffix ?? "";

  if (prUrl && suffix) {
    return `<Link href={${JSON.stringify(prUrl)}}>{${JSON.stringify(title)}}</Link>
          {" · "}
          {${JSON.stringify(suffix)}}`;
  }
  if (prUrl) {
    return `<Link href={${JSON.stringify(prUrl)}}>{${JSON.stringify(title)}}</Link>`;
  }
  if (suffix) {
    return `{${JSON.stringify(suffix)}}`;
  }
  return `{${JSON.stringify(title)}}`;
}

export function buildCanvasTsx({ chunksPayload, meta, stripLen }) {
  const json = JSON.stringify(chunksPayload);
  const b64 = Buffer.from(json, "utf8").toString("base64");
  const parts = [];
  for (let i = 0; i < b64.length; i += stripLen)
    parts.push(b64.slice(i, i + stripLen));
  const partLiterals = parts.map((p) => JSON.stringify(p)).join(",\n");

  const stateKey = meta.stateKey ?? "interactive-pr-narrative-chunks";
  const exportName = sanitizeExportName(
    meta.componentName ?? "InteractivePrReviewCanvas"
  );
  const footerBlock = renderFooterStats(meta.footerStats);
  const introInner = introParagraphJsx(meta);
  const footerImports = footerBlock
    ? `  Divider,\n  Grid,\n  H2,\n  Stat,\n`
    : "";

  const ts = `import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Code,
  DiffStats,
  DiffView,
${footerImports}  H1,
  H3,
  Link,
  Pill,
  Row,
  Spacer,
  Stack,
  Table,
  Text,
  mergeStyle,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";
import type { DiffLineData } from "cursor/canvas";
import { useEffect, useRef } from "react";

type ChapterFile = {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLineData[];
};

type ChapterCallout = {
  tone?: "info" | "success" | "warning" | "danger" | "neutral";
  title: string;
  body: string;
};

type ChapterTrace = {
  title?: string;
  body: string;
};

type MechanicalSummary = {
  headers?: string[];
  rows: string[][];
};

type ReviewChapter = {
  headline: string;
  takeaway: string;
  files: ChapterFile[];
  callouts?: ChapterCallout[];
  pseudocode?: string;
  trace?: ChapterTrace;
  mechanicalSummary?: MechanicalSummary;
};

function decodeReviewChaptersFromBase64(b64: string): ReviewChapter[] {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes)) as ReviewChapter[];
}

const CHUNK_B64_PARTS: readonly string[] = [
${partLiterals}
];

const REVIEW_CHAPTERS = decodeReviewChaptersFromBase64(CHUNK_B64_PARTS.join(""));

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

/** First @@ hunk in the excerpt → new-file line range label for the chrome strip. */
function focusRangeLabel(lines: DiffLineData[]): string {
  for (const row of lines) {
    if (row.type !== "unchanged") continue;
    const c = row.content;
    if (!c.startsWith("@@")) continue;
    const m = c.match(/@@\\s*-\\d+(?:,\\d+)?\\s+\\+(\\d+)(?:,(\\d+))?\\s+@@/);
    if (m) {
      const start = Number.parseInt(m[1], 10);
      const count = m[2] ? Number.parseInt(m[2], 10) : 1;
      const end = start + Math.max(0, count - 1);
      return start === end ? "L" + String(start) : "L" + String(start) + "–L" + String(end);
    }
  }
  return "";
}

function excerptText(lines: DiffLineData[]): string {
  return lines.map((r) => (r.type === "added" ? "+" : r.type === "removed" ? "-" : " ") + r.content).join("\\n");
}

function takeawayLines(text: string): string[] {
  return text
    .split(/\\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function calloutTone(tone: ChapterCallout["tone"]): ChapterCallout["tone"] {
  return tone === "success" || tone === "warning" || tone === "danger" || tone === "neutral" ? tone : "info";
}

function renderPreformattedReviewBlock(
  label: string,
  body: string,
  theme: ReturnType<typeof useHostTheme>,
) {
  return (
    <Stack gap={6}>
      <Text tone="tertiary" size="small" weight="semibold">
        {label}
      </Text>
      <Text
        tone="secondary"
        size="small"
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          whiteSpace: "pre-wrap",
          background: theme.fill.tertiary,
          padding: 10,
          borderRadius: 6,
          border: "1px solid " + theme.stroke.secondary,
          lineHeight: 1.45,
        }}
      >
        {body}
      </Text>
    </Stack>
  );
}

function renderChapterReviewAids(chapter: ReviewChapter, theme: ReturnType<typeof useHostTheme>) {
  const hasAids =
    Boolean(chapter.callouts?.length) ||
    Boolean(chapter.pseudocode) ||
    Boolean(chapter.trace?.body) ||
    Boolean(chapter.mechanicalSummary?.rows.length);

  if (!hasAids) return null;

  return (
    <Stack gap={10} style={{ flexShrink: 0 }}>
      {chapter.callouts?.map((callout, i) => (
        <Callout key={String(i)} tone={calloutTone(callout.tone)} title={callout.title}>
          <Stack gap={4}>
            {takeawayLines(callout.body).map((line, j) => (
              <Text key={String(j)} tone="secondary" size="small" style={{ lineHeight: 1.4 }}>
                {line}
              </Text>
            ))}
          </Stack>
        </Callout>
      ))}

      {chapter.pseudocode ? renderPreformattedReviewBlock("Pseudocode", chapter.pseudocode, theme) : null}

      {chapter.trace?.body ? (
        <Stack gap={6}>
          <Text tone="tertiary" size="small" weight="semibold">
            {chapter.trace.title ?? "Example trace"}
          </Text>
          <Stack gap={4}>
            {takeawayLines(chapter.trace.body).map((line, i) => (
              <Text key={String(i)} tone="secondary" size="small" style={{ lineHeight: 1.45 }}>
                {line}
              </Text>
            ))}
          </Stack>
        </Stack>
      ) : null}

      {chapter.mechanicalSummary?.rows.length ? (
        <Stack gap={6}>
          <Text tone="tertiary" size="small" weight="semibold">
            Mechanical summary
          </Text>
          <Table
            headers={
              chapter.mechanicalSummary.headers?.length
                ? chapter.mechanicalSummary.headers
                : ["Path", "Role"]
            }
            rows={chapter.mechanicalSummary.rows}
            framed
            striped
          />
        </Stack>
      ) : null}
    </Stack>
  );
}

export default function ${exportName}() {
  const theme = useHostTheme();
  const total = REVIEW_CHAPTERS.length;
  const [chapterIdx, setChapterIdx] = useCanvasState(${JSON.stringify(stateKey)}, 0);
  const [fileIdx, setFileIdx] = useCanvasState(${JSON.stringify(`${stateKey}::file`)}, 0);
  const safeChapter = Math.min(Math.max(0, chapterIdx), Math.max(0, total - 1));
  const chapter = REVIEW_CHAPTERS[safeChapter];
  const fileCount = chapter?.files.length ?? 0;
  const safeFile = Math.min(Math.max(0, fileIdx), Math.max(0, fileCount - 1));
  const fileEntry = chapter?.files[safeFile];
  const focusLabel = fileEntry ? focusRangeLabel(fileEntry.lines) : "";
  const pad = (n: number) => String(n).padStart(2, "0");

  const navRef = useRef({ chapter: safeChapter, files: fileCount });
  navRef.current = { chapter: safeChapter, files: fileCount };

  const prevChapterRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevChapterRef.current !== null && prevChapterRef.current !== safeChapter) {
      setFileIdx(0);
    }
    prevChapterRef.current = safeChapter;
  }, [safeChapter, setFileIdx]);

  function goChapter(delta: number) {
    setChapterIdx((prev) => Math.min(Math.max(0, prev + delta), Math.max(0, total - 1)));
  }

  function copyExcerpt() {
    if (!fileEntry || typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(excerptText(fileEntry.lines));
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName ?? "";
      if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;

      const { files: fc } = navRef.current;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setChapterIdx((prev) => Math.max(0, prev - 1));
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setChapterIdx((prev) => Math.min(Math.max(0, total - 1), prev + 1));
        return;
      }

      if (fc > 1) {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setFileIdx((prev) => Math.max(0, prev - 1));
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setFileIdx((prev) => Math.min(fc - 1, prev + 1));
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [total, setChapterIdx, setFileIdx]);

  const shellStyle = mergeStyle(
    {
      width: "100%",
      minHeight: "100%",
      boxSizing: "border-box",
      background: theme.bg.chrome,
      color: theme.text.primary,
    },
    { paddingBottom: 24 },
  );

  const segmentRowStyle = mergeStyle(
    {
      display: "flex",
      gap: 3,
      marginTop: 10,
      width: "100%",
    },
    { minHeight: 3 },
  );

  return (
    <div style={shellStyle}>
      <div
        style={mergeStyle(
          {
            padding: "14px 20px 12px",
            borderBottom: "1px solid " + theme.stroke.secondary,
            background: theme.bg.elevated,
          },
          {},
        )}
      >
        <Row gap={12} align="center" wrap style={{ rowGap: 8 }}>
          <Text
            weight="semibold"
            size="small"
            style={{
              letterSpacing: "0.12em",
              fontSize: 11,
              color: theme.text.secondary,
            }}
          >
            GUIDED REVIEW
          </Text>
          <Text tone="tertiary" size="small">
            {" "}
            · Chapter {safeChapter + 1} of {total}
          </Text>
          <Spacer />
          <Row
            gap={6}
            align="center"
            wrap
            style={{
              flex: "1 1 220px",
              justifyContent: "flex-end",
              minWidth: 0,
              rowGap: 4,
              color: theme.text.secondary,
              fontSize: 12,
              lineHeight: "16px",
            }}
          >
            ${introInner}
          </Row>
        </Row>
        <div style={segmentRowStyle} aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                background: i <= safeChapter ? theme.accent.primary : theme.fill.tertiary,
                opacity: i === safeChapter ? 1 : i < safeChapter ? 0.45 : 0.9,
              }}
            />
          ))}
        </div>
      </div>

      <Grid
        columns="minmax(260px, 0.42fr) minmax(0, 1fr)"
        gap={0}
        style={{
          alignItems: "stretch",
          height: "clamp(420px, 72vh, 760px)",
          borderBottom: "1px solid " + theme.stroke.tertiary,
          overflow: "hidden",
        }}
      >
        <Stack
          gap={16}
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "22px 20px 20px",
            borderRight: "1px solid " + theme.stroke.tertiary,
            background: theme.bg.editor,
            minWidth: 0,
            height: "100%",
            maxHeight: "100%",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div style={{ flexShrink: 0 }}>
            <Text
              tone="quaternary"
              size="small"
              weight="semibold"
              style={{ letterSpacing: "0.14em", fontSize: 10 }}
            >
              CHAPTER {pad(safeChapter + 1)}
            </Text>
            <H1 style={{ margin: "12px 0 0", lineHeight: 1.25 }}>{chapter?.headline ?? "—"}</H1>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <Stack gap={8} style={{ flexShrink: 0 }}>
              {takeawayLines(chapter?.takeaway ?? "").map((line, i) => (
                <Text key={String(i)} tone="secondary" size="small" style={{ lineHeight: 1.45 }}>
                  {line}
                </Text>
              ))}
            </Stack>
            {chapter ? renderChapterReviewAids(chapter, theme) : null}
            <div style={{ flexShrink: 0 }}>
              <H3 style={{ margin: "0 0 10px", color: theme.text.tertiary, fontSize: 11, letterSpacing: "0.1em" }}>
                FILES IN THIS CHAPTER
              </H3>
              {chapter ? (
                <Stack gap={6}>
                  {chapter.files.map((f, i) => {
                    const active = i === safeFile;
                    return (
                      <div
                        key={f.path + ":" + String(i)}
                        role="button"
                        tabIndex={0}
                        onClick={() => setFileIdx(i)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            setFileIdx(i);
                          }
                        }}
                        style={{
                          borderRadius: 8,
                          border:
                            "1px solid " + (active ? theme.accent.primary : theme.stroke.secondary),
                          borderLeftWidth: active ? 3 : 1,
                          padding: "10px 12px",
                          background: active ? theme.fill.secondary : theme.fill.quaternary,
                          cursor: "pointer",
                        }}
                      >
                        <Row gap={10} align="center">
                          <div
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: 999,
                              flexShrink: 0,
                              background: active ? theme.accent.primary : theme.stroke.primary,
                            }}
                          />
                          <Text
                            size="small"
                            truncate="start"
                            style={{ flex: 1, minWidth: 0, fontFamily: "ui-monospace, monospace" }}
                            title={f.path}
                          >
                            {f.path}
                          </Text>
                          <DiffStats additions={f.additions} deletions={f.deletions} />
                        </Row>
                      </div>
                    );
                  })}
                </Stack>
              ) : null}
            </div>
          </div>
          <div style={{ flexShrink: 0, paddingTop: 4, minWidth: 0 }}>
            <Text tone="quaternary" size="small">
              {total > 1 ? "← → chapters or footer · " : ""}↑ ↓ files (when multiple)
            </Text>
          </div>
        </Stack>

        <Stack
          gap={0}
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            padding: "20px 20px 20px 16px",
            background: theme.bg.chrome,
            height: "100%",
            maxHeight: "100%",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div style={{ flexShrink: 0, marginBottom: 12, minHeight: 44 }}>
            {chapter && chapter.files.length > 1 ? (
              <Row gap={8} wrap style={{ rowGap: 8 }}>
                {chapter.files.map((f, i) => (
                  <Pill
                    key={f.path + ":tab:" + String(i)}
                    size="sm"
                    active={i === safeFile}
                    onClick={() => setFileIdx(i)}
                    title={f.path}
                  >
                    {basename(f.path)}
                  </Pill>
                ))}
              </Row>
            ) : null}
          </div>
          <Card
            size="lg"
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <CardHeader
              trailing={
                <DiffStats additions={fileEntry?.additions ?? 0} deletions={fileEntry?.deletions ?? 0} />
              }
            >
              {fileEntry ? basename(fileEntry.path) : "—"}
            </CardHeader>
            <CardBody
              style={{
                padding: 0,
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {fileEntry ? (
                <>
                  <Row
                    align="center"
                    gap={12}
                    wrap
                    style={{
                      flexShrink: 0,
                      padding: "10px 14px",
                      borderBottom: "1px solid " + theme.stroke.tertiary,
                      background: theme.fill.quaternary,
                      rowGap: 8,
                    }}
                  >
                    <Text
                      size="small"
                      tone="secondary"
                      truncate="start"
                      style={{ flex: 1, minWidth: 140, fontFamily: "ui-monospace, monospace" }}
                      title={fileEntry.path}
                    >
                      {fileEntry.path}
                    </Text>
                    <Text size="small" tone="tertiary">
                      FOCUS{" "}
                      <Code>
                        {focusLabel || String(fileEntry.lines.length) + " lines"}
                      </Code>
                    </Text>
                    <Button variant="ghost" onClick={copyExcerpt}>
                      Copy excerpt
                    </Button>
                  </Row>
                  <div
                    style={{
                      flex: 1,
                      minHeight: 0,
                      overflowY: "auto",
                      overflowX: "hidden",
                      background: theme.bg.editor,
                    }}
                  >
                    <DiffView path={fileEntry.path} lines={fileEntry.lines} />
                  </div>
                </>
              ) : null}
            </CardBody>
          </Card>
        </Stack>
      </Grid>

      <Row
        align="center"
        style={{
          padding: "14px 20px",
          borderTop: "1px solid " + theme.stroke.tertiary,
          background: theme.bg.elevated,
        }}
      >
        <Button variant="ghost" disabled={safeChapter <= 0} onClick={() => goChapter(-1)}>
          Back
        </Button>
        <Spacer />
        <Text tone="secondary" size="small" weight="medium">
          {pad(safeChapter + 1)} / {pad(total)}
        </Text>
        <Spacer />
        {safeChapter < total - 1 ? (
          <Button variant="primary" onClick={() => goChapter(1)}>
            Next chapter →
          </Button>
        ) : null}
      </Row>

      <div style={{ padding: "16px 20px 0" }}>
        <Callout tone="info" title="How to read this">
          Move between chapters with ← → or Back / Next below. Read the takeaway, then walk files in that theme
          (sidebar, tabs, or ↑ ↓ when several files). Each excerpt is a slice of the unified diff; large files may be
          split across several entries in the specs.
        </Callout>
      </div>
${
  footerBlock
    ? `      <Stack gap={16} style={{ padding: "12px 20px 24px" }}>
        <Divider />
${footerBlock}
      </Stack>
`
    : ""
}
    </div>
  );
}
`;

  return ts;
}

export function generateInteractivePrCanvas(options) {
  const { diffRaw, specsBundle, outPath, prFallback, includeTests, stripLen } =
    options;

  const byPath = loadFilesMap(diffRaw, includeTests);
  const { meta: metaRaw, chunks: specs } = specsBundle;

  const pr =
    metaRaw.pr !== undefined && metaRaw.pr !== null
      ? String(metaRaw.pr)
      : (prFallback ?? "");

  const meta = {
    ...metaRaw,
    title:
      metaRaw.title ??
      (pr ? `PR #${pr} narrative review` : "PR narrative review"),
    stateKey:
      metaRaw.stateKey ??
      (pr ? `pr-${pr}-narrative-chunks` : "interactive-pr-narrative-chunks"),
  };

  const chapters = [];
  for (let idx = 0; idx < specs.length; idx++) {
    const spec = specs[idx];
    const fileSpecs = fileSpecsFromChapterSpec(spec, idx);
    const files = fileSpecs.map((fs, j) =>
      sliceDiffForPath(
        byPath,
        fs.path,
        fs.start,
        fs.end,
        `spec ${idx} file ${j}`
      )
    );
    chapters.push({
      headline: spec.headline,
      takeaway: spec.takeaway,
      ...reviewAidsFromSpec(spec),
      files,
    });
  }

  const ts = buildCanvasTsx({
    chunksPayload: chapters,
    meta,
    stripLen,
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, ts, "utf8");
  console.log(
    "Wrote",
    outPath,
    "chapters",
    chapters.length,
    "bytes",
    fs.statSync(outPath).size
  );
}

function defaultOutPath(prLabel, slug) {
  const base =
    process.env.HOME || process.env.USERPROFILE || path.dirname(process.cwd());
  const prSlug = prLabel.replace(/\//g, "-") || "review";
  return path.join(
    base,
    ".cursor/projects",
    slug,
    "canvases",
    `pr-${prSlug}-narrative-review.canvas.tsx`
  );
}

function main() {
  const argv = parseArgs(process.argv);
  if (argv.help) {
    console.log(`
Interactive PR canvas generator

  node scripts/generate-interactive-pr-canvas.mjs --pr 11 --specs - < specs.json
  node scripts/generate-interactive-pr-canvas.mjs --diff FILE --specs FILE.json [options]

Options:
  --pr REF             Fetch unified diff via \`gh pr diff REF\` (unless --diff is passed)
  --diff PATH          Unified diff file, or "-" for stdin (env: INTERACTIVE_PR_CANVAS_DIFF)
  --specs PATH         JSON array or { meta, chunks }, or "-" for stdin
  --out PATH           Output .canvas.tsx (env: CURSOR_CANVAS_OUT)
  --project-slug NAME  Cursor projects folder segment (env: CURSOR_PROJECT_SLUG)
  --strip N            Base64 slice size (${STRIP_DEFAULT})
  --include-tests      Do not skip *.test.ts(x)

Specs without a repo file:
  - \`--specs -\` and redirect/heredoc from /tmp, or pipe JSON on stdin.
  - env INTERACTIVE_PR_CANVAS_SPECS_JSON=\'...\' (no --specs).

Specs meta (optional): title, prUrl, stateKey, introSuffix, footerStats,
  componentName, pr

Chunk shape:
  Thematic: { headline, takeaway, files: [ { path, start?, end? }, ... ] }
  Legacy:   { headline, takeaway, path, start?, end? }

See scripts/prompts/chapter-grouping.md for LLM instructions to produce specs JSON.

`);
    process.exit(0);
  }

  const prArg = argv.pr?.trim() || "";
  const specsFromEnvJson = process.env.INTERACTIVE_PR_CANVAS_SPECS_JSON;
  const specsPathArg =
    argv.specs?.trim() || process.env.INTERACTIVE_PR_CANVAS_SPECS?.trim();

  if (!specsPathArg && !specsFromEnvJson) {
    console.error(
      "Missing --specs, INTERACTIVE_PR_CANVAS_SPECS, or INTERACTIVE_PR_CANVAS_SPECS_JSON"
    );
    process.exit(1);
  }
  if (specsPathArg && specsFromEnvJson) {
    console.error(
      "Use either --specs (or INTERACTIVE_PR_CANVAS_SPECS) or INTERACTIVE_PR_CANVAS_SPECS_JSON, not both"
    );
    process.exit(1);
  }

  const diffExplicit = !!argv.diffExplicit;
  let diffPath =
    argv.diff?.trim() ||
    process.env.INTERACTIVE_PR_CANVAS_DIFF?.trim() ||
    DEFAULT_DIFF;

  if (prArg && !diffExplicit) {
    diffPath = "__GH_PR_DIFF__";
  }

  if (diffPath === "-" && specsPathArg === "-") {
    console.error(
      "Cannot read both diff and specs from stdin. Use --pr REF for the diff, or put one input in a file."
    );
    process.exit(1);
  }

  const stripLen =
    Number.isFinite(argv.strip) && argv.strip > 0 ? argv.strip : STRIP_DEFAULT;

  let specsBundle;
  try {
    if (specsFromEnvJson) {
      specsBundle = parseSpecsJson(specsFromEnvJson);
    } else if (specsPathArg === "-") {
      specsBundle = parseSpecsJson(readStdinUtf8());
    } else {
      specsBundle = loadSpecsFromPath(path.resolve(specsPathArg));
    }
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  const slug =
    argv.projectSlug?.trim() ||
    process.env.CURSOR_PROJECT_SLUG?.trim() ||
    gitWorkspaceSlug();

  const prHint =
    specsBundle.meta.pr !== undefined && specsBundle.meta.pr !== null
      ? String(specsBundle.meta.pr)
      : prArg || "";

  let out =
    argv.out?.trim() ||
    process.env.CURSOR_CANVAS_OUT?.trim() ||
    defaultOutPath(prHint || "review", slug);

  let diffRaw;
  try {
    if (diffPath === "__GH_PR_DIFF__") {
      diffRaw = diffFromGh(prArg);
    } else if (diffPath === "-") {
      diffRaw = readStdinUtf8();
    } else {
      diffRaw = fs.readFileSync(path.resolve(diffPath), "utf8");
    }
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  generateInteractivePrCanvas({
    diffRaw,
    specsBundle,
    outPath: out,
    prFallback: prArg,
    includeTests: !!argv.includeTests,
    stripLen,
  });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) main();
