/**
 * Profiles the org page's Brainstorm tab (the infinite canvas) against a
 * local dev server with USE_MOCKS=true and mock sign-in (POD_URL set):
 *
 *   node scripts/profile-infinite-canvas.mjs [--base http://localhost:3000] [--runs 3] [--out <dir>]
 *
 * 1. Signs in as the mock user and grows the mock plan to a realistic size
 *    through the app's own write endpoints (in-memory mock store: once per
 *    dev-server start; reruns see it's there and skip).
 * 2. For each gesture — a 2 s wheel zoom and a 2 s drag pan at the org and
 *    inside an initiative, and the flight org → initiative — runs it `runs`
 *    times in two modes on a fresh page load:
 *      - plain: frames (rAF), long tasks, long animation frames, React
 *        commits and their render ms (HostRoot `actualDuration`), and
 *        main-thread busy time (CDP `Performance.getMetrics`);
 *      - fibers: the same commits, also walking each committed tree to count
 *        which components rendered (`SceneItem` in particular). The walk
 *        costs time, so its frame numbers aren't reported.
 *    Medians across runs are printed. One more plain run per gesture records
 *    a DevTools trace (`<out>/*.trace.json`); tracing slows the page, so that
 *    run isn't in the medians.
 * 3. Counts /api requests for: the tab's first load, opening ⌘K, and a deep
 *    link `?at=` to a feature under an initiative that isn't on the desk.
 *
 * React commits are read through a stand-in React DevTools hook installed
 * before the page's scripts: with a hook present React runs in profiling mode
 * (fibers carry `actualStartTime`/`actualDuration`), and `onCommitFiberRoot`
 * sees every commit. A component rendered in a commit when it began work in
 * that render (`actualStartTime` ≥ the root's) and ran (the PerformedWork flag).
 *
 * Chromium runs headless on the real GPU (Metal), so rAF runs at the
 * display's rate; the default software GL caps it near 11 fps.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", "http://localhost:3000");
const RUNS = Number(arg("runs", 3));
const OUT = arg("out", join(process.cwd(), "canvas-profile"));
const LOGIN = arg("login", "dev-user");
const WS = arg("workspace", "mock-stakgraph");
const CANVAS = `/org/${LOGIN}?view=canvas&tab=brainstorm`;
const INITIATIVE = "mock-initiative-onboarding";
const VIEWPORT = { width: 1440, height: 900 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : NaN;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

// ── In the page ─────────────────────────────────────────────────────────────

/** Installed before any page script: the DevTools hook stand-in and the frame / long-task recorders. */
function instrument() {
  const P = (window.__prof = { on: false, t0: 0, fibers: false, commits: [], frames: [], longtasks: [], loafs: [] });
  const roots = new WeakMap();
  const PERFORMED_WORK = 1;
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  const nameOf = (f) => {
    const t = f.tag === 14 ? f.elementType?.type : f.type;
    return t?.displayName || t?.name || t?.render?.displayName || t?.render?.name || "Anonymous";
  };
  const countRendered = (root) => {
    const start = root.actualStartTime;
    const byName = {};
    let total = 0;
    const stack = [root];
    while (stack.length) {
      const f = stack.pop();
      // Not visited in this render: nor was anything under it.
      if (!(f.actualStartTime >= start)) continue;
      if (COMPONENT_TAGS.has(f.tag) && f.flags & PERFORMED_WORK) {
        const n = nameOf(f);
        byName[n] = (byName[n] ?? 0) + 1;
        total++;
      }
      for (let c = f.child; c; c = c.sibling) stack.push(c);
    }
    return { total, byName };
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    isDisabled: false,
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      if (!P.on) return;
      if (!roots.has(root)) roots.set(root, roots.size + 1);
      const c = { t: performance.now(), root: roots.get(root), renderMs: root.current.actualDuration };
      if (P.fibers) Object.assign(c, countRendered(root.current));
      P.commits.push(c);
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
  const tick = (t) => {
    if (P.on) P.frames.push(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  new PerformanceObserver((l) => {
    // Entries arrive late: keep only the ones that started inside the window.
    if (P.on) for (const e of l.getEntries()) if (e.startTime >= P.t0) P.longtasks.push(e.duration);
  }).observe({ type: "longtask" });
  try {
    new PerformanceObserver((l) => {
      if (P.on)
        for (const e of l.getEntries())
          if (e.startTime >= P.t0) P.loafs.push({ d: e.duration, block: e.blockingDuration });
    }).observe({ type: "long-animation-frame" });
  } catch {}
}

/** The refresh period, from idle rAF intervals. */
const refreshPeriod = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const ts = [];
        const f = (t) => {
          ts.push(t);
          if (ts.length < 61) requestAnimationFrame(f);
          else {
            const d = ts
              .slice(1)
              .map((x, i) => x - ts[i])
              .sort((a, b) => a - b);
            resolve(d[30]);
          }
        };
        requestAnimationFrame(f);
      }),
  );

