import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Filter } from "lucide-react";
import { useMemo } from "react";
import { useGraphStore } from "@/stores/useStores";
import type { TestLayerVisibility } from "@/stores/graphStore.types";

export function TestFilterDropdown() {
  const testLayerVisibility = useGraphStore((s) => s.testLayerVisibility);
  const setTestLayerVisibility = useGraphStore((s) => s.setTestLayerVisibility);

  const testToggles = useMemo(
    () => [
      { key: "unitTests", label: "Unit Tests" },
      { key: "integrationTests", label: "Integration Tests" },
      { key: "e2eTests", label: "E2E Tests" },
    ] as const,
    []
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 h-9 px-3 border border-input bg-background shadow-sm"
        >
          <Filter className="w-4 h-4" />
          Tests
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Toggle test layers
        </DropdownMenuLabel>
        {testToggles.map((toggle) => (
          <DropdownMenuCheckboxItem
            key={toggle.key}
            checked={Boolean(testLayerVisibility[toggle.key])}
            onCheckedChange={(checked) =>
              setTestLayerVisibility({ [toggle.key]: checked } as Partial<TestLayerVisibility>)
            }
            className="capitalize"
          >
            {toggle.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
