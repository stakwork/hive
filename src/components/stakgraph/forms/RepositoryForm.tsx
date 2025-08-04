import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RepositoryData, FormSectionProps } from "../types";

export default function RepositoryForm({
  data,
  errors,
  loading,
  onChange,
}: FormSectionProps<RepositoryData>) {
  const handleInputChange = (field: keyof RepositoryData, value: string) => {
    onChange({ [field]: value });
  };

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold mb-2">Repository</h3>

      <div className="space-y-2">
        <Label htmlFor="repositoryUrl">Repository URL</Label>
        <Input
          id="repositoryUrl"
          type="url"
          placeholder="https://github.com/username/repository"
          value={data.repositoryUrl}
          onChange={(e) => handleInputChange("repositoryUrl", e.target.value)}
          className={errors.repositoryUrl ? "border-destructive" : ""}
          disabled={loading}
        />
        {errors.repositoryUrl && (
          <p className="text-sm text-destructive">{errors.repositoryUrl}</p>
        )}
        <p className="text-xs text-muted-foreground">
          The URL of the repository containing your project code
        </p>
      </div>
    </div>
  );
}
