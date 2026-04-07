/**
 * Shared Mermaid rendering logic.
 *
 * Handles singleton initialization, ELK layout registration,
 * unique render IDs, and automatic dagre fallback when ELK fails.
 */

/** Monotonic counter for unique, SVG-safe render IDs. */
let renderCounter = 0;

/** Tracks whether Mermaid has been initialized (singleton). */
let initialized = false;

const THEME_VARS = {
  primaryColor: "#3b82f6",
  primaryTextColor: "#ffffff",
  primaryBorderColor: "#60a5fa",
  lineColor: "#94a3b8",
  secondaryColor: "#1e293b",
  secondaryTextColor: "#e2e8f0",
  secondaryBorderColor: "#475569",
  background: "transparent",
  mainBkg: "#1e293b",
  textColor: "#e2e8f0",
  actorTextColor: "#e2e8f0",
  actorBkg: "#1e293b",
  actorBorder: "#475569",
  signalColor: "#94a3b8",
  signalTextColor: "#e2e8f0",
  labelBoxBkgColor: "#1e293b",
  labelBoxBorderColor: "#475569",
  labelTextColor: "#e2e8f0",
  loopTextColor: "#e2e8f0",
  noteBkgColor: "#334155",
  noteTextColor: "#e2e8f0",
  noteBorderColor: "#475569",
  nodeBkg: "#1e293b",
  nodeBorder: "#475569",
  clusterBkg: "#0f172a",
  clusterBorder: "#334155",
  defaultLinkColor: "#94a3b8",
  edgeLabelBackground: "#1e293b",
};

const SHARED_CONFIG = {
  startOnLoad: false,
  suppressErrorRendering: true,
  theme: "dark" as const,
  securityLevel: "loose" as const,
  fontFamily: "inherit",
  themeVariables: THEME_VARS,
  flowchart: { curve: "basis" as const, padding: 15 },
  sequence: {
    actorMargin: 50,
    boxMargin: 10,
    boxTextMargin: 5,
    noteMargin: 10,
    messageMargin: 35,
  },
};

async function getMermaid() {
  const mermaid = (await import("mermaid")).default;

  if (!initialized) {
    try {
      const elkLoader = await import("@mermaid-js/layout-elk");
      mermaid.registerLayoutLoaders(elkLoader.default ?? elkLoader);
    } catch {
      // ELK not available — dagre fallback is fine
    }

    mermaid.initialize({ ...SHARED_CONFIG, layout: "elk" });
    initialized = true;
  }

  return mermaid;
}

function nextId(): string {
  return `mmd_${++renderCounter}_${Date.now()}`;
}

/**
 * Render a Mermaid diagram source string to an SVG string.
 * Attempts ELK layout first, falls back to dagre on failure.
 */
export async function renderMermaidToSvg(source: string): Promise<string> {
  // Replace literal "\n" (backslash + n) with <br/> for line breaks in labels.
  // AI-generated diagrams often produce e.g. "Hive\n(Next.js App)" where the
  // intent is a line break, but Mermaid only interprets <br/> as such.
  const trimmed = source.trim().replace(/\\n/g, "<br/>");
  if (!trimmed) throw new Error("No diagram code provided");

  const mermaid = await getMermaid();

  try {
    await mermaid.parse(trimmed);
    console.log("✅ Parse OK");
  } catch (parseErr) {
    console.error("❌ PARSE ERROR:", parseErr);
  }

  try {
    const { svg } = await mermaid.render(nextId(), trimmed);
    return svg;
  } catch (elkErr) {
    // Retry with dagre layout
    try {
      mermaid.initialize({ ...SHARED_CONFIG, layout: "dagre" });
      const { svg } = await mermaid.render(nextId(), trimmed);

      // Restore ELK for future renders
      mermaid.initialize({ ...SHARED_CONFIG, layout: "elk" });

      return svg;
    } catch (dagreErr) {
      // Restore ELK for future renders even on failure
      mermaid.initialize({ ...SHARED_CONFIG, layout: "elk" });

      console.error("Mermaid ELK error:", elkErr);
      console.error("Mermaid dagre error:", dagreErr);
      throw dagreErr;
    }
  }
}
