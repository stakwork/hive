"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown, { type Components } from "react-markdown";

/**
 * Sidebar-flavored chat bubble. Forked from
 * `@/components/dashboard/DashboardChat/ChatMessage` because that one
 * is centered (`justify-center`) and bubble-capped at 600px — both
 * fine for the dashboard's bottom-anchored overlay, both wrong in a
 * 384px sidebar where we want user messages right-aligned, assistant
 * messages left-aligned, and bubbles to be narrower than the column.
 *
 * No `pointer-events-auto` (the parent column is fully interactive
 * already) and no `max-w-[600px]` (we cap user bubbles to ~85% of
 * the column instead).
 */

/**
 * Query params we treat as in-page deep links (no full navigation).
 * The agent is taught to emit these as relative markdown links —
 * e.g. `[read the writeup](?r=stripe-connect)` for research,
 * `[the integration doc](?c=sphinx-hive)` for connections — and
 * `OrgCanvasView` watches the URL to open the matching viewer.
 *
 * Plain `<a href="?r=foo">` would trigger a full document load,
 * blowing away in-flight chat state, the canvas's auto-saved
 * layout/zoom, and any open viewer. The `?canvas=<ref>` deep-link
 * follower we tried earlier (see CANVAS.md "Deep links via
 * `?canvas=<ref>`") taught us that runtime URL writes need to
 * funnel through `router.replace` to coexist with the rest of the
 * page's URL-driven state. Add new in-page params here as we grow
 * the agent's link surface (e.g. future `?canvas=`, `?n=` for
 * generic node selection).
 */
const IN_PAGE_PARAMS = new Set(["r", "c"]);

interface SidebarChatMessageProps {
  message: {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
  };
  isStreaming?: boolean;
}

export function SidebarChatMessage({
  message,
  isStreaming = false,
}: SidebarChatMessageProps) {
  const isUser = message.role === "user";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * Markdown link interceptor. Recognizes hrefs that are pure
   * query-string patches (e.g. `?r=foo`, `?c=foo&extra=1`) and
   * applies them via `router.replace` so the page doesn't reload.
   * Anything else (absolute URLs, fragment links, plain paths) falls
   * back to default `<a>` behavior with `target="_blank"` so external
   * citations from research writeups open in a new tab without
   * losing canvas context.
   */
  const markdownComponents = useMemo<Components>(() => {
    return {
      a: ({ href, children, ...rest }) => {
        const trimmed = href?.trim() ?? "";
        if (trimmed.startsWith("?")) {
          // Parse the proposed query string and check it touches one
          // of our in-page params. If it does, route through Next so
          // `OrgCanvasView`'s URL watchers pick it up; otherwise let
          // the browser handle it (rare — anchor refs etc.).
          const qs = new URLSearchParams(trimmed.slice(1));
          const touchesInPage = Array.from(qs.keys()).some((k) =>
            IN_PAGE_PARAMS.has(k),
          );
          if (touchesInPage) {
            return (
              <a
                href={trimmed}
                onClick={(e) => {
                  e.preventDefault();
                  // Merge the proposed params on top of the current
                  // URL so we don't accidentally drop `?canvas=`,
                  // `?chat=`, or any other state. The agent only
                  // knows the param it cares about; we own
                  // composition.
                  const next = new URLSearchParams(searchParams.toString());
                  for (const [k, v] of qs.entries()) next.set(k, v);
                  const merged = next.toString();
                  router.replace(
                    `${pathname}${merged ? `?${merged}` : ""}`,
                    { scroll: false },
                  );
                }}
                {...rest}
              >
                {children}
              </a>
            );
          }
        }
        // External / unknown — open in a new tab so the user keeps
        // their canvas state. Mirrors the AttentionList convention
        // (CANVAS.md gotcha "AttentionList opens external").
        return (
          <a
            href={trimmed}
            target="_blank"
            rel="noopener noreferrer"
            {...rest}
          >
            {children}
          </a>
        );
      },
    };
  }, [router, pathname, searchParams]);

  if (!message.content.trim()) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`${
          isUser ? "max-w-[85%]" : "w-full"
        }`}
      >
        <div
          className={`rounded-2xl px-3 py-2 shadow-sm ${
            isUser
              ? "bg-primary text-primary-foreground inline-block"
              : "bg-muted/40"
          }`}
        >
          {isStreaming ? (
            <div
              className={`text-sm whitespace-pre-wrap break-words ${
                isUser ? "text-primary-foreground" : "text-foreground/90"
              }`}
            >
              {message.content}
            </div>
          ) : (
            <div
              className={`prose prose-sm max-w-none break-words ${
                isUser
                  ? "[&>*]:!text-primary-foreground [&_*]:!text-primary-foreground"
                  : "dark:prose-invert [&>*]:!text-foreground/90 [&_*]:!text-foreground/90"
              }`}
            >
              <ReactMarkdown components={markdownComponents}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
