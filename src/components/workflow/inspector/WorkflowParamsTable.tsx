"use client";

import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { extractSetVarParams } from "@/lib/utils/workflow-params";

interface WorkflowParamsTableProps {
  workflowJson: string | null;
}

export function WorkflowParamsTable({ workflowJson }: WorkflowParamsTableProps) {
  const params = extractSetVarParams(workflowJson);
  const entries = Object.entries(params);

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-4">
        No set_var parameters defined in this workflow version.
      </p>
    );
  }

  return (
    <div className="p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/3">Key</TableHead>
            <TableHead>Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map(([key, value]) => {
            const strValue = typeof value === "string" ? value : JSON.stringify(value);
            const truncated = strValue.length > 80 ? strValue.slice(0, 80) + "…" : strValue;
            return (
              <TableRow key={key}>
                <TableCell className="font-mono text-sm">{key}</TableCell>
                <TableCell className="text-sm" title={strValue}>
                  {truncated}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
