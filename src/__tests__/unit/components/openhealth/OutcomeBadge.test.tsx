import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OutcomeBadge } from "@/components/openhealth/format";

const label = () => screen.getByTestId("openhealth-outcome").textContent;

describe("OutcomeBadge", () => {
  it("shows Reached for a succeeded run at the target", () => {
    render(<OutcomeBadge outcome="succeeded" score={1} />);
    expect(label()).toBe("Reached");
  });

  it("shows Scored below the target", () => {
    render(<OutcomeBadge outcome="succeeded" score={0.57} />);
    expect(label()).toBe("Scored");
  });

  it("shows Scored when the score is null", () => {
    render(<OutcomeBadge outcome="succeeded" score={null} />);
    expect(label()).toBe("Scored");
  });

  it("shows Failed for a failed run even at score 1", () => {
    render(<OutcomeBadge outcome="failed" score={1} />);
    expect(label()).toBe("Failed");
  });
});
