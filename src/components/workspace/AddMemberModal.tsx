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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Search, UserCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
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

interface InaccessibleRepository {
  repositoryUrl: string;
  repositoryName: string;
  hasAccess: boolean;
  error?: string;
}

interface AccessValidationError {
  error: string;
  message: string;
  inaccessibleRepositories: InaccessibleRepository[];
  requiresBypass: boolean;
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
  const [accessWarning, setAccessWarning] = useState<AccessValidationError | null>(null);
  const [showBypassDialog, setShowBypassDialog] = useState(false);

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
  const addMember = async (data: AddMemberForm, bypassAccessWarning = false) => {
    setIsSubmitting(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          bypassAccessWarning,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        
        // Handle access validation warning
        if (response.status === 422 && errorData.requiresBypass) {
          setAccessWarning(errorData as AccessValidationError);
          setShowBypassDialog(true);
          setIsSubmitting(false);
          return;
        }
        
        throw new Error(errorData.error || "Failed to add member");
      }

      // Success - refresh parent and close modal
      await onMemberAdded();
      toast.success("Member added successfully");
      handleClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add member";
      setError(message);
      toast.error("Failed to add member", {
        description: message,
      });
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
    setAccessWarning(null);
    setShowBypassDialog(false);
    onOpenChange(false);
  };

  const handleBypassConfirm = () => {
    setShowBypassDialog(false);
    const formData = form.getValues();
    addMember(formData, true);
  };

  const handleBypassCancel = () => {
    setShowBypassDialog(false);
    setAccessWarning(null);
    setIsSubmitting(false);
  };

  const handleUserSelect = (user: GitHubUser) => {
    setSelectedUser(user);
    setSearchQuery(user.login);
    setSearchResults([]);
    form.setValue("githubUsername", user.login, { shouldValidate: true });
  };

  const onSubmit = (data: AddMemberForm) => {
    addMember(data, false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add Member to Workspace</DialogTitle>
            <DialogDescription>
              Search for a GitHub user to add them to this workspace
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="githubUsername"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>GitHub Username</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Search GitHub users..."
                          className="pl-9"
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setSelectedUser(null);
                            field.onChange("");
                          }}
                          data-testid="add-member-username-input"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />

                    {/* Search Results Dropdown */}
                    {searchResults.length > 0 && !selectedUser && (
                      <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-md border bg-background p-2">
                        {searchResults.map((user) => (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => handleUserSelect(user)}
                            className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-accent"
                            data-testid={`user-result-${user.login}`}
                          >
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={user.avatar_url} alt={user.login} />
                              <AvatarFallback>{user.login[0]?.toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{user.login}</span>
                                {user.name && (
                                  <span className="text-sm text-muted-foreground">
                                    ({user.name})
                                  </span>
                                )}
                              </div>
                              {user.bio && (
                                <p className="text-sm text-muted-foreground line-clamp-1">
                                  {user.bio}
                                </p>
                              )}
                            </div>
                            <Badge variant="secondary" className="text-xs">
                              {user.public_repos} repos
                            </Badge>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Selected User Display */}
                    {selectedUser && (
                      <div className="mt-2 flex items-center gap-3 rounded-md border bg-accent/50 p-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={selectedUser.avatar_url} alt={selectedUser.login} />
                          <AvatarFallback>{selectedUser.login[0]?.toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{selectedUser.login}</span>
                            {selectedUser.name && (
                              <span className="text-sm text-muted-foreground">
                                ({selectedUser.name})
                              </span>
                            )}
                            <UserCheck className="h-4 w-4 text-green-600" />
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
                        <SelectTrigger data-testid="add-member-role-trigger">
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem
                          value={WorkspaceRole.VIEWER}
                          data-testid="role-option-viewer"
                        >
                          {RoleLabels[WorkspaceRole.VIEWER]}
                        </SelectItem>
                        <SelectItem
                          value={WorkspaceRole.DEVELOPER}
                          data-testid="role-option-developer"
                        >
                          {RoleLabels[WorkspaceRole.DEVELOPER]}
                        </SelectItem>
                        <SelectItem
                          value={WorkspaceRole.PM}
                          data-testid="role-option-pm"
                        >
                          {RoleLabels[WorkspaceRole.PM]}
                        </SelectItem>
                        <SelectItem
                          value={WorkspaceRole.ADMIN}
                          data-testid="role-option-admin"
                        >
                          {RoleLabels[WorkspaceRole.ADMIN]}
                        </SelectItem>
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  data-testid="add-member-cancel"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={isSubmitting || !form.watch("githubUsername")}
                  data-testid="add-member-submit"
                >
                  {isSubmitting ? "Adding..." : "Add Member"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Access Warning Bypass Dialog */}
      <AlertDialog open={showBypassDialog} onOpenChange={setShowBypassDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Repository Access Warning
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>{accessWarning?.message}</p>
              
              {accessWarning && accessWarning.inaccessibleRepositories.length > 0 && (
                <div className="rounded-md border bg-amber-50 dark:bg-amber-950/20 p-3">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-2">
                    Inaccessible Repositories:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-amber-800 dark:text-amber-200">
                    {accessWarning.inaccessibleRepositories.map((repo, idx) => (
                      <li key={idx}>
                        {repo.repositoryName || repo.repositoryUrl}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-sm font-medium">
                This user may have trouble creating plans or tasks for these repositories. 
                Do you want to add them anyway?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleBypassCancel}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleBypassConfirm}>
              Add Member Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
