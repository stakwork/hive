import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  actions?: ReactNode;
  className?: string;
  spacing?: string;
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  iconClassName = "h-8 w-8 text-blue-600",
  actions,
  className,
  spacing = "mb-6"
}: PageHeaderProps) {
  const defaultClassName = actions ? "flex justify-between items-start" : "";
  
  return (
    <div className={`${className || defaultClassName} ${spacing}`}>
      <div className="flex items-center space-x-3">
        {Icon && <Icon className={iconClassName} />}
        <div>
          <h1 className="text-3xl font-bold text-foreground">{title}</h1>
          {description && (
            <p className="text-muted-foreground mt-2">{description}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex items-center space-x-2">
          {actions}
        </div>
      )}
    </div>
  );
}