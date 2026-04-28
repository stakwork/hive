"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Pencil } from "lucide-react";
import type { OrgMemberResponse } from "@/types/workspace";

interface MemberCardProps {
  member: OrgMemberResponse;
  githubLogin: string;
  onDescriptionSaved: (userId: string, workspaceId: string, description: string) => void;
}

function MemberCard({ member, githubLogin, onDescriptionSaved }: MemberCardProps) {
  const name = member.name ?? member.githubUsername ?? "Unknown";

  const nonNullDescs = member.workspaceDescriptions.filter((d) => d.description !== null);
  const uniqueDescriptions = [...new Set(nonNullDescs.map((d) => d.description))];
  const hasMultiple = uniqueDescriptions.length > 1;

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(
    member.workspaceDescriptions[0]?.workspaceId ?? "",
  );
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const activeDesc = member.workspaceDescriptions.find(
    (d) => d.workspaceId === activeWorkspaceId,
  );

  const startEdit = (e: React.MouseEvent, workspaceId: string, currentDesc: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDraft(currentDesc ?? "");
    setEditingWorkspaceId(workspaceId);
  };

  const save = async () => {
    if (!editingWorkspaceId) return;
    const trimmed = draft.trim();
    onDescriptionSaved(member.id, editingWorkspaceId, trimmed);
    setEditingWorkspaceId(null);
    await fetch(`/api/orgs/${githubLogin}/members/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: editingWorkspaceId, description: trimmed }),
    });
  };

  const cancel = () => setEditingWorkspaceId(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      cancel();
    }
  };

  const renderDescriptionEdit = (workspaceId: string, description: string | null) => {
    const isEditing = editingWorkspaceId === workspaceId;
    if (isEditing) {
      return (
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
          placeholder="Add a description…"
          rows={2}
          className="resize-none text-sm mt-1"
          autoFocus
        />
      );
    }
    return (
      <div
        className="group/desc flex items-start gap-1.5 cursor-pointer rounded-md -mx-1 px-1 py-0.5 hover:bg-muted/50 transition-colors"
        onClick={(e) => startEdit(e, workspaceId, description)}
      >
        <span
          className={`text-xs leading-relaxed flex-1 ${
            description ? "text-muted-foreground" : "text-muted-foreground/50 italic"
          }`}
        >
          {description || "Add a description…"}
        </span>
        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/desc:opacity-100 transition-opacity mt-0.5 shrink-0" />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-1 min-w-[160px] max-w-[220px]">
      <div className="flex items-center gap-2.5">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={member.image ?? undefined} alt={name} />
          <AvatarFallback className="text-sm">{name[0].toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium truncate">{name}</span>
      </div>

      {hasMultiple ? (
        <div className="mt-1">
          <div className="flex flex-wrap gap-1 mb-1">
            {member.workspaceDescriptions.map((wd) => (
              <button
                key={wd.workspaceId}
                onClick={() => setActiveWorkspaceId(wd.workspaceId)}
                className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  activeWorkspaceId === wd.workspaceId
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-transparent text-muted-foreground border-border hover:border-foreground"
                }`}
              >
                {wd.workspaceName}
              </button>
            ))}
          </div>
          {activeDesc && renderDescriptionEdit(activeDesc.workspaceId, activeDesc.description)}
        </div>
      ) : (
        member.workspaceDescriptions[0] &&
        renderDescriptionEdit(
          member.workspaceDescriptions[0].workspaceId,
          member.workspaceDescriptions[0].description,
        )
      )}
    </div>
  );
}

interface MembersViewProps {
  githubLogin: string;
}

export function MembersView({ githubLogin }: MembersViewProps) {
  const [members, setMembers] = useState<OrgMemberResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/orgs/${githubLogin}/members`)
      .then((res) => res.json())
      .then((data) => setMembers(Array.isArray(data) ? data : []))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, [githubLogin]);

  const onDescriptionSaved = (
    userId: string,
    workspaceId: string,
    description: string,
  ) => {
    setMembers((prev) =>
      prev.map((m) =>
        m.id === userId
          ? {
              ...m,
              workspaceDescriptions: m.workspaceDescriptions.map((wd) =>
                wd.workspaceId === workspaceId ? { ...wd, description } : wd,
              ),
            }
          : m,
      ),
    );
  };

  if (loading) {
    return (
      <div className="flex flex-wrap gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
            <div className="h-4 w-24 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <p className="text-muted-foreground text-center py-12">
        No members found in this organization.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-6">
      {members.map((member) => (
        <MemberCard
          key={member.id}
          member={member}
          githubLogin={githubLogin}
          onDescriptionSaved={onDescriptionSaved}
        />
      ))}
    </div>
  );
}
