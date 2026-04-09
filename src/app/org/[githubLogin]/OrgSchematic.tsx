"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DiagramViewer } from "@/app/w/[slug]/learn/components/DiagramViewer";

const STARTER_TEMPLATE = `graph TD
  A[Org] --> B[Workspace]`;

interface OrgSchematicProps {
  githubLogin: string;
}

export function OrgSchematic({ githubLogin }: OrgSchematicProps) {
  const [schematic, setSchematic] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/orgs/${githubLogin}/schematic`)
      .then((res) => res.json())
      .then((data) => setSchematic(data.schematic ?? null))
      .catch(() => setSchematic(null))
      .finally(() => setLoading(false));
  }, [githubLogin]);

  const handleEdit = () => {
    setDraft(schematic ?? STARTER_TEMPLATE);
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setDraft("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/orgs/${githubLogin}/schematic`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schematic: draft }),
      });
      if (res.ok) {
        const data = await res.json();
        setSchematic(data.schematic);
        setEditing(false);
        setDraft("");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="h-40 rounded-lg bg-muted animate-pulse" />;
  }

  if (editing) {
    return (
      <div className="space-y-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="font-mono text-sm min-h-[200px] resize-y"
          placeholder="Paste your Mermaid diagram here..."
        />
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button variant="outline" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (!schematic) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
        <p className="text-muted-foreground">No schematic yet.</p>
        <Button onClick={handleEdit}>Edit</Button>
      </div>
    );
  }

  return (
    <div className="relative" style={{ height: "60vh" }}>
      <Button
        size="sm"
        variant="outline"
        onClick={handleEdit}
        className="absolute top-2 right-2 z-20"
      >
        Edit
      </Button>
      <DiagramViewer name="Org Schematic" body={schematic} />
    </div>
  );
}