// ── Setup ───────────────────────────────────────────────────────────────────

async function signIn(context) {
  const page = await context.newPage();
  await page.goto(BASE);
  await page.locator('[data-testid="mock-signin-button"]').click({ timeout: 30_000 });
  await page.waitForURL((u) => !u.pathname.startsWith("/auth") && u.pathname !== "/", { timeout: 60_000 });
  return page;
}

const tree = async (request, ref) =>
  (await request.get(`${BASE}/api/workspaces/${WS}/graph/initiative-tree?focus=${encodeURIComponent(ref)}`)).json();

async function change(request, root, ops) {
  const res = await request.post(`${BASE}/api/workspaces/${WS}/graph/initiative-tree/changes`, {
    data: { root, ops },
  });
  if (!res.ok()) throw new Error(`initiative-tree/changes ${res.status()}: ${await res.text()}`);
  return (await res.json()).created ?? {};
}

async function brainstormChange(request, root, ops) {
  const res = await request.post(`${BASE}/api/workspaces/${WS}/graph/brainstorms/changes`, { data: { root, ops } });
  // Step 6 removed this route: no way left to add options over HTTP, so the third answers are skipped.
  if (res.status() === 404) return null;
  if (!res.ok()) throw new Error(`brainstorms/changes ${res.status()}: ${await res.text()}`);
  return res.json();
}

/**
 * Grows the mock plan to the baseline's size: Self-serve onboarding to 4 milestones × 5 features, a third
 * option on each brainstorm question of its first milestone, and a feature under Usage-based billing (off
 * the desk) for the deep link. Billing is written first: every save stamps its initiative, and the desk is
 * the three most recently updated, so janitor, voice and onboarding are touched after it.
 * Returns the deep link's feature ref.
 */
async function seed(request) {
  const onb = await tree(request, INITIATIVE);
  const billing = await tree(request, "mock-initiative-billing");
  const deep = billing.nodes.find((n) => n.type === "InitiativeFeature" && n.properties.name === "Invoice per run");
  if (deep && onb.nodes.filter((n) => n.type === "HiveMilestone").length >= 4) return deep.ref_id;

  const feat = (temp, parent, name) => ({ op: "add", temp, type: "InitiativeFeature", parent, fields: { name } });
  const made = await change(request, "mock-initiative-billing", [
    feat("b1", "mock-m-meter", "Invoice per run"),
    feat("b2", "mock-m-meter", "Free tier limit"),
  ]);
  await change(request, "mock-initiative-janitor", [feat("j1", "mock-m-digest", "Digest email")]);
  await change(request, "mock-initiative-voice", [
    { op: "add", temp: "v1", type: "HiveMilestone", parent: "mock-initiative-voice", fields: { name: "Talk to plan" } },
  ]);

  const names = {
    "mock-m-signup": ["Email sign-up fallback", "SSO for enforced orgs"],
    "mock-m-invite": ["Invite by email", "Seat limits", "Role on invite", "Pending invites list"],
    "mock-m-janitor": [
      "Pick a janitor",
      "Run on first push",
      "First-run report",
      "Retry a failed run",
      "Share the report",
    ],
  };
  const ops = Object.entries(names).flatMap(([m, list]) => list.map((n, i) => feat(`${m}-${i}`, m, n)));
  ops.push({ op: "add", temp: "m4", type: "HiveMilestone", parent: INITIATIVE, fields: { name: "Billing set-up" } });
  ["Pick a plan", "Card on file", "Usage meter", "Receipts", "Trial ends"].forEach((n, i) =>
    ops.push({ op: "add", temp: `m4f${i}`, type: "InitiativeFeature", parent: { temp: "m4" }, fields: { name: n } }),
  );
  // A new milestone's features hang off its temp id when the endpoint takes that; else add them after.
  try {
    await change(request, INITIATIVE, ops);
  } catch {
    const created = await change(
      request,
      INITIATIVE,
      ops.filter((o) => typeof o.parent === "string"),
    );
    await change(
      request,
      INITIATIVE,
      ops.filter((o) => typeof o.parent !== "string").map((o) => ({ ...o, parent: created.m4 })),
    );
  }

  // A third answer on each of the first milestone's questions.
  const thirds = {
    "mock-brainstorm-auth": [
      ["mock-brainstorm-auth", "Both: app for orgs, OAuth for personal accounts"],
      ["mock-brainstorm-auth-approve", "Hive asks the owner by email"],
    ],
    "mock-brainstorm-repo": [
      ["mock-brainstorm-repo", "Let Jamie suggest repos from recent activity"],
      ["mock-brainstorm-repo-fresh", "Refresh when the picker opens"],
    ],
  };
  for (const [root, list] of Object.entries(thirds))
    await brainstormChange(
      request,
      root,
      list.map(([parent, text], i) => ({ op: "add_option", temp: `o${i}`, parent, text })),
    );
  return made.b1;
}

