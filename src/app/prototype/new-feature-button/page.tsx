"use client";

import { useState } from "react";
import {
  Plus,
  Sparkles,
  Map,
  CheckSquare,
  PenLine,
  BarChart3,
  TestTube2,
  Settings,
  ChevronRight,
  X,
  Search,
  MessageSquare,
  Zap,
  Command,
  Home,
  Bell,
  ArrowRight,
  Star,
  Clock,
  Users,
  Tag,
  MoreHorizontal,
  ChevronDown,
} from "lucide-react";

// ─── Mock Data ────────────────────────────────────────────────────────────────
const mockFeatures = [
  { id: "1", title: "User Authentication Overhaul", status: "IN_PROGRESS", priority: "HIGH", assignee: "Sarah K." },
  { id: "2", title: "AI-powered Code Review", status: "TODO", priority: "MEDIUM", assignee: "Alex M." },
  { id: "3", title: "Real-time Collaboration", status: "DONE", priority: "HIGH", assignee: "Jordan T." },
  { id: "4", title: "Mobile App Redesign", status: "TODO", priority: "LOW", assignee: "Chris P." },
];

const statusColor: Record<string, string> = {
  IN_PROGRESS: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  TODO: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  DONE: "bg-green-500/20 text-green-400 border-green-500/30",
};

const priorityColor: Record<string, string> = {
  HIGH: "text-red-400",
  MEDIUM: "text-yellow-400",
  LOW: "text-zinc-400",
};

