"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Edit3, Loader2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { updateWorkspaceSchema, UpdateWorkspaceInput } from "@/lib/schemas/workspace";
import { useToast } from "@/components/ui/use-toast";

export function WorkspaceSettings() {
  const { workspace, refreshCurrentWorkspace } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const form = useForm<UpdateWorkspaceInput>({
    resolver: zodResolver(updateWorkspaceSchema),
    defaultValues: {
      name: workspace?.name || "",
      slug: workspace?.slug || "",
      description: workspace?.description || "",
    },
  });

  const onSubmit = async (data: UpdateWorkspaceInput) => {
    if (!workspace) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to update workspace");
      }

      toast({
        title: "Success",
        description: "Workspace updated successfully",
      });

      // If slug changed, redirect to new URL
      if (result.slugChanged) {
        const currentPath = window.location.pathname.replace(`/w/${workspace.slug}`, "");
        router.push(`/w/${result.slugChanged}${currentPath}`);
      } else {
        // Just refresh the workspace data
        await refreshCurrentWorkspace();
      }
    } catch (error) {
      console.error("Error updating workspace:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update workspace",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!workspace || !canAdmin) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Edit3 className="w-5 h-5" />
          Workspace Details
        </CardTitle>
        <CardDescription>
          Update your workspace name, URL, and description
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Workspace Name</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="My Awesome Workspace" 
                      {...field} 
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormDescription>
                    The display name for your workspace
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Workspace URL</FormLabel>
                  <FormControl>
                    <div className="flex items-center">
                      <span className="text-sm text-muted-foreground mr-1">
                        /w/
                      </span>
                      <Input 
                        placeholder="my-workspace" 
                        {...field} 
                        disabled={isSubmitting}
                      />
                    </div>
                  </FormControl>
                  <FormDescription>
                    The unique URL for your workspace. Must be lowercase, use hyphens for spaces.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="What is this workspace about?"
                      className="resize-none"
                      {...field} 
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormDescription>
                    A brief description of your workspace
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end">
              <Button 
                type="submit" 
                disabled={isSubmitting || !form.formState.isDirty}
              >
                {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {isSubmitting ? "Updating..." : "Update Workspace"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}