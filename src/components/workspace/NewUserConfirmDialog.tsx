"use client";

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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, UserPlus } from "lucide-react";

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  bio: string | null;
  public_repos: number;
  followers: number;
}

interface NewUserConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  githubUser: GitHubUser | null;
  role: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function NewUserConfirmDialog({
  open,
  onOpenChange,
  githubUser,
  role,
  onConfirm,
  onCancel,
}: NewUserConfirmDialogProps) {
  if (!githubUser) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md" data-testid="new-user-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Inviting New Hive User
          </AlertDialogTitle>
          <AlertDialogDescription>
            The GitHub user you're inviting has not signed up to Hive yet.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          {/* User Preview */}
          <div className="flex items-center space-x-3 p-3 bg-muted rounded-md">
            <Avatar className="w-10 h-10">
              <AvatarImage src={githubUser.avatar_url} alt={githubUser.login} />
              <AvatarFallback>{githubUser.login.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium">{githubUser.name || githubUser.login}</p>
                <Badge variant="outline" className="text-xs">
                  @{githubUser.login}
                </Badge>
              </div>
              {githubUser.bio && (
                <p className="text-sm text-muted-foreground truncate">
                  {githubUser.bio}
                </p>
              )}
            </div>
          </div>

          {/* Warning Message */}
          <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
            <AlertDescription className="text-sm">
              <div className="space-y-2">
                <p className="font-medium text-amber-800 dark:text-amber-400">
                  What this means:
                </p>
                <ul className="list-disc list-inside space-y-1 text-amber-700 dark:text-amber-300">
                  <li>This user must sign up to Hive before they can access the workspace</li>
                  <li>They'll be added with the <strong>{role}</strong> role once they sign up</li>
                  <li>You may need to notify them to create their Hive account</li>
                </ul>
              </div>
            </AlertDescription>
          </Alert>

          <p className="text-sm text-muted-foreground">
            Do you want to proceed with adding <strong>@{githubUser.login}</strong> to this workspace?
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel 
            onClick={onCancel}
            data-testid="new-user-confirm-cancel"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-primary hover:bg-primary/90"
            data-testid="new-user-confirm-accept"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Add Anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
