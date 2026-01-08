"use client";

import { Check, X, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

// Column = fixed category (Pros, Cons, etc.)
interface ComparisonColumn {
  category: string;
  type: "pros" | "cons" | "neutral";
}

// Row = variable choice (SSE, WebSockets, Polling, etc.)
interface ComparisonRow {
  label: string;
  description?: string;
  cells: Record<string, string[]>; // keyed by category
}

interface ComparisonTableData {
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
}

interface ComparisonTableProps {
  data: ComparisonTableData;
  className?: string;
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

export function ComparisonTable({ data, className }: ComparisonTableProps) {
  const { columns, rows } = data;

  if (!columns || columns.length === 0) {
    return (
      <div className={cn("p-4 text-sm text-muted-foreground", className)}>
        No comparison data provided
      </div>
    );
  }

  return (
    <div className={cn("overflow-auto rounded-md border border-border", className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50">
            {/* Empty header for choice column */}
            <th className="p-3 text-left font-medium text-muted-foreground border-b border-border" />
            {/* Category column headers (Pros, Cons, etc.) */}
            {columns.map((col) => {
              const config = colConfig[col.type];
              const Icon = config.icon;
              return (
                <th
                  key={col.category}
                  className={cn(
                    "p-3 text-left font-semibold border-b",
                    config.borderClass,
                    config.bgClass
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon className={cn("h-4 w-4", config.iconClass)} />
                    <span className={config.labelClass}>{col.category}</span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* Choice rows (SSE, WebSockets, Polling, etc.) */}
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className="border-b last:border-b-0 border-border">
              {/* Row header: choice label + description */}
              <td className="p-3 align-top bg-muted/30">
                <div className="font-semibold text-foreground">{row.label}</div>
                {row.description && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {row.description}
                  </div>
                )}
              </td>
              {/* Cells for each category column */}
              {columns.map((col) => {
                const config = colConfig[col.type];
                const cellItems = row.cells[col.category] || [];
                return (
                  <td
                    key={col.category}
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
