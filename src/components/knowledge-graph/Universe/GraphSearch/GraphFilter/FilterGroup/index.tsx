import React from "react";
import { cn } from "@/lib/utils";

const splitIntoColumns = (items: string[]): string[][] => {
  const maxItemsPerColumn = 8;
  const maxColumns = 3;

  if (items.length <= maxItemsPerColumn) {
    return [items];
  }

  if (items.length <= maxItemsPerColumn * 2) {
    const half = Math.ceil(items.length / 2);

    return [items.slice(0, half), items.slice(half)];
  }

  const itemsPerColumn = Math.ceil(items.length / maxColumns);

  return [
    items.slice(0, itemsPerColumn),
    items.slice(itemsPerColumn, itemsPerColumn * 2),
    items.slice(itemsPerColumn * 2),
  ];
};

type FilterGroupProps = {
  title: string;
  types: string[];
  selectedTypes: string[];
  onTypeClick: (type: string) => void;
  onResetClick: () => void;
  getColor?: (type: string) => string;
};

export const FilterGroup: React.FC<FilterGroupProps> = ({
  title,
  types,
  selectedTypes,
  onTypeClick,
  onResetClick,
  getColor = () => "#ffffff",
}) => {
  const columns = splitIntoColumns(types);
  const needsSeveralColumns = columns.length > 1;
  const isAllSelected = selectedTypes.length === 0 || selectedTypes.length === types.length;

  return (
    <div className="flex flex-col gap-3 border-r border-black px-4 last:border-r-0">
      <div className="flex flex-col gap-2 py-4 max-h-[300px] overflow-y-auto">
        <div
          className={cn(
            "flex flex-row items-center cursor-pointer p-2 rounded transition-all hover:bg-gray-700 active:bg-gray-600",
            isAllSelected && "bg-gray-700",
          )}
          onClick={onResetClick}
        >
          <div className={cn("w-3 h-3 rounded-full mr-2 transition-all", isAllSelected ? "bg-white" : "bg-gray-600")} />
          <span
            className={cn(
              "font-medium text-sm whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px] font-barlow",
              isAllSelected ? "text-gray-300 font-semibold" : "text-gray-400",
            )}
          >
            All {title}
          </span>
        </div>
        <div className={cn("flex", needsSeveralColumns ? "flex-row gap-10" : "flex-col")}>
          {columns.map((column, index) => (
            <div key={`column-${index}`} className="max-w-[420px] min-w-[120px]">
              {column.map((type: string) => {
                const isTypeActive = selectedTypes.includes(type) || isAllSelected;

                return (
                  <div
                    key={type}
                    className={cn(
                      "flex flex-row items-center cursor-pointer p-2 rounded transition-all hover:bg-gray-700 active:bg-gray-600",
                      isTypeActive && "bg-gray-700",
                    )}
                    onClick={() => onTypeClick(type)}
                  >
                    <div
                      className={cn(
                        "w-3 h-3 rounded-full mr-2 transition-all",
                        isTypeActive ? "bg-white" : "bg-gray-600",
                      )}
                      style={{
                        backgroundColor: isTypeActive ? getColor(type) : undefined,
                      }}
                    />
                    <span
                      className={cn(
                        "font-medium text-sm whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px] font-barlow",
                        isTypeActive ? "text-gray-300 font-semibold" : "text-gray-400",
                      )}
                    >
                      {type}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
