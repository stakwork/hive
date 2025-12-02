"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FeaturePriority } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const featureFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  brief: z.string().optional(),
  priority: z.nativeEnum(FeaturePriority),
});

type FeatureFormData = z.infer<typeof featureFormSchema>;

interface FeatureFormProps {
  workspaceId: string;
  initialData?: {
    id?: string;
    title?: string;
    brief?: string;
    priority?: FeaturePriority;
  };
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function FeatureForm({
  workspaceId,
  initialData,
  onSuccess,
  onCancel,
}: FeatureFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<FeatureFormData>({
    resolver: zodResolver(featureFormSchema),
    defaultValues: {
      title: initialData?.title || "",
      brief: initialData?.brief || "",
      priority: initialData?.priority || FeaturePriority.MEDIUM,
    },
  });

  const currentPriority = watch("priority");

  const onSubmit = async (data: FeatureFormData) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const url = initialData?.id
        ? `/api/roadmap/features/${initialData.id}`
        : "/api/roadmap/features";

      const method = initialData?.id ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...data,
          workspaceId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save feature");
      }

      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save feature");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          data-testid="feature-title-input"
          placeholder="Enter feature title"
          {...register("title")}
          disabled={isSubmitting}
        />
        {errors.title && (
          <p className="text-sm text-red-500">{errors.title.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="brief">Description</Label>
        <Textarea
          id="brief"
          data-testid="feature-brief-input"
          placeholder="Enter feature description"
          rows={4}
          {...register("brief")}
          disabled={isSubmitting}
        />
        {errors.brief && (
          <p className="text-sm text-red-500">{errors.brief.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="priority">Priority</Label>
        <Select
          value={currentPriority}
          onValueChange={(value) => setValue("priority", value as FeaturePriority)}
          disabled={isSubmitting}
        >
          <SelectTrigger id="priority" data-testid="feature-priority-select">
            <SelectValue placeholder="Select priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FeaturePriority.NONE}>None</SelectItem>
            <SelectItem value={FeaturePriority.LOW}>Low</SelectItem>
            <SelectItem value={FeaturePriority.MEDIUM}>Medium</SelectItem>
            <SelectItem value={FeaturePriority.HIGH}>High</SelectItem>
            <SelectItem value={FeaturePriority.URGENT}>Urgent</SelectItem>
          </SelectContent>
        </Select>
        {errors.priority && (
          <p className="text-sm text-red-500">{errors.priority.message}</p>
        )}
      </div>

      {error && (
        <div
          className="rounded-md bg-red-50 p-4 text-sm text-red-800"
          data-testid="feature-form-error"
        >
          {error}
        </div>
      )}

      <div className="flex gap-3 justify-end">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
            data-testid="feature-form-cancel-button"
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={isSubmitting}
          data-testid="feature-form-submit-button"
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {initialData?.id ? "Update" : "Create"} Feature
        </Button>
      </div>
    </form>
  );
}