// ── Gestures ────────────────────────────────────────────────────────────────

/** A point on the canvas's own background (nothing over it), near the middle. */
const backgroundPoint = (page) =>
  page.evaluate(() => {
    const root = document.querySelector("[data-infinite-canvas] [data-zoom]");
    const r = root.getBoundingClientRect();
    for (let dy = 0; dy < r.height / 2; dy += 20)
      for (let dx = 0; dx < r.width / 2; dx += 20)
        for (const [x, y] of [
          [r.left + r.width / 2 + dx, r.top + r.height / 2 + dy],
          [r.left + r.width / 2 - dx, r.top + r.height / 2 - dy],
        ])
          if (document.elementFromPoint(x, y) === root) return { x, y };
    return { x: r.left + 40, y: r.top + r.height / 2 };
  });

/** Sends `count` input events at 60 Hz, as a trackpad or mouse would; returns how long it took. */
async function paced(count, send) {
  const t0 = Date.now();
  for (let i = 0; i < count; i++) {
    await send(i);
    const next = t0 + ((i + 1) * 1000) / 60;
    const wait = next - Date.now();
    if (wait > 0) await sleep(wait);
  }
  return Date.now() - t0;
}

const GESTURES = {
  /** 2 s of wheel over the background (over a card's scrolling list the wheel scrolls it): 1 s in, 1 s out. */
  zoom: async (page, cdp) => {
    const r = await backgroundPoint(page);
    return paced(120, (i) =>
      cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: r.x,
        y: r.y,
        deltaX: 0,
        deltaY: i < 60 ? -12 : 12,
      }),
    );
  },
  /** 2 s of drag from the background: a circle of 220 px radius. */
  pan: async (page, cdp) => {
    const p = await backgroundPoint(page);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
    const ms = await paced(120, (i) => {
      const a = (i / 120) * 2 * Math.PI;
      return cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: p.x + 220 * Math.sin(a),
        y: p.y + 220 * (1 - Math.cos(a)) * 0.5,
        button: "left",
        buttons: 1,
      });
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: p.x,
      y: p.y,
      button: "left",
      clickCount: 1,
    });
    return ms;
  },
  /** Click the initiative's card at the org and record 2 s: the 750 ms flight and what it reads and lays out. */
  flight: async (page) => {
    const box = await page.locator(`[data-node="${INITIATIVE}"]`).first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + Math.min(40, box.height / 2));
    await sleep(2000);
    return 2000;
  },
};

