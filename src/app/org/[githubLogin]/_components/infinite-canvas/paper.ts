"use client";

import { TYPE } from "./nodes";
import { CANVAS_THEME, type Tokens, v } from "./theme";

/** The app's colour tokens as the canvas's: `c` names a canvas token (a CSS variable, or its value). */
const appTokens = (c: (k: keyof Tokens) => string) => `
  --background: ${c("panel")}; --foreground: ${c("ink")};
  --card: ${c("sheet")}; --card-foreground: ${c("ink")};
  --popover: ${c("sheet")}; --popover-foreground: ${c("ink")};
  --primary: ${c("ink")}; --primary-foreground: ${c("onInk")};
  --secondary: ${c("field")}; --secondary-foreground: ${c("ink")};
  --muted: ${c("field")}; --muted-foreground: ${c("muted")};
  --accent: ${c("field")}; --accent-foreground: ${c("ink")};
  --border: ${c("border")}; --input: ${c("borderStrong")}; --ring: ${c("borderStrong")};
  color-scheme: light;`;

/**
 * The canvas's paper for anything Hive's chat draws inside it (artifact
 * chips and rows, thumbnails, the full chat, the artifact panel on its
 * right), in either app theme: the app's colour tokens re-pointed at the
 * canvas's own under `[data-canvas-paper]`, so a `.dark` app still draws
 * them light. Your messages in a white bubble, Jamie's plain.
 */
export const PAPER_CSS = `
[data-canvas-paper] {${appTokens(v)}
}
/* Menus and popovers the chat opens portal to <body>, outside the canvas: while it is on the page they wear it too. */
body:has([data-canvas-paper]) [data-radix-popper-content-wrapper] {${appTokens((k) => CANVAS_THEME[k])}
}
[data-canvas-chat] { background: ${v("panel")}; color: ${v("ink")}; font-family: ${TYPE}; }
[data-canvas-paper] [data-chat-bubble="you"] {
  --primary: ${v("bubble")}; --primary-foreground: ${v("ink")};
  border: 1px solid ${v("border")};
  border-radius: 12px;
  box-shadow: none;
}
[data-canvas-paper] [data-chat-bubble="jamie"] { background: transparent; box-shadow: none; padding-left: 0; }
[data-canvas-paper] [data-chat-bubble],
[data-canvas-paper] [data-chat-bubble] :is(p, li) { font-size: 14.5px; line-height: 1.45; }
/* The composer's border says it has focus; no second box around the text. */
[data-canvas-chat] form textarea:focus-visible { outline: none; }
`;
