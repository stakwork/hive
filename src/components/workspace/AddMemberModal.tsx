"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { InfoIcon, Search, UserCheck } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { AssignableMemberRoleSchema, WorkspaceRole, RoleLabels } from "@/lib/auth/roles";

const addMemberSchema = z.object({
  githubUsername: z.string().min(1, "GitHub username is required"),
  role: AssignableMemberRoleSchema,
});

type AddMemberForm = z.infer<typeof addMemberSchema>;

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  bio: string | null;
  public_repos: number;
  followers: number;
}

interface AddMemberModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  onMemberAdded: () => void;
}

export function AddMemberModal({ open, onOpenChange, workspaceSlug, onMemberAdded }: AddMemberModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GitHubUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<GitHubUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const form = useForm<AddMemberForm>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: {
      githubUsername: "",
      role: WorkspaceRole.DEVELOPER,
    },
  });

  // Search GitHub users
  useEffect(() => {
    const searchUsers = async () => {
      if (!debouncedSearchQuery.trim() || debouncedSearchQuery.length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(
          `/api/github/users/search?q=${encodeURIComponent(debouncedSearchQuery)}`
        );
        
        if (response.ok) {
          const data = await response.json();
          setSearchResults(data.users || []);
        } else {
          setSearchResults([]);
        }
      } catch (error) {
        console.error("Search error:", error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    searchUsers();
  }, [debouncedSearchQuery]);

  // Add member function
  const addMember = async (data: AddMemberForm) => {
    setIsSubmitting(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to add member");
      }

      // Success - refresh parent and close modal
      await onMemberAdded();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    form.reset();
    setSearchQuery("");
    setSearchResults([]);
    setSelectedUser(null);
    setError(null);
    onOpenChange(false);
  };

  const handleSelectUser = (user: GitHubUser) => {
    setSelectedUser(user);
    setSearchQuery(user.login);
    form.setValue("githubUsername", user.login);
    setSearchResults([]);
  };

  const onSubmit = (data: AddMemberForm) => {
    addMember(data);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Member</DialogTitle>
          <DialogDescription>
            Add an existing Hive user to this workspace by their GitHub username.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="githubUsername"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>GitHub Username</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        {...field}
                        placeholder="Search GitHub username..."
                        className="pl-9"
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          field.onChange(e.target.value);
                          setSelectedUser(null);
                        }}
                      />
                    </div>
                  </FormControl>
                  <FormDescription>
                    Start typing to search for GitHub users
                  </FormDescription>
                  <FormMessage />

                  {/* Search Results */}
                  {searchQuery.trim() && searchResults.length > 0 && !selectedUser && (
                    <div className="mt-2 border rounded-md max-h-40 overflow-y-auto">
                      {searchResults.slice(0, 5).map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          className="w-full flex items-center space-x-3 p-3 hover:bg-muted text-left"
                          onClick={() => handleSelectUser(user)}
                        >
                          <Avatar className="w-8 h-8">
                            <AvatarImage src={user.avatar_url} alt={user.login} />
                            <AvatarFallback>{user.login.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{user.name || user.login}</p>
                              <Badge variant="outline" className="text-xs">
                                @{user.login}
                              </Badge>
                            </div>
                            {user.bio && (
                              <p className="text-sm text-muted-foreground truncate">
                                {user.bio}
                              </p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Selected User Preview */}
                  {selectedUser && (
                    <div className="mt-2 flex items-center space-x-3 p-3 bg-muted rounded-md">
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={selectedUser.avatar_url} alt={selectedUser.login} />
                        <AvatarFallback>{selectedUser.login.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <UserCheck className="w-4 h-4 text-green-600" />
                          <p className="font-medium">{selectedUser.name || selectedUser.login}</p>
                          <Badge variant="outline" className="text-xs">
                            @{selectedUser.login}
                          </Badge>
                        </div>
                        {selectedUser.bio && (
                          <p className="text-sm text-muted-foreground">{selectedUser.bio}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Loading State */}
                  {isSearching && (
                    <div className="mt-2 text-sm text-muted-foreground">
                      Searching GitHub users...
                    </div>
                  )}

                  {/* No Results */}
                  {searchQuery.trim() && !isSearching && searchResults.length === 0 && searchQuery.length >= 2 && !selectedUser && (
                    <div className="mt-2 text-sm text-muted-foreground">
                      No GitHub users found matching "{searchQuery}"
                    </div>
                  )}
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={WorkspaceRole.VIEWER}>{RoleLabels[WorkspaceRole.VIEWER]}</SelectItem>
                      <SelectItem value={WorkspaceRole.DEVELOPER}>{RoleLabels[WorkspaceRole.DEVELOPER]}</SelectItem>
                      <SelectItem value={WorkspaceRole.PM}>{RoleLabels[WorkspaceRole.PM]}</SelectItem>
                      <SelectItem value={WorkspaceRole.ADMIN}>{RoleLabels[WorkspaceRole.ADMIN]}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Choose the access level for this member
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isSubmitting || !form.watch("githubUsername")}
              >
                {isSubmitting ? "Adding..." : "Add Member"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}