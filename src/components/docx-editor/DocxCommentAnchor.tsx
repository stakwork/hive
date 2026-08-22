"use client";
import React from "react";
import { MessageSquare } from "lucide-react";

interface Props {
  commentId: string;
  isActive: boolean;
  onActivate: (id: string) => void;
}

export default function DocxCommentAnchor({ commentId, isActive, onActivate }: Props) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onActivate(commentId);
      }}
      className={`inline-flex items-center justify-center ml-0.5 align-middle w-4 h-4 rounded-sm text-xs cursor-pointer transition-colors ${
        isActive
          ? "bg-amber-400 text-white"
          : "bg-amber-200 text-amber-700 hover:bg-amber-300"
      }`}
      title="View comment"
      aria-label="View comment"
    >
      <MessageSquare className="size-2.5" />
    </button>
  );
}
