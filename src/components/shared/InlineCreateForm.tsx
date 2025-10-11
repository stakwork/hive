"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface InlineCreateFormProps {
  placeholder: string;
  buttonText: string;
  buttonIcon?: React.ComponentType<{ className?: string }>;
  onSubmit: (value: string) => Promise<void> | void;
  onCancel?: () => void;
  autoFocus?: boolean;
  keepOpenAfterSubmit?: boolean;
  additionalFields?: ReactNode;
  className?: string;
}

export function InlineCreateForm({
  placeholder,
  buttonText,
  buttonIcon: ButtonIcon,
  onSubmit,
  onCancel,
  autoFocus = true,
  keepOpenAfterSubmit = false,
  additionalFields,
  className = "",
}: InlineCreateFormProps) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && !loading && !value) {
      inputRef.current?.focus();
    }
  }, [autoFocus, loading, value]);

  const handleSubmit = async () => {
    if (!value.trim() || loading) return;

    try {
      setLoading(true);
      await onSubmit(value.trim());
      setValue("");

      if (!keepOpenAfterSubmit && onCancel) {
        onCancel();
      }
    } catch (error) {
      console.error("Failed to submit:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          className="flex-1"
          autoFocus={autoFocus}
        />
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={loading || !value.trim()}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              {ButtonIcon && <ButtonIcon className="h-4 w-4 mr-2" />}
              {buttonText}
            </>
          )}
        </Button>
      </div>

      {additionalFields && (
        <div className="flex items-center gap-4">
          {additionalFields}
        </div>
      )}

      {onCancel && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
