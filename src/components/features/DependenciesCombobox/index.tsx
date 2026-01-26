"use client";

import { useState, useEffect } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import type { TicketListItem } from "@/types/roadmap";

interface DependenciesComboboxProps {
  currentTicketId: string;
  phaseId: string;
  allTickets: TicketListItem[];
  selectedDependencyIds: string[];
  onUpdate: (dependencyIds: string[]) => Promise<void>;
  maxVisibleDependencies?: number; // Maximum number of dependency badges to show
}

export function DependenciesCombobox({
  currentTicketId,
  phaseId,
  allTickets,
  selectedDependencyIds,
  onUpdate,
  maxVisibleDependencies = 2, // Default to showing 2 dependencies
}: DependenciesComboboxProps) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [localDependencies, setLocalDependencies] = useState<string[]>(selectedDependencyIds || []);

  // Update local state when props change
  useEffect(() => {
    setLocalDependencies(selectedDependencyIds || []);
  }, [selectedDependencyIds]);

  // Filter out the current ticket and get tickets in the same phase
  const availableTickets = allTickets.filter(
    (ticket) => ticket.id !== currentTicketId && ticket.phaseId === phaseId
  );

  const selectedTickets = availableTickets.filter((ticket) =>
    localDependencies.includes(ticket.id)
  );

  const handleToggle = (ticketId: string) => {
    const newDependencies = localDependencies.includes(ticketId)
      ? localDependencies.filter((id) => id !== ticketId)
      : [...localDependencies, ticketId];

    setLocalDependencies(newDependencies);
  };

  const handleApply = async () => {
    try {
      setUpdating(true);
      await onUpdate(localDependencies);
      setOpen(false);
    } catch (error) {
      console.error("Failed to update dependencies:", error);
      // Revert to original state on error
      setLocalDependencies(selectedDependencyIds || []);
    } finally {
      setUpdating(false);
    }
  };

  const handleCancel = () => {
    setLocalDependencies(selectedDependencyIds || []);
    setOpen(false);
  };

  const handleRemoveDependency = async (ticketId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newDependencies = (selectedDependencyIds || []).filter((id) => id !== ticketId);
    try {
      setUpdating(true);
      await onUpdate(newDependencies);
    } catch (error) {
      console.error("Failed to remove dependency:", error);
    } finally {
      setUpdating(false);
    }
  };

  if (availableTickets.length === 0) {
    return (
      <div className="text-sm text-muted-foreground px-2 py-1">
        No other tasks
      </div>
    );
  }

  // Split selected tickets into visible and overflow
  const visibleTickets = selectedTickets.slice(0, maxVisibleDependencies);
  const overflowCount = selectedTickets.length - maxVisibleDependencies;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-start h-auto min-h-8 px-2 py-1 text-sm font-normal hover:bg-muted"
          onClick={(e) => e.stopPropagation()}
          disabled={updating}
        >
          {selectedTickets.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1 w-full">
              {visibleTickets.map((ticket) => (
                <Badge
                  key={ticket.id}
                  variant="secondary"
                  className={`text-xs px-1.5 py-0 h-5 hover:bg-secondary truncate ${
                    selectedTickets.length === 1 
                      ? "max-w-full" // Full width for single dependency
                      : "max-w-[100px]" // Limited width for multiple
                  }`}
                  title={ticket.title}
                >
                  <span className="truncate">{ticket.title}</span>
                  <X
                    className="h-3 w-3 ml-1 hover:text-destructive flex-shrink-0"
                    onClick={(e) => handleRemoveDependency(ticket.id, e)}
                  />
                </Badge>
              ))}
              {overflowCount > 0 && (
                <Badge
                  variant="secondary"
                  className="text-xs px-1.5 py-0 h-5 cursor-pointer hover:bg-secondary/80"
                  title={`${overflowCount} more ${overflowCount === 1 ? 'dependency' : 'dependencies'}`}
                >
                  +{overflowCount}
                </Badge>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start" onClick={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder="Search tasks..." />
          <CommandList>
            <CommandEmpty>No tasks found.</CommandEmpty>
            <CommandGroup>
              {availableTickets.map((ticket) => {
                const isSelected = localDependencies.includes(ticket.id);
                return (
                  <CommandItem
                    key={ticket.id}
                    value={`${ticket.title}-${ticket.id}`}
                    onSelect={() => handleToggle(ticket.id)}
                    disabled={updating}
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")}
                    />
                    <div className="flex flex-col flex-1 overflow-hidden">
                      <span className="truncate">{ticket.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {ticket.status} • {ticket.priority}
                      </span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex items-center justify-end gap-2 p-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            disabled={updating}
          >
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleApply}
            disabled={updating}
          >
            {updating ? "Applying..." : "Apply"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
