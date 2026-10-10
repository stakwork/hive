import { describe, test, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

let selectionChange: ((n: { id: string; name: string; type: string } | null) => void) | undefined;
vi.mock("@/components/graph-workbench", () => ({
  GraphWorkbench: (props: { onSelectionChange: typeof selectionChange }) => {
    selectionChange = props.onSelectionChange;
    return null;
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/org/acme",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { GraphView } from "@/app/org/[githubLogin]/_components/GraphView";

describe("GraphView gnode URL sync", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/org/acme?view=graph");
    selectionChange = undefined;
  });

  test("replaces gnode on focus, keeps other params, removes it on clear", () => {
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");
    render(
      <GraphView
        workspaces={[{ slug: "ws", name: "WS", isDefault: true } as never]}
        loading={false}
        chatOpen={false}
        onToggleChat={() => {}}
        onFocusChange={() => {}}
      />,
    );

    selectionChange!(null); // still loading: no change
    expect(window.location.search).toBe("?view=graph");

    selectionChange!({ id: "ref-9", name: "N", type: "Concept" });
    expect(new URLSearchParams(window.location.search).get("gnode")).toBe("ref-9");
    expect(new URLSearchParams(window.location.search).get("view")).toBe("graph");

    selectionChange!(null);
    expect(window.location.search).toBe("?view=graph");
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