const SCENARIOS = [
  { name: "zoom @ org", gesture: "zoom", at: null },
  { name: "pan @ org", gesture: "pan", at: null },
  { name: `zoom @ initiative`, gesture: "zoom", at: INITIATIVE },
  { name: `pan @ initiative`, gesture: "pan", at: INITIATIVE },
  { name: "flight org → initiative", gesture: "flight", at: null },
];

/** Loads the tab (at a level) and waits until its reads and layout have settled. */
async function open(page, at) {
  await page.goto(`${BASE}${CANVAS}${at ? `&at=${encodeURIComponent(at)}` : ""}`);
  await page.locator("[data-infinite-canvas] [data-node]").first().waitFor({ timeout: 60_000 });
  await page
    .waitForFunction(
      (lvl) => document.querySelector("[data-infinite-canvas] [data-zoom]")?.dataset.level === lvl,
      at ?? "org",
      { timeout: 30_000 },
    )
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(2500);
}

async function measure(context, scenario, fibers, tracePath) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await open(page, scenario.at);
  const period = await refreshPeriod(page);
  const dom = await page.evaluate(() => document.querySelectorAll("[data-infinite-canvas] *").length);
  const busy = async () => {
    const m = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
    return { task: m.TaskDuration * 1000, script: m.ScriptDuration * 1000 };
  };
  if (tracePath) await context.browser().startTracing(page, { path: tracePath, screenshots: false });
  const b0 = await busy();
  await page.evaluate(
    (f) =>
      Object.assign(window.__prof, {
        on: true,
        t0: performance.now(),
        fibers: f,
        commits: [],
        frames: [],
        longtasks: [],
        loafs: [],
      }),
    fibers,
  );
  const ms = await GESTURES[scenario.gesture](page, cdp);
  // Let the last frame land.
  await sleep(100);
  const p = await page.evaluate(() => {
    window.__prof.on = false;
    window.__prof.t1 = performance.now();
    return window.__prof;
  });
  const b1 = await busy();
  if (tracePath) await context.browser().stopTracing();
  await page.close();

  const secs = (p.t1 - p.t0) / 1000;
  const gaps = p.frames.slice(1).map((t, i) => t - p.frames[i]);
  const dropped = gaps.reduce((n, d) => n + Math.max(0, Math.round(d / period) - 1), 0);
  const counted = p.commits.filter((c) => c.total !== undefined);
  const byName = {};
  for (const c of counted) for (const [k, v] of Object.entries(c.byName)) byName[k] = (byName[k] ?? 0) + v;
  return {
    period,
    dom,
    commitsPerSec: p.commits.length / secs,
    commits: p.commits.length,
    roots: new Set(p.commits.map((c) => c.root)).size,
    renderMean: mean(p.commits.map((c) => c.renderMs).filter(Number.isFinite)),
    renderP95: pct(p.commits.map((c) => c.renderMs).filter(Number.isFinite), 0.95),
    componentsPerCommit: counted.length ? mean(counted.map((c) => c.total)) : NaN,
    sceneItemsPerCommit: counted.length ? mean(counted.map((c) => c.byName.SceneItem ?? 0)) : NaN,
    top: Object.entries(byName)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => [k, +(v / Math.max(1, counted.length)).toFixed(1)]),
    fps: p.frames.length / secs,
    expectedFrames: secs * (1000 / period),
    dropped,
    frameP95: pct(gaps, 0.95),
    frameMax: Math.max(...gaps),
    gestureMs: ms,
    longTasks: p.longtasks.length,
    longTaskMs: p.longtasks.reduce((a, b) => a + b, 0),
    loafs: p.loafs.length,
    loafBlockingMs: p.loafs.reduce((a, b) => a + b.block, 0),
    mainThreadBusyPct: ((b1.task - b0.task) / (secs * 1000)) * 100,
  };
}

// ── Requests ────────────────────────────────────────────────────────────────

