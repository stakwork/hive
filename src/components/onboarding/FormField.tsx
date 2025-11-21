import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface FormFieldProps {
  id: string;
  label: string;
  type?: "input" | "textarea";
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  helpText?: string;
  disabled?: boolean;
  rows?: number;
  prefix?: string;
  className?: string;
}

export function FormField({
  id,
  label,
  type = "input",
  placeholder,
  value,
  onChange,
  error,
  helpText,
  disabled = false,
  rows = 3,
  prefix,
  className,
}: FormFieldProps) {
  const inputClassName = error ? "border-destructive" : "";
  const fullClassName = className ? `${inputClassName} ${className}` : inputClassName;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>

      {prefix ? (
        <div className="flex items-center space-x-2">
          <span className="text-sm text-muted-foreground">{prefix}</span>
          <Input
            id={id}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`${fullClassName} flex-1`}
            disabled={disabled}
          />
        </div>
      ) : type === "textarea" ? (
        <Textarea
          id={id}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={fullClassName}
          disabled={disabled}
          rows={rows}
        />
      ) : (
        <Input
          id={id}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={fullClassName}
          disabled={disabled}
        />
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
    </div>
  );
}
