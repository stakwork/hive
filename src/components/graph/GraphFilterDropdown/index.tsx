"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FilterTab } from "@/stores/useGraphStore";
import { BrainCog, CheckSquare, Code2, Layers, MessageSquare } from "lucide-react";

interface GraphFilterDropdownProps {
  value: FilterTab;
  onValueChange: (value: FilterTab) => void;
  disabled?: boolean;
}

const filterLabels: Record<FilterTab, string> = {
  all: "All",
  code: "Code",
  comms: "Comms",
  tasks: "Tasks",
  concepts: "Concepts",
};

const filterIcons: Record<FilterTab, React.ReactNode> = {
  all: <Layers className="w-4 h-4" />,
  code: <Code2 className="w-4 h-4" />,
  comms: <MessageSquare className="w-4 h-4" />,
  tasks: <CheckSquare className="w-4 h-4" />,
  concepts: <BrainCog className="w-4 h-4" />,
};

export function GraphFilterDropdown({ value, onValueChange, disabled }: GraphFilterDropdownProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={cn("w-[160px] h-10 !bg-card/95 backdrop-blur-sm border-border hover:!bg-accent/95 transition-colors shadow-xs", disabled && "opacity-50 cursor-not-allowed")}>
        <SelectValue placeholder="Filter graph" />
      </SelectTrigger>
      <SelectContent className="!bg-card/95 backdrop-blur-sm border-border shadow-md">
        <SelectItem value="all">
          <div className="flex items-center gap-2">
            {filterIcons.all}
            <span>{filterLabels.all}</span>
          </div>
        </SelectItem>
        <SelectItem value="code">
          <div className="flex items-center gap-2">
            {filterIcons.code}
            <span>{filterLabels.code}</span>
          </div>
        </SelectItem>
        <SelectItem value="comms">
          <div className="flex items-center gap-2">
            {filterIcons.comms}
            <span>{filterLabels.comms}</span>
          </div>
        </SelectItem>
        <SelectItem value="tasks">
          <div className="flex items-center gap-2">
            {filterIcons.tasks}
            <span>{filterLabels.tasks}</span>
          </div>
        </SelectItem>
        <SelectItem value="concepts">
          <div className="flex items-center gap-2">
            {filterIcons.concepts}
            <span>{filterLabels.concepts}</span>
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
