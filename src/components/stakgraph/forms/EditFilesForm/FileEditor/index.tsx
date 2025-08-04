import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RotateCcw } from "lucide-react";
import React from "react";
import { FileIcon } from "../FileIcon";

interface FileEditorProps {
  name: string;
  type: string;
  value: string;
  originalValue: string;
  onChange: (value: string) => void;
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const getFileStats = (content: string) => {
  const lines = content.split("\n").length;
  const chars = content.length;
  const bytes = new Blob([content]).size;
  return { lines, chars, bytes };
};

export const FileEditor: React.FC<FileEditorProps> = ({
  name,
  type,
  value,
  originalValue,
  onChange,
}) => {
  const isModified = value !== originalValue;
  const stats = getFileStats(value);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileIcon type={type} />
          <span className="font-medium">{name}</span>
          {isModified && (
            <Badge variant="secondary" className="text-xs">
              Modified
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{stats.lines} lines</span>
          <span>•</span>
          <span>{formatBytes(stats.bytes)}</span>
        </div>
      </div>

      <div className="relative">
        <Textarea
          disabled={name === "pm2.config.js"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-sm min-h-[300px] resize-none"
        />
        {isModified && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange(originalValue)}
            className="absolute top-2 right-2"
          >
            <RotateCcw className="w-3 h-3 mr-1" />
            Reset
          </Button>
        )}
      </div>
    </div>
  );
};
