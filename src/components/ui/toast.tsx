// Copied and adapted from shadcn/ui toast primitive
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-lg border p-4 pr-6 shadow-lg transition-all bg-background dark:bg-background",
  {
    variants: {
      variant: {
        default: "border border-gray-200 dark:border-zinc-800",
        success: "border-green-500",
        destructive: "border-red-500",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface ToastProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "description">,
    VariantProps<typeof toastVariants> {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  duration?: number;
}

export const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  ({ className, variant, title, description, action, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(toastVariants({ variant }), className)}
        {...props}
      >
        {/* Icon for success variant */}
        {variant === "success" && (
          <span className="flex items-start pt-1">
            <CheckCircle2 className="w-6 h-6 text-green-500" />
          </span>
        )}
        <div
          className={cn(
            "flex flex-col gap-1",
            variant === "success" ? "ml-1" : "",
          )}
        >
          {title && (
            <div
              className={cn(
                "font-semibold text-base",
                variant === "success"
                  ? "text-green-600 dark:text-green-400"
                  : "",
              )}
            >
              {title}
            </div>
          )}
          {description && (
            <div className="text-sm text-muted-foreground">{description}</div>
          )}
        </div>
        {action && <div>{action}</div>}
      </div>
    );
  },
);
Toast.displayName = "Toast";
