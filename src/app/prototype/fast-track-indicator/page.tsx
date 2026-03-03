"use client";

import React, { useState } from "react";

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_MESSAGES = [
  {
    id: "1",
    role: "USER",
    content: "Build a user authentication system with email/password and OAuth support",
    avatar: "JD",
  },
  {
    id: "2",
    role: "ASSISTANT",
    content:
      "I've analyzed your request and created a feature plan for the authentication system. I'm now running through the full planning pipeline automatically — no input needed from you.",
  },
];

const PIPELINE_STEPS = [
  { id: "brief",        label: "Feature Brief",   status: "done"    },
  { id: "stories",      label: "User Stories",    status: "done"    },
  { id: "requirements", label: "Requirements",    status: "active"  },
  { id: "architecture", label: "Architecture",    status: "pending" },
  { id: "tasks",        label: "Task Generation", status: "pending" },
];

type TaskStatus = "queued" | "in_progress" | "completed" | "failed";

interface MockTask {
  id: string;
  title: string;
  status: TaskStatus;
  autoMerge: boolean;
}

const INITIAL_TASKS: MockTask[] = [
  { id: "t1", title: "Set up NextAuth.js with GitHub OAuth provider",      status: "completed",   autoMerge: true  },
  { id: "t2", title: "Implement email/password login with bcrypt hashing",  status: "in_progress", autoMerge: true  },
  { id: "t3", title: "Create protected route middleware",                   status: "queued",      autoMerge: true  },
  { id: "t4", title: "Add JWT session token refresh logic",                 status: "queued",      autoMerge: false },
  { id: "t5", title: "Write unit tests for auth service",                   status: "failed",      autoMerge: false },
];

const STATUS_CONFIG: Record<TaskStatus, { label: string; dot: string; text: string; bg: string }> = {
  completed:   { label: "Done",        dot: "bg-emerald-400",              text: "text-emerald-400", bg: "bg-emerald-400/10" },
  in_progress: { label: "In Progress", dot: "bg-amber-400 animate-pulse",  text: "text-amber-300",   bg: "bg-amber-400/10"   },
  queued:      { label: "Queued",      dot: "bg-neutral-500",              text: "text-neutral-400", bg: "bg-neutral-700/50" },
  failed:      { label: "Failed",      dot: "bg-red-400",                  text: "text-red-400",     bg: "bg-red-400/10"     },
};

// ─── Shared Sub-components ────────────────────────────────────────────────────

function HiveLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
      <polygon points="12,2 20,7 20,17 12,22 4,17 4,7" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <polygon points="12,7 16,9.5 16,14.5 12,17 8,14.5 8,9.5" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

function HiveAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
      <HiveLogo />
    </div>
  );
}

function UserAvatar({ initials }: { initials: string }) {
  return (
    <div className="w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
      {initials}
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1 h-1 rounded-full bg-current animate-bounce"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
        />
      ))}
    </span>
  );
}

