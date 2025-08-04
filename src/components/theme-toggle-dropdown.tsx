"use client";

import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/use-theme";
import { useState } from "react";

export function ThemeToggleDropdown() {
  const { theme, setTheme, mounted } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  if (!mounted) return null;

  const themes = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ] as const;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-md border border-border bg-popover text-popover-foreground px-3 py-1.5 text-sm hover:bg-accent transition-colors"
      >
        {(() => {
          const currentTheme = themes.find((t) => t.value === theme);
          return currentTheme ? (
            <>
              <currentTheme.icon className="h-4 w-4" />
              {currentTheme.label}
            </>
          ) : null;
        })()}
        <ChevronDown className="h-3 w-3" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-32 rounded-md border border-border bg-popover text-popover-foreground shadow-lg z-50">
          {themes.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => {
                setTheme(value);
                setIsOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Icon className="h-4 w-4" />
              {label}
              {theme === value && <Check className="ml-auto h-3 w-3" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
