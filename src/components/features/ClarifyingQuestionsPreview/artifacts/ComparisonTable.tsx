"use client";

import { Check, X, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

// Column = choice/option (SSE, WebSockets, Polling, etc.)
interface ComparisonColumn {
  label: string;
  description?: string;
}

// Row = category (Pros, Cons, Use When, etc.)
interface ComparisonRow {
  category: string;
  cells: Record<string, string[]>; // keyed by column label
}

interface ComparisonTableData {
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
}

interface ComparisonTableProps {
  data: ComparisonTableData;
  className?: string;
}

// Determine row type from category name
function getCategoryType(category: string): "pros" | "cons" | "neutral" {
  const lowerCategory = category.toLowerCase();
  if (lowerCategory.includes("pro")) return "pros";
  if (lowerCategory.includes("con")) return "cons";
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
            {/* Empty header for category column */}
            <th className="p-3 text-left font-medium text-muted-foreground border-b border-border" />
            {/* Choice column headers (SSE, WebSockets, Polling, etc.) */}
            {columns.map((col, idx) => (
              <th
                key={idx}
                className="p-3 text-left font-semibold border-b border-border bg-muted/30"
              >
                <div className="font-semibold text-foreground">{col.label}</div>
                {col.description && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {col.description}
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Category rows (Pros, Cons, Use When, etc.) */}
          {rows.map((row, rowIdx) => {
            const categoryType = getCategoryType(row.category);
            const config = colConfig[categoryType];
            const Icon = config.icon;

            return (
              <tr key={rowIdx} className="border-b last:border-b-0 border-border">
                {/* Row header: category label */}
                <td
                  className={cn(
                    "p-3 align-top border-r border-border",
                    config.bgClass,
                    config.borderClass
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon className={cn("h-4 w-4", config.iconClass)} />
                    <span className={cn("font-semibold", config.labelClass)}>
                      {row.category}
                    </span>
                  </div>
                </td>
                {/* Cells for each choice column */}
                {columns.map((col, colIdx) => {
                  const cellItems = row.cells[col.label] || [];
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
