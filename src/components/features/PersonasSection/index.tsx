"use client";

import { useEffect, useRef, useState } from "react";
import { X, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { COMMON_PERSONAS } from "@/lib/constants/personas";

interface PersonasSectionProps {
  personas: string[];
  savedField: string | null;
  saving: boolean;
  saved: boolean;
  onChange: (personas: string[]) => void;
  onBlur: (personas: string[]) => void;
}

export function PersonasSection({
  personas,
  savedField,
  saving,
  saved,
  onChange,
  onBlur,
}: PersonasSectionProps) {
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const handleAddPersona = (persona: string) => {
    const trimmedPersona = persona.trim();
    if (trimmedPersona && !personas.includes(trimmedPersona)) {
      const newPersonas = [...personas, trimmedPersona];
      onChange(newPersonas);
      onBlur(newPersonas);
      setInputValue("");
    }
  };

  const handleRemovePersona = (personaToRemove: string) => {
    const newPersonas = personas.filter((p) => p !== personaToRemove);
    onChange(newPersonas);
    onBlur(newPersonas);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      handleAddPersona(inputValue);
    } else if (e.key === "Backspace" && !inputValue && personas.length > 0) {
      e.preventDefault();
      handleRemovePersona(personas[personas.length - 1]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  // Filter out personas that are already added
  const availablePersonas = COMMON_PERSONAS.filter(
    (p) => !personas.includes(p)
  );

  const filteredPersonas = availablePersonas.filter((p) =>
    p.toLowerCase().includes(inputValue.toLowerCase())
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor="personas" className="text-sm font-medium">
          User Personas
        </Label>
        {savedField === "personas" && saving && (
          <span className="text-xs text-muted-foreground">Saving...</span>
        )}
        {savedField === "personas" && saved && !saving && (
          <div className="flex items-center gap-1 text-xs">
            <Check className="h-3 w-3 text-green-600" />
            <span className="text-green-600">Saved</span>
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="flex flex-wrap gap-2 mb-2">
          {personas.map((persona) => (
            <Badge
              key={persona}
              variant="secondary"
              className="gap-1 pr-1 hover:bg-secondary/80"
            >
              <span>{persona}</span>
              <button
                onClick={() => handleRemovePersona(persona)}
                className="ml-1 rounded-full hover:bg-secondary-foreground/20 p-0.5"
                aria-label={`Remove ${persona}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>

        <div className="flex gap-2">
          <div
            ref={containerRef}
            className="relative flex-1"
            onFocusCapture={() => {
              if (closeTimeoutRef.current) {
                window.clearTimeout(closeTimeoutRef.current);
                closeTimeoutRef.current = null;
              }
              setIsOpen(true);
            }}
            onBlurCapture={() => {
              if (closeTimeoutRef.current) {
                window.clearTimeout(closeTimeoutRef.current);
              }
              closeTimeoutRef.current = window.setTimeout(() => {
                const root = containerRef.current;
                if (!root) {
                  setIsOpen(false);
                  closeTimeoutRef.current = null;
                  return;
                }
                const activeElement = document.activeElement;
                if (!activeElement || !root.contains(activeElement)) {
                  setIsOpen(false);
                }
                closeTimeoutRef.current = null;
              }, 0);
            }}
          >
            <Input
              id="personas"
              placeholder="Add persona (e.g., End User, Admin)..."
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                if (!isOpen && (e.target.value || availablePersonas.length > 0)) {
                  setIsOpen(true);
                }
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                if (inputValue || availablePersonas.length > 0) {
                  setIsOpen(true);
                }
              }}
              className="flex-1"
            />

            {isOpen && (
              <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
                <Command>
                  <CommandList className="max-h-60 overflow-y-auto">
                    {filteredPersonas.length > 0 ? (
                      <CommandGroup heading="Suggestions">
                        {filteredPersonas.map((persona) => (
                          <CommandItem
                            key={persona}
                            value={persona}
                            onSelect={() => handleAddPersona(persona)}
                            onMouseDown={(event) => event.preventDefault()}
                          >
                            {persona}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ) : (
                      <CommandEmpty>
                        {inputValue.trim()
                          ? `Press Enter to add "${inputValue.trim()}"`
                          : "No suggestions available. Type to add a new persona."}
                      </CommandEmpty>
                    )}
                  </CommandList>
                </Command>
              </div>
            )}
          </div>

          <Button
            size="sm"
            onClick={() => handleAddPersona(inputValue)}
            disabled={!inputValue.trim()}
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