function PipelineStep({ step }: { step: (typeof PIPELINE_STEPS)[0] }) {
  const isDone   = step.status === "done";
  const isActive = step.status === "active";
  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center
        ${isDone ? "bg-emerald-500" : isActive ? "bg-amber-400" : "bg-neutral-700"}`}>
        {isDone ? (
          <svg viewBox="0 0 12 12" fill="none" className="w-2.5 h-2.5">
            <polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : isActive ? (
          <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        ) : (
          <div className="w-1 h-1 rounded-full bg-neutral-500" />
        )}
      </div>
      <span className={`text-xs ${isDone ? "text-neutral-300 line-through" : isActive ? "text-amber-300 font-medium" : "text-neutral-500"}`}>
        {step.label}
      </span>
      {isActive && <TypingDots />}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-4 w-7 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none
        ${on ? "bg-emerald-500" : "bg-neutral-600"}`}
    >
      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform duration-200
        ${on ? "translate-x-3.5" : "translate-x-0.5"}`} />
    </button>
  );
}

function DisabledInputBar() {
  return (
    <div className="border border-neutral-700 rounded-xl px-4 py-3 bg-neutral-800/50 flex items-center gap-3 opacity-50 cursor-not-allowed select-none">
      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-neutral-500 flex-shrink-0">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className="text-neutral-500 text-sm flex-1">Input not required in Fast-Track mode</span>
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-neutral-600 flex-shrink-0">
        <line x1="22" y1="2" x2="11" y2="13" stroke="currentColor" strokeWidth="1.5" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

// ─── Pipeline Panel ───────────────────────────────────────────────────────────

function PipelinePanel() {
  return (
    <div className="border-t border-neutral-700 bg-neutral-800/60 px-4 py-3 flex-shrink-0">
      <div className="flex items-start gap-3">
        <div className="p-1.5 rounded-lg bg-amber-400/10 border border-amber-400/20 flex-shrink-0 text-amber-400">
          <HiveLogo />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-neutral-200">Hive Auto-Pipeline</span>
            <span className="text-[10px] text-amber-300 bg-amber-400/10 px-1.5 py-0.5 rounded">
              {PIPELINE_STEPS.filter((s) => s.status === "done").length} of {PIPELINE_STEPS.length} done
            </span>
          </div>
          <div className="space-y-0.5">
            {PIPELINE_STEPS.map((step) => (
              <PipelineStep key={step.id} step={step} />
            ))}
          </div>
          <p className="mt-2 text-[10px] text-neutral-500">
            Tasks will appear in the Tasks tab when complete.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Task Panel (Variation A — Inline Dot Row) ────────────────────────────────

function TaskPanel({ tasks, onToggle }: { tasks: MockTask[]; onToggle: (id: string) => void }) {
  return (
    <div className="border-t border-neutral-700 bg-neutral-900 flex-shrink-0">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-neutral-400">
            <path d="M9 11l3 3L22 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="text-[11px] font-semibold text-neutral-300 uppercase tracking-wider">Tasks</span>
          <span className="text-[10px] bg-neutral-700 text-neutral-400 px-1.5 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </div>
        <span className="text-[10px] text-neutral-500">Auto-Merge</span>
      </div>

      {/* Task rows */}
      <div className="divide-y divide-neutral-800 max-h-48 overflow-y-auto">
        {tasks.map((task) => {
          const cfg = STATUS_CONFIG[task.status];
          return (
            <div key={task.id} className="flex items-center gap-3 px-4 py-2.5">
              {/* Status dot */}
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
              {/* Title */}
              <span className={`flex-1 text-xs leading-snug min-w-0 truncate ${
                task.status === "completed" ? "text-neutral-500 line-through" : "text-neutral-200"
              }`}>
                {task.title}
              </span>
              {/* Status badge */}
              <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${cfg.bg} ${cfg.text}`}>
                {cfg.label}
              </span>
              {/* Toggle */}
              <Toggle on={task.autoMerge} onChange={() => onToggle(task.id)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Full Chat Window ─────────────────────────────────────────────────────────

function ChatWindow({ tasks, onToggle }: { tasks: MockTask[]; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-col h-full bg-neutral-900 rounded-xl overflow-hidden border border-neutral-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-neutral-700 bg-neutral-800/60 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <HiveAvatar />
          <span className="text-sm font-semibold text-neutral-100">Authentication System</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-400/10 border border-amber-400/30 rounded-full">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-[11px] font-semibold text-amber-300 uppercase tracking-wider">Fast-Track</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {MOCK_MESSAGES.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === "USER" ? "justify-end" : "justify-start"}`}>
            {msg.role === "ASSISTANT" && <HiveAvatar />}
            <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
              msg.role === "USER"
                ? "bg-indigo-600 text-white rounded-br-sm"
                : "bg-neutral-800 text-neutral-100 rounded-bl-sm"
            }`}>
              {msg.content}
            </div>
            {msg.role === "USER" && <UserAvatar initials={(msg as { avatar?: string }).avatar ?? "?"} />}
          </div>
        ))}
      </div>

      {/* Pipeline tracker */}
      <PipelinePanel />

      {/* Task list */}
      <TaskPanel tasks={tasks} onToggle={onToggle} />

      {/* Disabled input */}
      <div className="px-4 pb-4 pt-2 flex-shrink-0">
        <DisabledInputBar />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FastTrackIndicatorPrototype() {
  const [tasks, setTasks] = useState<MockTask[]>(INITIAL_TASKS);

  const handleToggle = (id: string) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, autoMerge: !t.autoMerge } : t)));

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 py-10 px-6 flex flex-col items-center">
      {/* Page header */}
      <div className="w-full max-w-lg mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-neutral-800 border border-neutral-700 rounded-full text-xs text-neutral-400 mb-4">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          Prototype — Fast-Track Mode Indicator
        </div>
        <h1 className="text-xl font-bold text-neutral-100 mb-1">Chat Panel · Final Design</h1>
        <p className="text-neutral-400 text-sm">
          Pipeline tracker + task list with inline status dots and Auto-Merge toggles.
          Toggles are interactive.
        </p>
      </div>

      {/* Chat window */}
      <div className="w-full max-w-lg" style={{ height: "680px" }}>
        <ChatWindow tasks={tasks} onToggle={handleToggle} />
      </div>

      <p className="mt-8 text-xs text-neutral-600">Prototype only — mock data, no API calls.</p>
    </div>
  );
}
