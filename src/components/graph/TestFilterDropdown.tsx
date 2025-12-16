import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TestLayerType } from "@/stores/graphStore.types";
import { useGraphStore } from "@/stores/useStores";
import { Filter } from "lucide-react";
import { useMemo } from "react";

export function TestFilterDropdown() {
  const testLayerVisibility = useGraphStore((s) => s.testLayerVisibility);
  const setTestLayerVisibility = useGraphStore((s) => s.setTestLayerVisibility);

  const testOptions = useMemo(
    () => [
      { key: "unitTests", label: "Unit Tests" },
      { key: "integrationTests", label: "Integration Tests" },
      { key: "e2eTests", label: "E2E Tests" },
    ] as const,
    []
  );

  const selectedLayer = testLayerVisibility.selectedLayer;
  const selectedLabel = testOptions.find(option => option.key === selectedLayer)?.label || "Tests";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 h-9 px-3 border border-input bg-background shadow-sm"
        >
          <Filter className="w-4 h-4" />
          {selectedLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Select test layer
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={selectedLayer || "none"}
          onValueChange={(value) => setTestLayerVisibility(value === "none" ? null : value as TestLayerType)}
        >
          <DropdownMenuRadioItem value="none">
            None
          </DropdownMenuRadioItem>
          {testOptions.map((option) => (
            <DropdownMenuRadioItem
              key={option.key}
              value={option.key}
              className="capitalize"
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
