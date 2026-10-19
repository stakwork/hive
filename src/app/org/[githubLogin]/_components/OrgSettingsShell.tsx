import Link from "next/link";
import { cn } from "@/lib/utils";
import { MembersView } from "./MembersView";
import { OrgSettingsView } from "./OrgSettingsView";
import { WorkspacesView } from "./WorkspacesView";
import { JamieEngineSettings } from "./JamieEngineSettings";

/** `titled: false` — the section's own card carries its title. */
const SECTIONS = [
  { id: "workspaces", label: "Workspaces", titled: true },
  { id: "members", label: "Members", titled: true },
  { id: "mcp", label: "MCP servers", titled: false },
  { id: "jamie", label: "Jamie", titled: false },
] as const;

interface OrgSettingsShellProps {
  githubLogin: string;
  section?: string;
}

/** Org settings: the section list down the left, the open section beside it. */
export function OrgSettingsShell({ githubLogin, section }: OrgSettingsShellProps) {
  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="Settings sections" className="w-52 shrink-0 border-r px-3 py-6 flex flex-col gap-0.5">
        <div className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Settings</div>
        {SECTIONS.map((s) => (
          <Link
            key={s.id}
            href={`/org/${githubLogin}/settings?section=${s.id}`}
            aria-current={active.id === s.id ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm transition-colors",
              active.id === s.id
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl px-8 py-6">
          {active.titled && <h1 className="mb-5 text-xl font-semibold">{active.label}</h1>}
          {active.id === "workspaces" && <WorkspacesView githubLogin={githubLogin} />}
          {active.id === "members" && <MembersView githubLogin={githubLogin} />}
          {active.id === "mcp" && <OrgSettingsView githubLogin={githubLogin} />}
          {active.id === "jamie" && <JamieEngineSettings githubLogin={githubLogin} />}
        </div>
      </div>
    </div>
  );
}
