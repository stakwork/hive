"use client";

import { useState, useEffect } from "react";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TaskFilters as TaskFiltersType } from "@/hooks/useWorkspaceTasks";
import { Badge } from "@/components/ui/badge";

interface TaskFiltersProps {
  workspaceSlug: string;
  filters: TaskFiltersType;
  onFiltersChange: (filters: TaskFiltersType) => void;
}

interface WorkspaceMember {
  id: string;
  userId: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
  };
}

export function TaskFilters({ workspaceSlug, filters, onFiltersChange }: TaskFiltersProps) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [localFilters, setLocalFilters] = useState<TaskFiltersType>(filters);

  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  useEffect(() => {
    if (open && members.length === 0) {
      fetchMembers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fetchMembers = async () => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}/members`);
      if (response.ok) {
        const data = await response.json();
        const allMembers = [...(data.owner ? [data.owner] : []), ...(data.members || [])];
        setMembers(allMembers);
      }
    } catch (error) {
      console.error("Failed to fetch members:", error);
    }
  };

  const handleFilterChange = (key: keyof TaskFiltersType, value: any) => {
    const newFilters = { ...localFilters, [key]: value || undefined };
    setLocalFilters(newFilters);
  };

  const applyFilters = () => {
    onFiltersChange(localFilters);
    setOpen(false);
  };

  const clearFilters = () => {
    const emptyFilters: TaskFiltersType = {};
    setLocalFilters(emptyFilters);
    onFiltersChange(emptyFilters);
  };

  const activeFilterCount = Object.values(filters).filter(v => v !== undefined && v !== "").length;

  const getSelectedUserName = (userId: string | undefined) => {
    if (!userId) return undefined;
    const member = members.find(m => m.userId === userId);
    return member?.user.name || member?.user.email || "Unknown";
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Filter className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1 text-xs">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Filters</h4>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-auto p-1 text-xs"
              >
                Clear all
              </Button>
            )}
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="sortBy" className="text-xs font-medium">
                Sort by
              </Label>
              <Select
                value={localFilters.sortBy || "createdAt"}
                onValueChange={(value) => handleFilterChange("sortBy", value)}
              >
                <SelectTrigger id="sortBy" className="h-9">
                  <SelectValue placeholder="Sort by..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt">Created Date</SelectItem>
                  <SelectItem value="sourceType">Trigger Type</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                  <SelectItem value="priority">Priority</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sortOrder" className="text-xs font-medium">
                Order
              </Label>
              <Select
                value={localFilters.sortOrder || "desc"}
                onValueChange={(value) => handleFilterChange("sortOrder", value as "asc" | "desc")}
              >
                <SelectTrigger id="sortOrder" className="h-9">
                  <SelectValue placeholder="Order..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Descending</SelectItem>
                  <SelectItem value="asc">Ascending</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sourceType" className="text-xs font-medium">
                Trigger Type
              </Label>
              <Select
                value={localFilters.sourceType || ""}
                onValueChange={(value) => handleFilterChange("sourceType", value)}
              >
                <SelectTrigger id="sourceType" className="h-9">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All types</SelectItem>
                  <SelectItem value="USER">Human</SelectItem>
                  <SelectItem value="JANITOR">Janitor</SelectItem>
                  <SelectItem value="TASK_COORDINATOR">Coordinator</SelectItem>
                  <SelectItem value="SYSTEM">System</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status" className="text-xs font-medium">
                Status
              </Label>
              <Select
                value={localFilters.status || ""}
                onValueChange={(value) => handleFilterChange("status", value)}
              >
                <SelectTrigger id="status" className="h-9">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All statuses</SelectItem>
                  <SelectItem value="TODO">To Do</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                  <SelectItem value="DONE">Done</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="userId" className="text-xs font-medium">
                User
              </Label>
              <Select
                value={localFilters.userId || ""}
                onValueChange={(value) => handleFilterChange("userId", value)}
              >
                <SelectTrigger id="userId" className="h-9">
                  <SelectValue placeholder="All users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All users</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {member.user.name || member.user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between py-2">
              <Label htmlFor="inputNeeded" className="text-xs font-medium">
                Input needed only
              </Label>
              <Switch
                id="inputNeeded"
                checked={localFilters.inputNeeded || false}
                onCheckedChange={(checked) => handleFilterChange("inputNeeded", checked)}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={applyFilters}
              className="flex-1"
            >
              Apply Filters
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
