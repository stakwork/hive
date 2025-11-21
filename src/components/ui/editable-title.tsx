"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface EditableTitleProps {
  value: string;
  onChange: (value: string) => void;
  onBlur: (value: string) => void;
  placeholder?: string;
  size?: "large" | "xlarge";
  id?: string;
  className?: string;
}

const sizeClasses = {
  large: "!text-4xl",
  xlarge: "!text-5xl",
};

export function EditableTitle({
  value,
  onChange,
  onBlur,
  placeholder = "Enter title...",
  size = "large",
  id,
  className,
}: EditableTitleProps) {
  return (
    <Input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onBlur(e.target.value)}
      className={cn(
        "!font-bold !h-auto !py-0 !px-0 !border-none !bg-transparent !shadow-none",
        "focus-visible:!ring-0 focus-visible:!border-none focus:!border-none",
        "focus:!bg-transparent focus:!shadow-none focus:!ring-0 focus:!outline-none",
        "!tracking-tight !rounded-none flex-1",
        sizeClasses[size],
        className,
      )}
      placeholder={placeholder}
    />
  );
}