/** Counts /api requests from `act` until none has started for `quietMs`. */
async function countRequests(page, act, quietMs = 3000) {
  const seen = [];
  let last = Date.now();
  const on = (req) => {
    const u = new URL(req.url());
    if (!u.pathname.startsWith("/api/") || u.pathname.startsWith("/api/auth/")) return;
    seen.push(`${req.method()} ${u.pathname}${u.search}`);
    last = Date.now();
  };
  page.on("request", on);
  await act();
  last = Date.now();
  while (Date.now() - last < quietMs) await sleep(200);
  page.off("request", on);
  const byRoute = {};
  for (const s of seen) {
    const route = s
      .replace(/\?.*$/, "")
      .replace(/\/workspaces\/[^/]+\//, "/workspaces/:slug/")
      .replace(/\/orgs\/[^/]+\//, "/orgs/:login/");
    byRoute[route] = (byRoute[route] ?? 0) + 1;
  }
  return { total: seen.length, byRoute, all: seen };
}

// ── Main ────────────────────────────────────────────────────────────────────

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-features=LongAnimationFrameTiming"],
});
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
await context.addInitScript(instrument);
mkdirSync(OUT, { recursive: true });

const setup = await signIn(context);
const deepRef = await seed(setup.request);
await setup.close();
console.log(`seeded; deep link target ${deepRef}`);

// Warm the dev server's compile of every route the runs touch.
{
  const p = await context.newPage();
  await open(p, null);
  await open(p, INITIATIVE);
  await p.close();
}

const results = {};
for (const s of SCENARIOS) {
  const plain = [];
  const fib = [];
  for (let i = 0; i < RUNS; i++) {
    plain.push(await measure(context, s, false, null));
    fib.push(await measure(context, s, true, null));
  }
  await measure(context, s, false, join(OUT, `${s.gesture}-${s.at ? "initiative" : "org"}.trace.json`));
  const med = (k, from = plain) => +median(from.map((r) => r[k])).toFixed(1);
  results[s.name] = {
    "refresh (Hz)": +(1000 / plain[0].period).toFixed(0),
    "canvas DOM nodes at start": med("dom"),
    "React commits / s": med("commitsPerSec"),
    "render ms / commit, mean": med("renderMean"),
    "render ms / commit, p95": med("renderP95"),
    "components rendered / commit": med("componentsPerCommit", fib),
    "SceneItem renders / commit": med("sceneItemsPerCommit", fib),
    "frames / s": med("fps"),
    "dropped frames": med("dropped"),
    "frame interval p95 (ms)": med("frameP95"),
    "longest frame (ms)": med("frameMax"),
    "long tasks (n)": med("longTasks"),
    "long tasks (ms)": med("longTaskMs"),
    "long animation frames (n)": med("loafs"),
    "LoAF blocking (ms)": med("loafBlockingMs"),
    "main thread busy (%)": med("mainThreadBusyPct"),
    "most rendered / commit (fibers run 1)": fib[0].top.map(([k, v]) => `${k} ${v}`).join(", "),
    runs: { plain, fibers: fib.map(({ top, ...r }) => r) },
  };
  console.log(`\n## ${s.name}`);
  for (const [k, v] of Object.entries(results[s.name])) if (k !== "runs") console.log(`${k}: ${v}`);
}

// Requests: first load of the tab, ⌘K, a deep link under an off-desk initiative.
const net = {};
{
  const p = await context.newPage();
  net["initial load"] = await countRequests(p, async () => {
    await p.goto(`${BASE}${CANVAS}`);
    await p.locator("[data-infinite-canvas] [data-node]").first().waitFor({ timeout: 60_000 });
  });
  net["open ⌘K"] = await countRequests(p, () => p.keyboard.press("Meta+k"));
  await p.close();
  const q = await context.newPage();
  net[`deep link ?at=${deepRef}`] = await countRequests(q, async () => {
    await q.goto(`${BASE}${CANVAS}&at=${encodeURIComponent(deepRef)}`);
    await q.locator("[data-infinite-canvas] [data-node]").first().waitFor({ timeout: 60_000 });
  });
  net.landedAt = await q.evaluate(() => document.querySelector("[data-infinite-canvas] [data-zoom]")?.dataset.level);
  await q.close();
}
console.log("\n## Requests");
for (const [k, v] of Object.entries(net)) console.log(k, typeof v === "string" ? v : `${v.total}`, v.byRoute ?? "");

writeFileSync(join(OUT, "results.json"), JSON.stringify({ base: BASE, runs: RUNS, results, net }, null, 2));
console.log(`\nwrote ${join(OUT, "results.json")}`);
await browser.close();
