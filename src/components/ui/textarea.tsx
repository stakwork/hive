import * as React from "react";

import { cn } from "@/lib/utils";

interface TextareaProps extends React.ComponentProps<"textarea"> {
  isDragging?: boolean;
  isUploading?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, isDragging, isUploading, ...props }, ref) => {
    return (
      <div className="relative w-full">
        <textarea
          ref={ref}
          data-slot="textarea"
          className={cn(
            "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            isDragging && "border-primary border-2 ring-2 ring-primary/20 bg-primary/5",
            isUploading && "opacity-60 cursor-wait",
            className,
          )}
          {...props}
        />
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-primary/10 rounded-md">
            <div className="bg-background/90 px-4 py-2 rounded-lg shadow-lg border-2 border-primary">
              <p className="text-sm font-medium text-primary">Drop image here</p>
            </div>
          </div>
        )}
        {isUploading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-background/90 px-4 py-2 rounded-lg shadow-lg border">
              <p className="text-sm font-medium">Uploading image...</p>
            </div>
          </div>
        )}
      </div>
    );
  },
);

Textarea.displayName = "Textarea";

export { Textarea };
