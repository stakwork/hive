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
  iconClassName = "h-6 w-6 md:h-8 md:w-8 text-blue-600",
  actions,
  className,
  spacing = "mb-6",
}: PageHeaderProps) {
  const defaultClassName = actions ? "flex flex-col md:flex-row md:justify-between md:items-start gap-4" : "";

  return (
    <div className={`${className || defaultClassName} ${spacing}`} data-testid="page-header">
      <div className="flex items-center space-x-2 md:space-x-3">
        {Icon && <Icon className={iconClassName} />}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground" data-testid="page-title">
            {title}
          </h1>
          {description && (
            <p className="text-sm md:text-base text-muted-foreground mt-1 md:mt-2" data-testid="page-description">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
