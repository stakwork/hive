import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ProjectInfoData, FormSectionProps } from "../types";

export default function ProjectInfoForm({
  data,
  errors,
  loading,
  onChange,
}: FormSectionProps<ProjectInfoData>) {
  const handleInputChange = (field: keyof ProjectInfoData, value: string) => {
    onChange({ [field]: value });
  };

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold mb-2">Project Info</h3>

      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          placeholder="Project Name"
          value={data.name}
          onChange={(e) => handleInputChange("name", e.target.value)}
          className={errors.name ? "border-destructive" : ""}
          disabled={loading}
        />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name}</p>
        )}
      </div>

    </div>
  );
}
