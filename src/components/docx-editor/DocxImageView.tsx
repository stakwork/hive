"use client";
import React from "react";
import { useEffect } from "react";
import { DocxImageRun } from "@/lib/docx-engine/types/document";

interface Props {
  run: DocxImageRun;
}

export default function DocxImageView({ run }: Props) {
  const blobUrl = run.objectUrl;

  // Revoke the object URL when the component unmounts to free memory
  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  if (!blobUrl) return null;

  return (
    <img
      src={blobUrl}
      alt={run.altText ?? ""}
      className="inline-block max-w-full"
      style={{
        width: run.widthPx ?? undefined,
        height: run.heightPx ?? undefined,
      }}
    />
  );
}
