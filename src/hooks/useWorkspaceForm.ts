import { useState } from "react";
import { useRouter } from "next/navigation";

interface WorkspaceFormData {
  name: string;
  description: string;
  slug: string;
}

interface WorkspaceFormErrors {
  [key: string]: string;
}

export function useWorkspaceForm() {
  const router = useRouter();
  const [formData, setFormData] = useState<WorkspaceFormData>({
    name: "",
    description: "",
    slug: "",
  });
  const [errors, setErrors] = useState<WorkspaceFormErrors>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Auto-generate slug from name
  const updateName = (name: string) => {
    setFormData((prev) => ({
      ...prev,
      name,
      slug: name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .trim(),
    }));
  };

  const updateField = (field: keyof WorkspaceFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const validateForm = (): boolean => {
    const newErrors: WorkspaceFormErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = "Workspace name is required";
    }

    if (!formData.slug.trim()) {
      newErrors.slug = "Slug is required";
    } else if (formData.slug.length < 3) {
      newErrors.slug = "Slug must be at least 3 characters";
    } else if (!/^[a-z0-9-]+$/.test(formData.slug)) {
      newErrors.slug =
        "Slug can only contain lowercase letters, numbers, and hyphens";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const submitForm = async (): Promise<boolean> => {
    setApiError(null);

    if (!validateForm()) {
      return false;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim(),
          slug: formData.slug.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create workspace");
      }

      // After successful creation, redirect to tasks page (use server slug in case it was adjusted)
      router.push(`/w/${data.workspace?.slug || formData.slug}`);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setApiError(errorMessage);
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
    formData,
    errors,
    loading,
    apiError,
    updateName,
    updateField,
    submitForm,
  };
}
