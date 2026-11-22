import { describe, test, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

let selectionChange: ((n: { id: string; name: string; type: string } | null) => void) | undefined;
vi.mock("@/components/graph-workbench", () => ({
  Picker: () => null,
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

describe("GraphView URL sync", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/org/acme?view=graph");
    selectionChange = undefined;
  });

  const renderView = () =>
    render(
      <GraphView
        githubLogin="acme"
        workspaces={[{ slug: "ws", name: "WS", isDefault: true } as never]}
        loading={false}
        chatOpen={false}
        onToggleChat={() => {}}
        onFocusChange={() => {}}
      />,
    );

  test("replaces ref_id on focus, keeps other params, removes it on clear", () => {
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");
    renderView();

    selectionChange!(null); // still loading: no change
    expect(window.location.search).toBe("?view=graph");

    selectionChange!({ id: "ref-9", name: "N", type: "Concept" });
    expect(window.location.search).toBe("?view=graph&workspace=ws&ref_id=ref-9");

    selectionChange!(null);
    expect(window.location.search).toBe("?view=graph&workspace=ws");
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  test("names a type other than the default tree's, and drops the old gnode param", () => {
    window.history.replaceState(null, "", "/org/acme?view=graph&gnode=old");
    renderView();

    selectionChange!({ id: "d-1", name: "Users", type: "Datamodel" });

    expect(window.location.search).toBe("?view=graph&workspace=ws&type=Datamodel&ref_id=d-1");
  });
});
