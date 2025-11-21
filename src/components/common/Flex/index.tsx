import React from "react";
import { cn } from "@/lib/utils";

interface FlexProps extends React.HTMLAttributes<HTMLDivElement> {
  direction?: "row" | "col" | "row-reverse" | "col-reverse";
  justify?: "start" | "end" | "center" | "between" | "around" | "evenly";
  align?: "start" | "end" | "center" | "baseline" | "stretch";
  wrap?: "nowrap" | "wrap" | "wrap-reverse";
  gap?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16 | 20 | 24;
  children: React.ReactNode;
}

const directionMap = {
  row: "flex-row",
  col: "flex-col",
  "row-reverse": "flex-row-reverse",
  "col-reverse": "flex-col-reverse",
};

const justifyMap = {
  start: "justify-start",
  end: "justify-end",
  center: "justify-center",
  between: "justify-between",
  around: "justify-around",
  evenly: "justify-evenly",
};

const alignMap = {
  start: "items-start",
  end: "items-end",
  center: "items-center",
  baseline: "items-baseline",
  stretch: "items-stretch",
};

const wrapMap = {
  nowrap: "flex-nowrap",
  wrap: "flex-wrap",
  "wrap-reverse": "flex-wrap-reverse",
};

const gapMap = {
  0: "gap-0",
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  5: "gap-5",
  6: "gap-6",
  8: "gap-8",
  10: "gap-10",
  12: "gap-12",
  16: "gap-16",
  20: "gap-20",
  24: "gap-24",
};

export const Flex = React.forwardRef<HTMLDivElement, FlexProps>(
  (
    { direction = "row", justify = "start", align = "start", wrap = "nowrap", gap = 0, className, children, ...props },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex",
          directionMap[direction],
          justifyMap[justify],
          alignMap[align],
          wrapMap[wrap],
          gapMap[gap],
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

Flex.displayName = "Flex";
