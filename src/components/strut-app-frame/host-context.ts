import type { McpUiHostContext, McpUiStyles, McpUiTheme } from "@modelcontextprotocol/ext-apps/app-bridge";

/**
 * Hive's theme as an MCP Apps host context (`ui/initialize` →
 * `hostContext`): light/dark and hive's own CSS variables mapped onto the
 * spec's `styles.variables`, which strut's kit applies to its shadcn tokens
 * (kit `base.css`: background/card ← `--color-background-primary`, muted ←
 * `--color-background-secondary`, primary ← `--color-background-inverse`,
 * border ← `--color-border-primary`, ring ← `--color-ring-primary`, radius ←
 * `--border-radius-md`). Values are read RESOLVED off hive's document — the
 * app's document is another one, where hive's `var(…)` would mean nothing.
 */

/** Spec variable ← hive's own (`globals.css`). */
const COLOR_VARIABLES: ReadonlyArray<readonly [keyof McpUiStyles, string]> = [
  ["--color-background-primary", "--background"],
  ["--color-background-secondary", "--muted"],
  ["--color-background-tertiary", "--accent"],
  ["--color-background-inverse", "--primary"],
  ["--color-background-danger", "--destructive"],
  ["--color-text-primary", "--foreground"],
  ["--color-text-secondary", "--muted-foreground"],
  ["--color-text-tertiary", "--muted-foreground"],
  ["--color-text-inverse", "--primary-foreground"],
  ["--color-text-danger", "--destructive"],
  ["--color-border-primary", "--border"],
  ["--color-border-secondary", "--input"],
  ["--color-ring-primary", "--ring"],
];

const GENERIC_FAMILY = /\b(sans-serif|serif|monospace|system-ui|ui-sans-serif)\b/;
const SANS_FALLBACK = "ui-sans-serif, system-ui, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

/** What the mapping reads: one of hive's custom properties, and the font hive's body renders with. */
export interface HostStyleSource {
  variable: (name: string) => string;
  bodyFont: string;
}

/** Hive's variables as the spec names them. Pure over `source`; a variable hive does not set is left out. */
export function hostStyleVariables(source: HostStyleSource): McpUiStyles {
  const out: Partial<Record<keyof McpUiStyles, string>> = {};
  for (const [key, hive] of COLOR_VARIABLES) {
    const value = source.variable(hive).trim();
    if (value) out[key] = value;
  }
  const font = source.bodyFont.trim();
  out["--font-sans"] = font ? (GENERIC_FAMILY.test(font) ? font : `${font}, ${SANS_FALLBACK}`) : SANS_FALLBACK;
  out["--font-mono"] = MONO;
  // Hive's base radius is `--radius` (its `rounded-lg`); the kit derives its
  // whole shadcn scale from `--border-radius-md`, so that is hive's base.
  const radius = source.variable("--radius").trim();
  if (radius) {
    out["--border-radius-sm"] = `calc(${radius} - 4px)`;
    out["--border-radius-md"] = radius;
    out["--border-radius-lg"] = `calc(${radius} + 4px)`;
    out["--border-radius-full"] = "9999px";
  }
  return out as McpUiStyles;
}

/** Read off this document, as it is themed right now. */
export function readHostStyles(doc: Document = document): McpUiStyles {
  const root = getComputedStyle(doc.documentElement);
  return hostStyleVariables({
    variable: (name) => root.getPropertyValue(name),
    bodyFont: doc.body ? getComputedStyle(doc.body).fontFamily : "",
  });
}

/** The host context an app is handed at `ui/initialize`, and again on a theme change. */
export function hostContextFor(theme: McpUiTheme, variables: McpUiStyles): McpUiHostContext {
  return {
    theme,
    styles: { variables },
    // The app fills its area (a page, the artifact panel), as in strut's own host.
    displayMode: "fullscreen",
    availableDisplayModes: ["fullscreen"],
    locale: typeof navigator !== "undefined" ? navigator.language : undefined,
    timeZone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
    userAgent: "hive",
    platform: "web",
  };
}
