import { X, Bug } from "lucide-react";
import { Artifact, BugReportContent } from "@/lib/chat";

interface InputDebugAttachmentProps {
  attachment: Artifact;
  onRemove: () => void;
}

export function InputDebugAttachment({ attachment, onRemove }: InputDebugAttachmentProps) {
  const content = attachment.content as BugReportContent;

  const coordinateText =
    content.method === "click"
      ? `Click at (${content.coordinates?.x}, ${content.coordinates?.y})`
      : `Area (${content.coordinates?.x}, ${content.coordinates?.y}) → (${(content.coordinates?.x || 0) + (content.coordinates?.width || 0)}, ${(content.coordinates?.y || 0) + (content.coordinates?.height || 0)}) • ${content.coordinates?.width}×${content.coordinates?.height}px`;

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-orange-50 border border-orange-200 text-sm">
      <Bug className="w-4 h-4 text-orange-600" />
      <span className="text-orange-900 font-medium">Element Analysis</span>
      <span className="text-orange-700">{coordinateText}</span>
      <button
        onClick={onRemove}
        className="ml-1 p-0.5 rounded hover:bg-orange-200 transition-colors"
        title="Remove attachment"
      >
        <X className="w-3.5 h-3.5 text-orange-600" />
      </button>
    </div>
  );
}
