"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, UserIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface User {
  id: string;
  name: string | null;
  email: string;
}

export function PromoteSuperadminForm() {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch users on mount and when search query changes (debounced)
  useEffect(() => {
    const fetchUsers = async () => {
      setSearching(true);
      try {
        const url = searchQuery 
          ? `/api/admin/users/search?q=${encodeURIComponent(searchQuery)}`
          : "/api/admin/users/search";
        
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          setUsers(data.users || []);
        }
      } catch (error) {
        console.error("Error fetching users:", error);
      } finally {
        setSearching(false);
      }
    };

    const timer = setTimeout(() => {
      if (open) {
        fetchUsers();
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, open]);

  async function handlePromote(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUser) return;

    setLoading(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUser.id }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to promote user");
      }

      toast.success("User promoted to superadmin");
      setSelectedUser(null);
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to promote user");
    } finally {
      setLoading(false);
    }
  }

  const handleSelect = (user: User) => {
    setSelectedUser(user);
    setOpen(false);
    setSearchQuery("");
  };

  return (
    <form onSubmit={handlePromote} className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-[300px] justify-between"
            disabled={loading}
            type="button"
          >
            {selectedUser ? (
              <span className="truncate">
                {selectedUser.name || selectedUser.email} ({selectedUser.email})
              </span>
            ) : (
              <span className="text-muted-foreground">Select user...</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput 
              placeholder="Search users..." 
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              <CommandEmpty>
                {searching ? "Loading users..." : "No users found"}
              </CommandEmpty>
              <CommandGroup>
                {users.map((user) => (
                  <CommandItem
                    key={user.id}
                    value={user.id}
                    onSelect={() => handleSelect(user)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedUser?.id === user.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <UserIcon className="mr-2 h-4 w-4" />
                    <span className="truncate">
                      {user.name || user.email} ({user.email})
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Button type="submit" disabled={loading || !selectedUser}>
        {loading ? "Promoting..." : "Promote"}
      </Button>
    </form>
  );
}

export function RevokeSuperadminButton({ userId, userName }: { userId: string; userName: string | null }) {
  const [loading, setLoading] = useState(false);

  async function handleRevoke() {
    if (!confirm(`Are you sure you want to revoke superadmin access from ${userName || "this user"}?`)) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to revoke access");
      }

      toast.success("Superadmin access revoked");
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to revoke access");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={handleRevoke}
      disabled={loading}
    >
      {loading ? "Revoking..." : "Revoke"}
    </Button>
  );
}
