"use client";

import { ArrowUpDown, ArrowUp, ArrowDown, Filter, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { StatusBadge } from "@/components/ui/status-badge";
import { PriorityBadge } from "@/components/ui/priority-selector";
import type { FeatureStatus, FeaturePriority } from "@prisma/client";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User as UserIcon } from "lucide-react";

interface SortableColumnHeaderProps {
  label: string;
  field: string;
  currentSort: "asc" | "desc" | null;
  onSort: (order: "asc" | "desc" | null) => void;
  align?: "left" | "right";
}

export function SortableColumnHeader({
  label,
  field,
  currentSort,
  onSort,
  align = "left",
}: SortableColumnHeaderProps) {
  const handleClick = () => {
    if (currentSort === null) {
      onSort("asc");
    } else if (currentSort === "asc") {
      onSort("desc");
    } else {
      onSort(null);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "-ml-3 h-8 data-[state=open]:bg-accent",
        align === "right" && "ml-auto -mr-3"
      )}
      onClick={handleClick}
    >
      <span>{label}</span>
      {currentSort === null && <ArrowUpDown className="ml-2 h-4 w-4" />}
      {currentSort === "asc" && <ArrowUp className="ml-2 h-4 w-4" />}
      {currentSort === "desc" && <ArrowDown className="ml-2 h-4 w-4" />}
    </Button>
  );
}

interface FilterOption {
  value: string;
  label: string;
  image?: string | null;
  name?: string | null;
}

interface FilterDropdownHeaderProps {
  label: string;
  options: FilterOption[];
  value: string | string[]; // Support both single and multi-select
  onChange: (value: string | string[]) => void;
  showSearch?: boolean;
  multiSelect?: boolean;
  showStatusBadges?: boolean; // New prop to render StatusBadge
  showPriorityBadges?: boolean; // New prop to render PriorityBadge
  showAvatars?: boolean; // New prop to render user avatars
}

export function FilterDropdownHeader({
  label,
  options,
  value,
  onChange,
  showSearch = false,
  multiSelect = false,
  showStatusBadges = false,
  showPriorityBadges = false,
  showAvatars = false,
}: FilterDropdownHeaderProps) {
  const [open, setOpen] = useState(false);

  // Handle both single and multi-select
  const selectedValues = Array.isArray(value) ? value : [value];
  const isFiltered = multiSelect
    ? selectedValues.length > 0 && !selectedValues.includes("ALL")
    : value !== "ALL";

  const filterCount = multiSelect && isFiltered ? selectedValues.filter(v => v !== "ALL").length : 0;

  // Handler for multi-select
  const handleMultiSelectChange = (optionValue: string) => {
    if (!multiSelect || !Array.isArray(value)) return;

    if (optionValue === "ALL") {
      onChange([]);
      return;
    }

    const newValues = value.includes(optionValue)
      ? value.filter(v => v !== optionValue)
      : [...value.filter(v => v !== "ALL"), optionValue];

    onChange(newValues);
  };

  // Handler for single-select
  const handleSingleSelectChange = (optionValue: string) => {
    if (multiSelect) return;
    onChange(optionValue);
    if (!showSearch) setOpen(false);
  };

  if (showSearch) {
    // Use Command component for searchable filter (for assignee with many members)
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8 data-[state=open]:bg-accent"
          >
            <span>{label}</span>
            <Filter
              className={cn(
                "ml-2 h-4 w-4",
                isFiltered && "fill-primary text-primary"
              )}
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[200px] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => {
                      handleSingleSelectChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        !multiSelect && value === option.value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {showAvatars && (
                      <Avatar className="h-5 w-5 mr-2">
                        {option.image ? (
                          <AvatarImage src={option.image} />
                        ) : (
                          <AvatarFallback className="text-xs">
                            {option.name?.charAt(0) || <UserIcon className="h-3 w-3" />}
                          </AvatarFallback>
                        )}
                      </Avatar>
                    )}
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  // Use DropdownMenu for simple filter (for status with few options)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 data-[state=open]:bg-accent"
        >
          <span>{label}{filterCount > 0 && ` (${filterCount})`}</span>
          <Filter
            className={cn(
              "ml-2 h-4 w-4",
              isFiltered && "fill-primary text-primary"
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[200px]">
        <DropdownMenuLabel>Filter by {label.toLowerCase()}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => {
          const isSelected = multiSelect
            ? selectedValues.includes(option.value)
            : value === option.value;

          const isAllOption = option.value === "ALL";

          return (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={isSelected}
              onCheckedChange={() => {
                if (multiSelect) {
                  handleMultiSelectChange(option.value);
                  // Don't close dropdown in multi-select mode
                } else {
                  handleSingleSelectChange(option.value);
                  setOpen(false); // Close for single-select
                }
              }}
              onSelect={(e) => {
                // Prevent dropdown from closing in multi-select mode
                if (multiSelect) {
                  e.preventDefault();
                }
              }}
            >
              {showStatusBadges && !isAllOption ? (
                <StatusBadge
                  statusType="feature"
                  status={option.value as FeatureStatus}
                />
              ) : showPriorityBadges && !isAllOption ? (
                <PriorityBadge
                  priority={option.value as FeaturePriority}
                  showLowPriority={true}
                />
              ) : (
                option.label
              )}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
