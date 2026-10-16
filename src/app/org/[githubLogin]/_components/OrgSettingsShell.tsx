"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { WorkspacesView } from "./WorkspacesView";
import { MembersView } from "./MembersView";
import { OrgSettingsView } from "./OrgSettingsView";

const SECTIONS = [
  { id: "workspaces", label: "Workspaces" },
  { id: "members", label: "Members" },
  { id: "mcp", label: "MCP servers" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function parseSection(value: string | null): SectionId {
  return SECTIONS.find((s) => s.id === value)?.id ?? "workspaces";
}

/** Org settings: a side list of sections (workspaces, members, MCP servers) beside the active one. */
export function OrgSettingsShell({ githubLogin }: { githubLogin: string }) {
  const section = parseSection(useSearchParams().get("section"));

  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-8">
      <nav aria-label="Settings sections" className="flex md:flex-col gap-1 md:w-[180px] shrink-0">
        {SECTIONS.map((s) => {
          const active = s.id === section;
          return (
            <Link
              key={s.id}
              href={`/org/${githubLogin}/settings?section=${s.id}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {s.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex-1 min-w-0">
        {section === "workspaces" && <WorkspacesView githubLogin={githubLogin} />}
        {section === "members" && <MembersView githubLogin={githubLogin} />}
        {section === "mcp" && <OrgSettingsView githubLogin={githubLogin} />}
      </div>
    </div>
  );
}
