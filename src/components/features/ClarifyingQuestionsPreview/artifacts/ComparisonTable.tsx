"use client";

import React from "react";
import { Check, X, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

// Row = variable choice (SSE, WebSockets, Polling, etc.)
interface ComparisonRow {
  label: string;
  description?: string;
  cells: Record<string, string | string[]>; // keyed by column name
}

interface ComparisonTableData {
  columns: string[]; // Simple array: ["Pros", "Cons"]
  rows: ComparisonRow[];
}

interface ComparisonTableProps {
  data: ComparisonTableData;
  className?: string;
  selectedOptions?: string[];
  onSelect?: (label: string) => void;
  questionType?: "single_choice" | "multiple_choice";
}

// Determine column type from name
function getColumnType(column: string): "pros" | "cons" | "neutral" {
  const lowerColumn = column.toLowerCase();
  if (lowerColumn.includes("pro")) return "pros";
  if (lowerColumn.includes("con")) return "cons";
  return "neutral";
}

const colConfig = {
  pros: {
    icon: Check,
    bgClass: "bg-green-500/10",
    borderClass: "border-green-500/20",
    iconClass: "text-green-500",
    labelClass: "text-green-400",
  },
  cons: {
    icon: X,
    bgClass: "bg-amber-500/10",
    borderClass: "border-amber-500/20",
    iconClass: "text-amber-500",
    labelClass: "text-amber-400",
  },
  neutral: {
    icon: Minus,
    bgClass: "bg-muted/30",
    borderClass: "border-border",
    iconClass: "text-muted-foreground",
    labelClass: "text-muted-foreground",
  },
};

export function ComparisonTable({
  data,
  className,
  selectedOptions,
  onSelect,
  questionType,
}: ComparisonTableProps) {
  const { columns, rows } = data;
  const isInteractive = !!onSelect;

  return (
    <div className={cn("overflow-auto rounded-md border border-border", className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50">
            {/* Empty header for choice column */}
            <th className="p-3 text-left font-medium text-muted-foreground border-b border-border" />
            {/* Category column headers (Pros, Cons, etc.) */}
            {columns.map((col, idx) => {
              const colType = getColumnType(col);
              const config = colConfig[colType];
              const Icon = config.icon;
              return (
                <th
                  key={idx}
                  className={cn(
                    "p-3 text-left font-semibold border-b",
                    config.borderClass,
                    config.bgClass
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon className={cn("h-4 w-4", config.iconClass)} />
                    <span className={config.labelClass}>{col}</span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* Choice rows (SSE, WebSockets, Polling, etc.) */}
          {rows.map((row, rowIdx) => {
            const isSelected = selectedOptions?.includes(row.label) ?? false;
            return (
              <tr
                key={rowIdx}
                onClick={isInteractive ? () => onSelect(row.label) : undefined}
                className={cn(
                  "border-b last:border-b-0 border-border transition-colors",
                  isInteractive && "cursor-pointer hover:bg-muted/20",
                  isSelected && "bg-primary/10 border-l-2 border-primary/60"
                )}
              >
                {/* Row header: selection indicator + choice label + description */}
                <td className={cn("p-3 align-top", !isSelected && "bg-muted/30")}>
                  <div className="flex items-start gap-2">
                    {isInteractive && (
                      <div
                        className={cn(
                          "mt-0.5 flex-shrink-0 w-4 h-4 border-2 flex items-center justify-center",
                          questionType === "multiple_choice" ? "rounded-sm" : "rounded-full",
                          isSelected
                            ? "border-primary bg-primary"
                            : "border-muted-foreground/40"
                        )}
                      >
                        {isSelected && (
                          <Check className="h-3 w-3 text-primary-foreground" />
                        )}
                      </div>
                    )}
                    <div>
                      <div className="font-semibold text-foreground">{row.label}</div>
                      {row.description && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {row.description}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                {/* Cells for each category column */}
                {columns.map((col, colIdx) => {
                  const colType = getColumnType(col);
                  const config = colConfig[colType];
                  const raw = row.cells[col];
                  const cellItems: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
                  return (
                    <td
                      key={colIdx}
                      className={cn("p-3 align-top", config.bgClass)}
                    >
                      {cellItems.length > 0 ? (
                        <ul className="space-y-1">
                          {cellItems.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-foreground">
                              <span
                                className={cn(
                                  "mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0",
                                  config.iconClass.replace("text-", "bg-")
                                )}
                              />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
