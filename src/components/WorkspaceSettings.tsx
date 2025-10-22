"use client";

import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Edit3, Loader2, Upload, X, ImageIcon } from "lucide-react";

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
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";

export function WorkspaceSettings() {
  const { workspace, refreshCurrentWorkspace } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const canAccessWorkspaceLogo = useFeatureFlag(FEATURE_FLAGS.WORKSPACE_LOGO);

  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isDeletingLogo, setIsDeletingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchLogoUrl = async () => {
      if (!workspace?.logoKey || !workspace?.slug) {
        setLogoUrl(null);
        return;
      }

      try {
        const response = await fetch(`/api/workspaces/${workspace.slug}/image`);
        if (response.ok) {
          const data = await response.json();
          setLogoUrl(data.presignedUrl);
        }
      } catch (error) {
        console.error("Error fetching logo URL:", error);
      }
    };

    fetchLogoUrl();
  }, [workspace?.logoKey, workspace?.slug]);

  const form = useForm<UpdateWorkspaceInput>({
    resolver: zodResolver(updateWorkspaceSchema),
    defaultValues: {
      name: workspace?.name || "",
      slug: workspace?.slug || "",
      description: workspace?.description || "",
    },
  });

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !workspace) return;

    const maxSize = 1024 * 1024;
    if (file.size > maxSize) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: "Logo must be less than 1MB",
      });
      return;
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast({
        variant: "destructive",
        title: "Invalid file type",
        description: "Only JPEG, PNG, GIF, and WebP images are allowed",
      });
      return;
    }

    setIsUploadingLogo(true);

    try {
      const uploadUrlResponse = await fetch(
        `/api/workspaces/${workspace.slug}/settings/image/upload-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type,
            size: file.size,
          }),
        }
      );

      if (!uploadUrlResponse.ok) {
        const error = await uploadUrlResponse.json();
        throw new Error(error.error || "Failed to get upload URL");
      }

      const { presignedUrl, s3Path } = await uploadUrlResponse.json();

      await fetch(presignedUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type,
        },
      });

      const confirmResponse = await fetch(
        `/api/workspaces/${workspace.slug}/settings/image/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            s3Path,
            filename: file.name,
            mimeType: file.type,
            size: file.size,
          }),
        }
      );

      if (!confirmResponse.ok) {
        const error = await confirmResponse.json();
        throw new Error(error.error || "Failed to confirm upload");
      }

      toast({
        title: "Success",
        description: "Workspace logo updated successfully",
      });

      await refreshCurrentWorkspace();
      setLogoPreview(URL.createObjectURL(file));
    } catch (error) {
      console.error("Error uploading logo:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to upload logo",
      });
    } finally {
      setIsUploadingLogo(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleLogoDelete = async () => {
    if (!workspace) return;

    setIsDeletingLogo(true);

    try {
      const response = await fetch(
        `/api/workspaces/${workspace.slug}/settings/image`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete logo");
      }

      toast({
        title: "Success",
        description: "Workspace logo removed successfully",
      });

      await refreshCurrentWorkspace();
      setLogoPreview(null);
      setLogoUrl(null);
    } catch (error) {
      console.error("Error deleting logo:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete logo",
      });
    } finally {
      setIsDeletingLogo(false);
    }
  };

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
        {canAccessWorkspaceLogo && (
          <div className="mb-8 pb-8 border-b">
            <h3 className="text-lg font-medium mb-4">Workspace Logo</h3>
            <div className="flex items-start gap-6">
              <div className="flex-shrink-0">
                {logoPreview || logoUrl ? (
                  <div className="relative w-32 h-32 rounded-lg overflow-hidden border-2 border-gray-200">
                    <img
                      src={logoPreview || logoUrl || ""}
                      alt="Workspace logo"
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-32 h-32 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center bg-gray-50">
                    <ImageIcon className="w-12 h-12 text-gray-400" />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground mb-4">
                  Upload a logo for your workspace. Recommended size: 1200x400px. Max file size: 1MB.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingLogo || isDeletingLogo}
                  >
                    {isUploadingLogo ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Upload Logo
                      </>
                    )}
                  </Button>
                  {(workspace?.logoKey || logoPreview) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleLogoDelete}
                      disabled={isUploadingLogo || isDeletingLogo}
                    >
                      {isDeletingLogo ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Removing...
                        </>
                      ) : (
                        <>
                          <X className="w-4 h-4 mr-2" />
                          Remove Logo
                        </>
                      )}
                    </Button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
              </div>
            </div>
          </div>
        )}
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
                      data-testid="workspace-settings-name-input"
                      placeholder="The display name for your workspace" 
                      {...field} 
                      disabled={isSubmitting}
                    />
                  </FormControl>
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
                        data-testid="workspace-settings-slug-input"
                        placeholder="lowercase, use hyphens for spaces" 
                        {...field} 
                        disabled={isSubmitting}
                      />
                    </div>
                  </FormControl>
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
                      data-testid="workspace-settings-description-input"
                      placeholder="A brief description of your workspace"
                      className="resize-none"
                      {...field} 
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end">
              <Button 
                type="submit" 
                data-testid="workspace-settings-save-button"
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