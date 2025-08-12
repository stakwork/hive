import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import { useWorkspaceForm } from "@/hooks/useWorkspaceForm";
import { FormField } from "./FormField";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ErrorDisplay } from "@/components/ui/error-display";

export function WorkspaceForm() {
  const {
    formData,
    errors,
    loading,
    apiError,
    updateName,
    updateField,
    submitForm,
  } = useWorkspaceForm();

  const { refreshWorkspaces } = useWorkspace();
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitForm();
    refreshWorkspaces();
  };

  return (
    <Card className="border-0 shadow-xl bg-card text-card-foreground">
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <FormField
            id="name"
            label="Workspace Name"
            placeholder="e.g., My Company, Product Team, Personal Projects"
            value={formData.name}
            onChange={updateName}
            error={errors.name}
            helpText="Choose a name that represents your team or organization."
            disabled={loading}
          />

          <FormField
            id="slug"
            label="Workspace URL"
            placeholder="my-workspace"
            value={formData.slug}
            onChange={(value) => updateField("slug", value.toLowerCase())}
            error={errors.slug}
            helpText="This will be your workspace's unique URL. Only lowercase letters, numbers, and hyphens allowed."
            disabled={loading}
            prefix="hive.app/"
          />

          <FormField
            id="description"
            label="Description (Optional)"
            type="textarea"
            placeholder="Describe what this workspace will be used for..."
            value={formData.description}
            onChange={(value) => updateField("description", value)}
            helpText="Help your team understand the purpose of this workspace."
            disabled={loading}
            rows={3}
          />

          <ErrorDisplay error={apiError} />

          <Button
            type="submit"
            disabled={loading || !formData.name || !formData.slug}
            className="w-full h-12 text-base font-medium"
          >
            {loading ? (
              "Creating Workspace..."
            ) : (
              <>
                Create Workspace
                <ArrowRight className="w-5 h-5 ml-2" />
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
