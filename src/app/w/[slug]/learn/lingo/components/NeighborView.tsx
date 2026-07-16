"use client";

import React, { useRef, useState } from "react";
import { Trash2, Plus, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { LingoNode } from "@/app/api/mock/lingo/nodes";
import type { NeighborEdge, NeighborNode } from "@/app/api/mock/lingo/neighbors";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

interface NeighborViewProps {
  node: LingoNode;
  edges: NeighborEdge[];
  deletedEdgeIds: Set<string>;
  onDeleteEdge: (edgeRefId: string) => void;
  onDeleteNode: (refId: string) => void;
  onNavigate: (node: NeighborNode) => void;
  onAddEdge: () => void;
  workspaceSlug: string;
  workspaceId: string;
}

export function NeighborView({
  node,
  edges,
  deletedEdgeIds,
  onDeleteEdge,
  onDeleteNode,
  onNavigate,
  onAddEdge,
  workspaceSlug,
  workspaceId,
}: NeighborViewProps) {
  const visibleEdges = edges.filter(
    (e) => !deletedEdgeIds.has(e.edge_ref_id) && e.neighbor_node?.ref_id,
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Holds the s3Path after a successful PUT but failed PATCH — for retry
  const pendingS3PathRef = useRef<string | null>(null);
  const [currentIconUrl, setCurrentIconUrl] = useState<string | null | undefined>(node.icon_url);

  // Keep local icon in sync if node prop changes (e.g. navigation)
  React.useEffect(() => {
    setCurrentIconUrl(node.icon_url);
    pendingS3PathRef.current = null;
    setUploadError(null);
  }, [node.ref_id, node.icon_url]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected after a failure
    e.target.value = "";

    // Client-side validation
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setUploadError("Invalid file type. Please select a JPEG, PNG, GIF, or WebP image.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError("File is too large. Maximum size is 10 MB.");
      return;
    }

    setUploadError(null);
    setIsUploading(true);

    try {
      // If we already have a pending s3Path from a previous failed PATCH, retry that
      let s3Path = pendingS3PathRef.current;

      if (!s3Path) {
        // Step 1: Presign
        const presignRes = await fetch("/api/upload/presigned-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            filename: file.name,
            contentType: file.type,
            size: file.size,
            context: "lingo",
          }),
        });
        if (!presignRes.ok) {
          const err = await presignRes.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? "Failed to get upload URL");
        }
        const { presignedUrl, s3Path: path } = (await presignRes.json()) as {
          presignedUrl: string;
          s3Path: string;
        };
        s3Path = path;

        // Step 2: PUT to S3
        const putRes = await fetch(presignedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!putRes.ok) throw new Error("Failed to upload image to storage");

        // Store for potential PATCH retry
        pendingS3PathRef.current = s3Path;
      }

      // Step 3: PATCH node
      const patchRes = await fetch(
        `/api/workspaces/${workspaceSlug}/lingo/nodes/${encodeURIComponent(node.ref_id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ icon_url: s3Path }),
        },
      );

      if (!patchRes.ok) {
        // S3 object is already uploaded — surface retryable error, keep pendingS3PathRef
        toast.error("Icon saved to storage but node update failed — please try again");
        setUploadError("Node update failed. Click the upload button to retry.");
        return;
      }

      // Success — clear pending ref and update local icon
      pendingS3PathRef.current = null;
      setCurrentIconUrl(s3Path);
      toast.success("Icon updated");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleUploadClick = () => {
    if (!workspaceId || isUploading) return;
    // If there's a pending s3Path (step 2 succeeded, step 3 failed), retry PATCH directly
    if (pendingS3PathRef.current) {
      retryPatch(pendingS3PathRef.current);
      return;
    }
    fileInputRef.current?.click();
  };

  const retryPatch = async (s3Path: string) => {
    setIsUploading(true);
    setUploadError(null);
    try {
      const patchRes = await fetch(
        `/api/workspaces/${workspaceSlug}/lingo/nodes/${encodeURIComponent(node.ref_id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ icon_url: s3Path }),
        },
      );
      if (!patchRes.ok) {
        toast.error("Icon saved to storage but node update failed — please try again");
        setUploadError("Node update failed. Click the upload button to retry.");
        return;
      }
      pendingS3PathRef.current = null;
      setCurrentIconUrl(s3Path);
      toast.success("Icon updated");
    } catch {
      toast.error("Icon saved to storage but node update failed — please try again");
      setUploadError("Node update failed. Click the upload button to retry.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="neighbor-view">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        data-testid="icon-file-input"
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {currentIconUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/upload/presigned-url?s3Key=${encodeURIComponent(currentIconUrl)}`}
              alt=""
              loading="lazy"
              width={32}
              height={32}
              className="rounded object-cover shrink-0"
              data-testid="neighbor-icon-thumbnail"
            />
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-foreground truncate">{node.name}</h2>
            {node.definition && (
              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                {node.definition}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleUploadClick}
            disabled={!workspaceId || isUploading}
            className="shrink-0 p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Upload icon"
            data-testid="upload-icon-button"
          >
            <ImageIcon className="w-4 h-4" />
            <span className="sr-only">{isUploading ? "Uploading…" : "Upload icon"}</span>
          </button>
          <button
            onClick={() => onDeleteNode(node.ref_id)}
            className="shrink-0 p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            aria-label={`Delete node ${node.name}`}
            data-testid="delete-node-button"
          >
            <Trash2 className="w-4 h-4" />
            <span className="sr-only">Delete node</span>
          </button>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={onAddEdge}
            data-testid="add-connection-button"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add connection
          </Button>
        </div>
      </div>

      {/* Upload error */}
      {uploadError && (
        <p className="text-sm text-destructive" data-testid="upload-error">
          {uploadError}
        </p>
      )}

      {/* Connections */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Connections ({visibleEdges.length})
        </h3>

        {visibleEdges.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
            No connections yet. Add one to enrich the graph.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border overflow-hidden" data-testid="neighbor-edge-list">
            {visibleEdges.map((edge) => (
              <li
                key={edge.edge_ref_id}
                className="flex items-center justify-between gap-3 px-4 py-3 bg-card hover:bg-accent/50 transition-colors"
                data-testid={`neighbor-edge-${edge.edge_ref_id}`}
              >
                <button
                  className="flex-1 min-w-0 text-left text-sm font-medium text-foreground hover:text-primary truncate"
                  onClick={() => onNavigate(edge.neighbor_node)}
                  data-testid={`navigate-neighbor-${edge.neighbor_node.ref_id}`}
                >
                  {edge.neighbor_node.name}
                </button>
                {edge.neighbor_node.node_type === "Lingo" && edge.neighbor_node.lingo_type && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs bg-muted text-muted-foreground font-mono"
                    data-testid={`lingo-type-badge-${edge.edge_ref_id}`}
                  >
                    {edge.neighbor_node.lingo_type}
                  </span>
                )}
                <span className="shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground bg-muted">
                  {edge.edge_type}
                </span>
                <button
                  onClick={() => onDeleteEdge(edge.edge_ref_id)}
                  className="shrink-0 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  aria-label={`Delete edge to ${edge.neighbor_node.name}`}
                  data-testid={`delete-edge-${edge.edge_ref_id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