// ─── Shared Mini Components ───────────────────────────────────────────────────
function FeatureRow({ feature }: { feature: (typeof mockFeatures)[0] }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 rounded-lg transition-colors cursor-pointer group">
      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[feature.status]}`}>
        {feature.status.replace("_", " ")}
      </span>
      <span className="text-sm text-zinc-200 flex-1 group-hover:text-white transition-colors">{feature.title}</span>
      <span className={`text-xs font-semibold ${priorityColor[feature.priority]}`}>{feature.priority}</span>
      <span className="text-xs text-zinc-500">{feature.assignee}</span>
    </div>
  );
}

function MockSidebar({ active = "plan" }: { active?: string }) {
  const items = [
    { icon: Home, label: "Graph", id: "graph" },
    { icon: CheckSquare, label: "Tasks", id: "tasks" },
    { icon: Map, label: "Plan", id: "plan" },
    { icon: PenLine, label: "Whiteboards", id: "whiteboards" },
    { icon: BarChart3, label: "Recommendations", id: "recs" },
    { icon: TestTube2, label: "Testing", id: "testing" },
  ];
  return (
    <div className="w-14 bg-zinc-900 border-r border-zinc-800 flex flex-col items-center py-4 gap-1 shrink-0">
      <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center mb-4">
        <Sparkles className="w-4 h-4 text-white" />
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          className={`w-10 h-10 rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
            active === item.id ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
          }`}
          title={item.label}
        >
          <item.icon className="w-4 h-4" />
        </div>
      ))}
      <div className="flex-1" />
      <div className="w-10 h-10 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-300 cursor-pointer">
        <Settings className="w-4 h-4" />
      </div>
    </div>
  );
}

function MockPlanPage({ children, title = "Plan" }: { children?: React.ReactNode; title?: string }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="h-12 bg-zinc-900/80 border-b border-zinc-800 flex items-center px-4 gap-3 shrink-0">
        <span className="text-sm text-zinc-400">hive</span>
        <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
        <span className="text-sm text-zinc-300">{title}</span>
        <div className="flex-1" />
        {children}
        <div className="w-7 h-7 rounded-full bg-violet-600/30 border border-violet-500/30 flex items-center justify-center text-xs text-violet-300 font-medium">S</div>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-white">Plan</h1>
            <p className="text-sm text-zinc-400 mt-0.5">{mockFeatures.length} features</p>
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs text-zinc-500">Filter features...</span>
          </div>
          {mockFeatures.map((f) => <FeatureRow key={f.id} feature={f} />)}
        </div>
      </div>
    </div>
  );
}

// ─── VARIATION A: Floating Action Button ─────────────────────────────────────
function VariationA() {
  const [fabOpen, setFabOpen] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white mb-1">Variation A — Floating Action Button</h3>
          <p className="text-xs text-zinc-400">Persistent FAB in bottom-right corner. Always accessible regardless of which page the user is on. Optionally expands to show quick actions.</p>
        </div>
        <span className="text-xs bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-1 rounded-full font-medium shrink-0">Always Visible</span>
      </div>

      {/* Mock UI */}
      <div className="rounded-xl overflow-hidden border border-zinc-700 bg-zinc-950" style={{ height: 380 }}>
        <div className="flex h-full relative">
          <MockSidebar active="plan" />
          <MockPlanPage />

          {/* FAB */}
          <div className="absolute bottom-5 right-5 flex flex-col items-end gap-2">
            {/* Expanded actions */}
            {fabOpen && (
              <div className="flex flex-col gap-2 mb-1 items-end animate-in slide-in-from-bottom-2 fade-in">
                {[
                  { icon: Map, label: "New Feature", color: "bg-violet-600 hover:bg-violet-500" },
                  { icon: CheckSquare, label: "New Task", color: "bg-blue-600 hover:bg-blue-500" },
                  { icon: PenLine, label: "New Whiteboard", color: "bg-zinc-700 hover:bg-zinc-600" },
                ].map((action) => (
                  <button
                    key={action.label}
                    className={`flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium text-white shadow-lg transition-colors ${action.color}`}
                  >
                    <action.icon className="w-3.5 h-3.5" />
                    {action.label}
                  </button>
                ))}
              </div>
            )}

            {/* Main FAB */}
            <button
              onClick={() => setFabOpen(!fabOpen)}
              className={`w-12 h-12 rounded-full shadow-2xl flex items-center justify-center transition-all duration-200 ${
                fabOpen
                  ? "bg-zinc-700 rotate-45"
                  : "bg-violet-600 hover:bg-violet-500 hover:scale-110"
              }`}
            >
              <Plus className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
          <div className="text-green-400 font-semibold mb-1">✓ Pros</div>
          <ul className="text-zinc-400 space-y-1">
            <li>• Always accessible</li>
            <li>• Familiar mobile pattern</li>
            <li>• Can expand to multiple actions</li>
          </ul>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <div className="text-red-400 font-semibold mb-1">✗ Cons</div>
          <ul className="text-zinc-400 space-y-1">
            <li>• Can obscure content</li>
            <li>• Less common in desktop apps</li>
            <li>• May feel out of place</li>
          </ul>
        </div>
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-3">
          <div className="text-zinc-300 font-semibold mb-1">Best for</div>
          <p className="text-zinc-400">Users who frequently create new features from any page</p>
        </div>
      </div>
    </div>
  );
}

// ─── VARIATION B: Top Nav Global Button ──────────────────────────────────────
function VariationB() {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white mb-1">Variation B — Global Top Nav Button</h3>
          <p className="text-xs text-zinc-400">A "New" button with dropdown lives in the top navigation bar alongside search. Present on every page. Dropdown expands to show available creation actions.</p>
        </div>
        <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-1 rounded-full font-medium shrink-0">Nav Bar</span>
      </div>

      {/* Mock UI */}
      <div className="rounded-xl overflow-hidden border border-zinc-700 bg-zinc-950" style={{ height: 380 }}>
        <div className="flex h-full relative">
          <MockSidebar active="plan" />

          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Top bar WITH the new button */}
            <div className="h-12 bg-zinc-900/80 border-b border-zinc-800 flex items-center px-4 gap-3 shrink-0">
              <span className="text-sm text-zinc-400">hive</span>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
              <span className="text-sm text-zinc-300">Plan</span>
              <div className="flex-1" />
              {/* Search pill */}
              <div className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-500 cursor-pointer hover:bg-zinc-700 transition-colors">
                <Search className="w-3 h-3" />
                <span>Search</span>
                <span className="ml-1 flex items-center gap-0.5 text-zinc-600">
                  <Command className="w-2.5 h-2.5" />K
                </span>
              </div>

              {/* NEW button with dropdown */}
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 transition-colors text-white text-xs font-medium rounded-lg px-3 py-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New
                  <ChevronDown className={`w-3 h-3 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
                </button>
                {dropdownOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-48 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden z-50 animate-in slide-in-from-top-1 fade-in">
                    {[
                      { icon: Map, label: "Feature", desc: "Plan a new feature", hot: true },
                      { icon: CheckSquare, label: "Task", desc: "Create a task" },
                      { icon: PenLine, label: "Whiteboard", desc: "Open a whiteboard" },
                    ].map((item) => (
                      <button key={item.label} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-700 transition-colors text-left">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${item.hot ? "bg-violet-600/30" : "bg-zinc-700"}`}>
                          <item.icon className={`w-3.5 h-3.5 ${item.hot ? "text-violet-400" : "text-zinc-400"}`} />
                        </div>
                        <div>
                          <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                            {item.label}
                            {item.hot && <span className="text-[10px] bg-violet-600/30 text-violet-400 px-1 rounded">Popular</span>}
                          </div>
                          <div className="text-[11px] text-zinc-500">{item.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="w-7 h-7 rounded-full bg-violet-600/30 border border-violet-500/30 flex items-center justify-center text-xs text-violet-300 font-medium">S</div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h1 className="text-xl font-semibold text-white">Plan</h1>
                  <p className="text-sm text-zinc-400 mt-0.5">{mockFeatures.length} features</p>
                </div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                {mockFeatures.slice(0, 3).map((f) => <FeatureRow key={f.id} feature={f} />)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
          <div className="text-green-400 font-semibold mb-1">✓ Pros</div>
          <ul className="text-zinc-400 space-y-1">
            <li>• Native to web apps</li>
            <li>• Context-aware dropdown</li>
            <li>• Doesn't block content</li>
          </ul>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <div className="text-red-400 font-semibold mb-1">✗ Cons</div>
          <ul className="text-zinc-400 space-y-1">
            <li>• Top bar can get crowded</li>
            <li>• Hidden on feature detail page</li>
            <li>• Extra click for dropdown</li>
          </ul>
        </div>
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-3">
          <div className="text-zinc-300 font-semibold mb-1">Best for</div>
          <p className="text-zinc-400">Teams who create multiple entity types and need clear context</p>
        </div>
      </div>
    </div>
  );
}

// ─── VARIATION C: Sidebar Shortcut ───────────────────────────────────────────
function VariationC() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white mb-1">Variation C — Sidebar Quick Action</h3>
          <p className="text-xs text-zinc-400">
            A "+" button lives right next to the "Plan" nav item in the sidebar. Hovering the sidebar item reveals a contextual create button. Clean and minimal.
          </p>
        </div>
        <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-1 rounded-full font-medium shrink-0">Contextual</span>
      </div>

      {/* Mock UI */}
      <div className="rounded-xl overflow-hidden border border-zinc-700 bg-zinc-950" style={{ height: 380 }}>
        <div className="flex h-full">
          {/* Enhanced sidebar */}
          <div className="w-48 bg-zinc-900 border-r border-zinc-800 flex flex-col py-4 shrink-0">
            {/* Logo */}
            <div className="flex items-center gap-2 px-3 mb-5">
              <div className="w-6 h-6 rounded-md bg-violet-600 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold text-white">hive</span>
            </div>

            {/* Nav items */}
            {[
              { icon: Home, label: "Graph" },
              { icon: CheckSquare, label: "Tasks", badge: 3 },
              { icon: Map, label: "Plan", active: true, showPlus: true },
              { icon: PenLine, label: "Whiteboards" },
              { icon: BarChart3, label: "Recommendations" },
              { icon: TestTube2, label: "Testing" },
            ].map((item) => (
              <div
                key={item.label}
                className={`flex items-center gap-2.5 mx-2 px-2.5 py-2 rounded-lg cursor-pointer group transition-colors ${
                  item.active ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200 hover:bg-white/5"
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span className="text-sm flex-1">{item.label}</span>
                {item.badge && (
                  <span className="text-[10px] bg-blue-600 text-white rounded-full w-4 h-4 flex items-center justify-center font-bold">{item.badge}</span>
                )}
                {item.showPlus && (
                  <button className="w-5 h-5 rounded-md bg-violet-600/40 hover:bg-violet-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                    <Plus className="w-3 h-3 text-violet-200" />
                  </button>
                )}
              </div>
            ))}

            <div className="flex-1" />
            <div className="mx-2 px-2.5 py-2 rounded-lg text-zinc-500 flex items-center gap-2.5 cursor-pointer hover:text-zinc-300">
              <Settings className="w-4 h-4" />
              <span className="text-sm">Settings</span>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="h-12 bg-zinc-900/80 border-b border-zinc-800 flex items-center px-4 gap-3 shrink-0">
              <span className="text-sm text-zinc-300">Plan</span>
              <div className="flex-1" />
              <div className="w-7 h-7 rounded-full bg-violet-600/30 border border-violet-500/30 flex items-center justify-center text-xs text-violet-300 font-medium">S</div>
            </div>
            <div className="flex-1 overflow-auto p-5">
              {/* Plan page header - no button needed since it's in sidebar */}
              <div className="mb-5">
                <h1 className="text-lg font-semibold text-white">Plan</h1>
                <p className="text-xs text-zinc-500 mt-0.5">Hover "Plan" in sidebar → click + to create a new feature</p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                {mockFeatures.slice(0, 3).map((f) => <FeatureRow key={f.id} feature={f} />)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
          <div className="text-green-400 font-semibold mb-1">✓ Pros</div>
          <ul className="text-zinc-400 space-y-1">
            <li>• Contextual & clean</li>
            <li>• Consistent with section</li>
            <li>• No extra UI clutter</li>
          </ul>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <div className="text-red-400 font-semibold mb-1">✗ Cons</div>
          <ul className="text-zinc-400 space-y-1">
            <li>• Hidden until hover</li>
            <li>• Not obvious on first use</li>
            <li>• Sidebar must be expanded</li>
          </ul>
        </div>
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-3">
          <div className="text-zinc-300 font-semibold mb-1">Best for</div>
          <p className="text-zinc-400">Power users who are familiar with the app — linear.app style</p>
        </div>
      </div>
    </div>
  );
}

// ─── VARIATION D: Feature Page Inline Header Button ──────────────────────────
function VariationD() {
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white mb-1">Variation D — Feature Page Header + Global Cmd+K</h3>
          <p className="text-xs text-zinc-400">
            "New Feature" button stays in the Plan page header. <em>Additionally</em>, the global search (Cmd+K) includes a "New Feature" quick action at the top, making it reachable from <em>any page</em>.
          </p>
        </div>
        <span className="text-xs bg-violet-500/20 text-violet-400 border border-violet-500/30 px-2 py-1 rounded-full font-medium shrink-0">Recommended</span>
      </div>

      {/* Mock UI */}
      <div className="rounded-xl overflow-hidden border border-zinc-700 bg-zinc-950" style={{ height: 420 }}>
        <div className="flex h-full relative">
          <MockSidebar active="plan" />

          {/* Content with button in header */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="h-12 bg-zinc-900/80 border-b border-zinc-800 flex items-center px-4 gap-3 shrink-0">
              <span className="text-sm text-zinc-400">hive</span>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
              <span className="text-sm text-zinc-300">Plan</span>
              <div className="flex-1" />
              {/* Search with new-feature shortcut hinted */}
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-500 cursor-pointer transition-colors"
              >
                <Search className="w-3 h-3" />
                <span>Search or create...</span>
                <span className="ml-1 flex items-center gap-0.5 text-zinc-600">
                  <Command className="w-2.5 h-2.5" />K
                </span>
              </button>
              <div className="w-px h-4 bg-zinc-700" />
              <div className="w-7 h-7 rounded-full bg-violet-600/30 border border-violet-500/30 flex items-center justify-center text-xs text-violet-300 font-medium">S</div>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {/* Plan page with its own button */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h1 className="text-xl font-semibold text-white">Plan</h1>
                  <p className="text-sm text-zinc-400 mt-0.5">{mockFeatures.length} features</p>
                </div>
                {/* Button in page header for Plan page context */}
                <button className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 transition-colors text-white text-sm font-medium rounded-lg px-4 py-2">
                  <Plus className="w-4 h-4" />
                  New Feature
                </button>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                {mockFeatures.map((f) => <FeatureRow key={f.id} feature={f} />)}
              </div>
            </div>
          </div>

          {/* CMD+K Modal */}
          {showModal && (
            <div className="absolute inset-0 bg-black/60 flex items-start justify-center pt-16 z-50" onClick={() => setShowModal(false)}>
              <div
                className="w-[480px] bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-top-2 fade-in"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Search input */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
                  <Search className="w-4 h-4 text-zinc-500 shrink-0" />
                  <input
                    className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 outline-none"
                    placeholder="Search or type a command..."
                    autoFocus
                  />
                  <button onClick={() => setShowModal(false)}>
                    <X className="w-4 h-4 text-zinc-500 hover:text-zinc-300" />
                  </button>
                </div>

                {/* Quick actions at top */}
                <div className="px-3 pt-3 pb-1">
                  <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider px-2 mb-1.5">Quick Create</p>
                  {[
                    { icon: Map, label: "New Feature", shortcut: "N F", color: "text-violet-400", bg: "bg-violet-600/20" },
                    { icon: CheckSquare, label: "New Task", shortcut: "N T", color: "text-blue-400", bg: "bg-blue-600/20" },
                    { icon: PenLine, label: "New Whiteboard", shortcut: "N W", color: "text-emerald-400", bg: "bg-emerald-600/20" },
                  ].map((action) => (
                    <button key={action.label} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors text-left group">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${action.bg}`}>
                        <action.icon className={`w-3.5 h-3.5 ${action.color}`} />
                      </div>
                      <span className="text-sm text-zinc-200 flex-1">{action.label}</span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {action.shortcut.split(" ").map((k) => (
                          <kbd key={k} className="text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded">{k}</kbd>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Recent items */}
                <div className="px-3 pt-2 pb-3">
                  <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider px-2 mb-1.5">Recent Features</p>
                  {mockFeatures.slice(0, 3).map((f) => (
                    <button key={f.id} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-left">
                      <Clock className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                      <span className="text-sm text-zinc-400 flex-1 truncate">{f.title}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${statusColor[f.status]}`}>{f.status.replace("_"," ")}</span>
                    </button>
                  ))}
                </div>

                <div className="border-t border-zinc-800 px-4 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-[11px] text-zinc-600">
                    <span className="flex items-center gap-1"><kbd className="bg-zinc-800 border border-zinc-700 px-1 rounded text-zinc-500">↑↓</kbd> navigate</span>
                    <span className="flex items-center gap-1"><kbd className="bg-zinc-800 border border-zinc-700 px-1 rounded text-zinc-500">↵</kbd> select</span>
                    <span className="flex items-center gap-1"><kbd className="bg-zinc-800 border border-zinc-700 px-1 rounded text-zinc-500">esc</kbd> close</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Click prompt */}
      <div className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
        <Zap className="w-3.5 h-3.5 text-violet-400" />
        <span>Click the search bar above to see how Cmd+K includes a "New Feature" quick action at the top</span>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
          <div className="text-green-400 font-semibold mb-1">✓ Pros</div>
          <ul className="text-zinc-400 space-y-1">
            <li>• Best of both worlds</li>
            <li>• Power users use Cmd+K</li>
            <li>• Contextual on plan page</li>
            <li>• Doesn't clutter the UI</li>
          </ul>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <div className="text-red-400 font-semibold mb-1">✗ Cons</div>
          <ul className="text-zinc-400 space-y-1">
            <li>• Cmd+K is discoverable but not obvious</li>
            <li>• Requires updating search component</li>
          </ul>
        </div>
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-3">
          <div className="text-zinc-300 font-semibold mb-1">Best for</div>
          <p className="text-zinc-400">Power users + newcomers — both pathways work naturally</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Prototype Page ──────────────────────────────────────────────────────
export default function NewFeatureButtonPrototype() {
  const [activeTab, setActiveTab] = useState<"A" | "B" | "C" | "D">("D");

  const tabs = [
    { id: "A", label: "A — FAB", desc: "Floating Action Button" },
    { id: "B", label: "B — Nav Button", desc: "Global top nav" },
    { id: "C", label: "C — Sidebar", desc: "Contextual sidebar +" },
    { id: "D", label: "D — Cmd+K", desc: "Header + command palette ⭐" },
  ] as const;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Page header */}
      <div className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">Prototype</span>
                <span className="text-xs text-zinc-600">•</span>
                <span className="text-xs text-zinc-500">New Feature Button Placement</span>
              </div>
              <h1 className="text-2xl font-bold text-white">Where to put "New Feature"?</h1>
              <p className="text-sm text-zinc-400 mt-1 max-w-xl">
                4 variations exploring how to make feature creation accessible from anywhere in the app — especially from the Plan and feature detail pages.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Sparkles className="w-3.5 h-3.5 text-violet-400" />
              <span>4 variations</span>
            </div>
          </div>

          {/* Tab switcher */}
          <div className="flex gap-2 mt-5 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? "bg-violet-600 text-white shadow-lg shadow-violet-600/20"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                }`}
              >
                {tab.label}
                {tab.id === "D" && <Star className="w-3 h-3 text-yellow-400" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Variation content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {activeTab === "A" && <VariationA />}
        {activeTab === "B" && <VariationB />}
        {activeTab === "C" && <VariationC />}
        {activeTab === "D" && <VariationD />}
      </div>

      {/* Summary comparison */}
      <div className="max-w-5xl mx-auto px-6 pb-10">
        <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-white">Quick Comparison</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium w-40">Variation</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Always Visible</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">On Feature Page</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Discoverable</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Keyboard</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Effort</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { id: "A", name: "FAB", always: "✅", featurePage: "✅", discover: "✅", kb: "❌", effort: "Low" },
                  { id: "B", name: "Nav Button", always: "✅", featurePage: "✅", discover: "✅", kb: "❌", effort: "Medium" },
                  { id: "C", name: "Sidebar +", always: "🔶", featurePage: "✅", discover: "🔶", kb: "❌", effort: "Low" },
                  { id: "D", name: "Cmd+K + Header", always: "✅", featurePage: "✅", discover: "✅", kb: "✅", effort: "Medium", recommended: true },
                ].map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setActiveTab(row.id as "A" | "B" | "C" | "D")}
                    className={`border-b border-zinc-800/50 cursor-pointer transition-colors ${
                      activeTab === row.id ? "bg-violet-600/10" : "hover:bg-white/3"
                    }`}
                  >
                    <td className="px-4 py-3 text-zinc-200 font-medium flex items-center gap-2">
                      <span className="text-zinc-500">{row.id}</span> {row.name}
                      {row.recommended && <Star className="w-3 h-3 text-yellow-400" />}
                    </td>
                    <td className="px-4 py-3 text-center">{row.always}</td>
                    <td className="px-4 py-3 text-center">{row.featurePage}</td>
                    <td className="px-4 py-3 text-center">{row.discover}</td>
                    <td className="px-4 py-3 text-center">{row.kb}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        row.effort === "Low" ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"
                      }`}>{row.effort}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
