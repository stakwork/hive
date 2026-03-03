"use client";

import React, { useState } from "react";
import {
  BookOpen,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  Search,
  FileText,
  Zap,
  Layers,
  Hash,
  FolderOpen,
  Star,
  Clock,
  Tag,
  GitBranch,
  Database,
  Code2,
  Cpu,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────
// Mock data
// ──────────────────────────────────────────────
const MOCK_DOCS = [
  { repoName: "hive-core", content: "Core architecture docs", category: "Backend" },
  { repoName: "hive-frontend", content: "Frontend component docs", category: "Frontend" },
  { repoName: "hive-api", content: "REST API reference", category: "Backend" },
  { repoName: "hive-auth", content: "Auth & permissions guide", category: "Security" },
  { repoName: "hive-workers", content: "Background job docs", category: "Backend" },
];

const MOCK_CONCEPTS = [
  { id: "1", name: "Workspace Isolation", tag: "Architecture", pinned: true, updatedAt: "2h ago" },
  { id: "2", name: "Dual Task Status", tag: "Data Model", pinned: false, updatedAt: "1d ago" },
  { id: "3", name: "Streaming Responses", tag: "AI", pinned: true, updatedAt: "3h ago" },
  { id: "4", name: "Field Encryption", tag: "Security", pinned: false, updatedAt: "5d ago" },
  { id: "5", name: "Janitor Workflows", tag: "Automation", pinned: false, updatedAt: "2d ago" },
  { id: "6", name: "Pod Orchestration", tag: "Infrastructure", pinned: false, updatedAt: "1w ago" },
];

const USAGE = { inputTokens: 12480, outputTokens: 4320, cost: 0.043 };

// ──────────────────────────────────────────────
// Category icon map
// ──────────────────────────────────────────────
const categoryIcon: Record<string, React.ReactNode> = {
  Backend: <Database className="h-3 w-3" />,
  Frontend: <Code2 className="h-3 w-3" />,
  Security: <Zap className="h-3 w-3" />,
};

const tagColor: Record<string, string> = {
  Architecture: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Data Model": "bg-purple-500/10 text-purple-400 border-purple-500/20",
  AI: "bg-green-500/10 text-green-400 border-green-500/20",
  Security: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  Automation: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  Infrastructure: "bg-red-500/10 text-red-400 border-red-500/20",
};

// ──────────────────────────────────────────────
// VARIATION A — Current-style (accordion, clean)
// ──────────────────────────────────────────────
function VariationA() {
  const [docsOpen, setDocsOpen] = useState(true);
  const [conceptsOpen, setConceptsOpen] = useState(true);
  const [active, setActive] = useState<string | null>("doc-0");

  return (
    <div className="w-72 border border-border rounded-xl bg-background h-[560px] flex flex-col overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Knowledge Base
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Docs */}
        <div>
          <button
            onClick={() => setDocsOpen(!docsOpen)}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Docs</span>
              <Badge variant="secondary" className="text-xs h-4 px-1.5">
                {MOCK_DOCS.length}
              </Badge>
            </div>
            <ChevronDown
              className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", docsOpen && "rotate-180")}
            />
          </button>

          {docsOpen && (
            <div className="mt-1 space-y-0.5 pl-1">
              {MOCK_DOCS.map((doc, i) => (
                <button
                  key={i}
                  onClick={() => setActive(`doc-${i}`)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                    active === `doc-${i}`
                      ? "bg-muted/70 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  )}
                >
                  {doc.repoName}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Concepts */}
        <div>
          <button
            onClick={() => setConceptsOpen(!conceptsOpen)}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Concepts</span>
              <Badge variant="secondary" className="text-xs h-4 px-1.5">
                {MOCK_CONCEPTS.length}
              </Badge>
            </div>
            <ChevronDown
              className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", conceptsOpen && "rotate-180")}
            />
          </button>

          {conceptsOpen && (
            <div className="mt-1 space-y-0.5 pl-1">
              {MOCK_CONCEPTS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActive(`concept-${c.id}`)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                    active === `concept-${c.id}`
                      ? "bg-muted/70 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Usage footer */}
      <div className="border-t border-border px-4 py-3 bg-muted/20">
        <p className="text-xs text-muted-foreground">
          {USAGE.inputTokens.toLocaleString()} in · {USAGE.outputTokens.toLocaleString()} out ·{" "}
          <span className="text-foreground font-medium">${USAGE.cost}</span>
        </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// VARIATION B — Icon rail + flyout panel
// ──────────────────────────────────────────────
function VariationB() {
  const [activeSection, setActiveSection] = useState<"docs" | "concepts" | null>("docs");
  const [active, setActive] = useState<string | null>("doc-0");
  const [query, setQuery] = useState("");

  const filteredDocs = MOCK_DOCS.filter((d) =>
    d.repoName.toLowerCase().includes(query.toLowerCase())
  );
  const filteredConcepts = MOCK_CONCEPTS.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="flex h-[560px] rounded-xl border border-border overflow-hidden shadow-sm bg-background">
      {/* Icon rail */}
      <div className="w-12 bg-muted/30 border-r border-border flex flex-col items-center py-3 gap-1">
        {[
          { id: "docs" as const, icon: <BookOpen className="h-4 w-4" />, label: "Docs" },
          { id: "concepts" as const, icon: <Lightbulb className="h-4 w-4" />, label: "Concepts" },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveSection(activeSection === item.id ? null : item.id)}
            title={item.label}
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
              activeSection === item.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            {item.icon}
          </button>
        ))}
        <div className="flex-1" />
        <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
          <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>

      {/* Panel */}
      {activeSection && (
        <div className="w-60 flex flex-col border-r border-border">
          <div className="px-3 py-3 border-b border-border space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              {activeSection === "docs" ? "Docs" : "Concepts"}
            </p>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
                className="h-7 pl-6 text-xs"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {activeSection === "docs" &&
              filteredDocs.map((doc, i) => (
                <button
                  key={i}
                  onClick={() => setActive(`doc-${i}`)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2",
                    active === `doc-${i}`
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  )}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  {doc.repoName}
                </button>
              ))}
            {activeSection === "concepts" &&
              filteredConcepts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActive(`concept-${c.id}`)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                    active === `concept-${c.id}`
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  )}
                >
                  <span className="block">{c.name}</span>
                  <span className={cn("inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded border", tagColor[c.tag])}>
                    {c.tag}
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// VARIATION C — Flat list with category groups + search
// ──────────────────────────────────────────────
function VariationC() {
  const [active, setActive] = useState<string | null>("doc-0");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"all" | "docs" | "concepts">("all");

  const filteredDocs = MOCK_DOCS.filter((d) =>
    d.repoName.toLowerCase().includes(query.toLowerCase())
  );
  const filteredConcepts = MOCK_CONCEPTS.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="w-72 border border-border rounded-xl bg-background h-[560px] flex flex-col overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 space-y-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs & concepts…"
            className="pl-8 h-8 text-sm"
          />
        </div>
        {/* Tabs */}
        <div className="flex gap-1 bg-muted/40 rounded-lg p-1">
          {(["all", "docs", "concepts"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 text-xs py-1 rounded-md transition-colors capitalize",
                tab === t
                  ? "bg-background text-foreground shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {(tab === "all" || tab === "docs") && filteredDocs.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2 px-1">
              <BookOpen className="h-3 w-3 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Docs
              </span>
            </div>
            <div className="space-y-0.5">
              {filteredDocs.map((doc, i) => (
                <button
                  key={i}
                  onClick={() => setActive(`doc-${i}`)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2.5 transition-colors group",
                    active === `doc-${i}`
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  )}
                >
                  <div className={cn(
                    "w-5 h-5 rounded flex items-center justify-center shrink-0",
                    active === `doc-${i}` ? "bg-primary/20" : "bg-muted/60"
                  )}>
                    {categoryIcon[doc.category] ?? <FileText className="h-3 w-3" />}
                  </div>
                  <span className="truncate">{doc.repoName}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {(tab === "all" || tab === "concepts") && filteredConcepts.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2 px-1">
              <Lightbulb className="h-3 w-3 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Concepts
              </span>
            </div>
            <div className="space-y-0.5">
              {filteredConcepts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActive(`concept-${c.id}`)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg text-sm flex items-start gap-2.5 transition-colors",
                    active === `concept-${c.id}`
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  )}
                >
                  <div className={cn(
                    "w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5",
                    active === `concept-${c.id}` ? "bg-primary/20" : "bg-muted/60"
                  )}>
                    <Hash className="h-3 w-3" />
                  </div>
                  <div className="min-w-0">
                    <span className="block truncate">{c.name}</span>
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded border mt-0.5 inline-block",
                      tagColor[c.tag]
                    )}>
                      {c.tag}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border px-4 py-2 bg-muted/20 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{USAGE.inputTokens.toLocaleString()} tokens</span>
        <span className="text-[11px] text-foreground font-medium">${USAGE.cost}</span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// VARIATION D — Rich cards with pinned + recents
// ──────────────────────────────────────────────
function VariationD() {
  const [active, setActive] = useState<string | null>("concept-1");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    pinned: true,
    docs: false,
    recent: true,
  });

  const toggle = (g: string) => setOpenGroups((p) => ({ ...p, [g]: !p[g] }));
  const pinned = MOCK_CONCEPTS.filter((c) => c.pinned);
  const recent = MOCK_CONCEPTS.filter((c) => !c.pinned).slice(0, 3);

  return (
    <div className="w-72 border border-border rounded-xl bg-background h-[560px] flex flex-col overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Learn</span>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {MOCK_DOCS.length + MOCK_CONCEPTS.length} items
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* Pinned */}
        <div className="rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => toggle("pinned")}
            className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Star className="h-3.5 w-3.5 text-yellow-500" />
              <span className="text-xs font-semibold">Pinned</span>
            </div>
            <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", openGroups.pinned && "rotate-90")} />
          </button>
          {openGroups.pinned && (
            <div className="divide-y divide-border/50">
              {pinned.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActive(`concept-${c.id}`)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 transition-colors flex items-start gap-2.5",
                    active === `concept-${c.id}`
                      ? "bg-primary/10"
                      : "hover:bg-muted/30"
                  )}
                >
                  <Lightbulb className={cn(
                    "h-3.5 w-3.5 mt-0.5 shrink-0",
                    active === `concept-${c.id}` ? "text-primary" : "text-muted-foreground"
                  )} />
                  <div>
                    <p className={cn("text-sm leading-tight", active === `concept-${c.id}` ? "text-primary font-medium" : "text-foreground")}>
                      {c.name}
                    </p>
                    <span className={cn("text-[10px] px-1 py-0.5 rounded border mt-1 inline-block", tagColor[c.tag])}>
                      {c.tag}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Docs */}
        <div className="rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => toggle("docs")}
            className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <BookOpen className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-xs font-semibold">Repositories</span>
              <span className="text-[10px] text-muted-foreground">({MOCK_DOCS.length})</span>
            </div>
            <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", openGroups.docs && "rotate-90")} />
          </button>
          {openGroups.docs && (
            <div className="divide-y divide-border/50">
              {MOCK_DOCS.map((doc, i) => (
                <button
                  key={i}
                  onClick={() => setActive(`doc-${i}`)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 transition-colors flex items-center gap-2.5",
                    active === `doc-${i}` ? "bg-primary/10" : "hover:bg-muted/30"
                  )}
                >
                  <GitBranch className={cn("h-3.5 w-3.5 shrink-0", active === `doc-${i}` ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn("text-sm", active === `doc-${i}` ? "text-primary font-medium" : "text-foreground")}>
                    {doc.repoName}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Recent */}
        <div className="rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => toggle("recent")}
            className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold">Recent</span>
            </div>
            <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", openGroups.recent && "rotate-90")} />
          </button>
          {openGroups.recent && (
            <div className="divide-y divide-border/50">
              {recent.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActive(`concept-${c.id}`)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 transition-colors flex items-center justify-between",
                    active === `concept-${c.id}` ? "bg-primary/10" : "hover:bg-muted/30"
                  )}
                >
                  <span className={cn("text-sm", active === `concept-${c.id}` ? "text-primary font-medium" : "text-foreground")}>
                    {c.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{c.updatedAt}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border px-4 py-2.5 bg-muted/20 flex items-center gap-3">
        <Tag className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground flex-1">
          {USAGE.inputTokens.toLocaleString()} · {USAGE.outputTokens.toLocaleString()} tokens
        </span>
        <span className="text-[11px] font-semibold text-foreground">${USAGE.cost}</span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Page — Final selection: Variation A
// ──────────────────────────────────────────────
export default function SidebarPrototypePage() {
  return (
    <div className="min-h-screen bg-muted/20 p-8">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Sidebar — Final Selection</h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500/15 text-green-500 border border-green-500/20">
              ✓ Chosen: Variation A
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Clean accordion-style sidebar with collapsible Docs &amp; Concepts sections and a usage footer.
          </p>
        </div>

        <VariationA />
      </div>
    </div>
  );
}
