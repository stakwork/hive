import { Building2 } from "lucide-react";

interface OnboardingHeaderProps {
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export function OnboardingHeader({
  title,
  description,
  icon: Icon = Building2,
}: OnboardingHeaderProps) {
  return (
    <div className="text-center mb-8">
      <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 bg-primary rounded-full">
        <Icon className="w-8 h-8 text-primary-foreground" />
      </div>
      <h1 className="text-3xl font-bold text-foreground">{title}</h1>
      <p className="text-muted-foreground mt-2 text-lg">{description}</p>
    </div>
  );
}
