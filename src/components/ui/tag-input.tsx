import { useState, KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface TagInputProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  error?: string;
  id?: string;
}

export function TagInput({ items, onChange, placeholder, error, id }: TagInputProps) {
  const [inputValue, setInputValue] = useState("");

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || items.includes(trimmed)) return;
    onChange([...items, trimmed]);
    setInputValue("");
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, index) => (
            <Badge key={index} variant="secondary" className="flex items-center gap-1 pr-1">
              <span>{item}</span>
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 leading-none p-0.5"
                aria-label={`Remove ${item}`}
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        id={id}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
