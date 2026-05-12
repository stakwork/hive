import { describe, it, expect } from "vitest";
import { createLinkElement } from "@/services/whiteboard-elements";

describe("createLinkElement", () => {
  it("returns an array of two elements", () => {
    const elements = createLinkElement("https://example.com", "Example", 100, 200);
    expect(elements).toHaveLength(2);
  });

  it("first element is a rectangle with the correct link property", () => {
    const [rect] = createLinkElement("https://example.com", "My Link", 0, 0) as Record<
      string,
      unknown
    >[];
    expect(rect.type).toBe("rectangle");
    expect(rect.link).toBe("https://example.com");
  });

  it("second element is a text element with the label", () => {
    const [, text] = createLinkElement("https://example.com", "My Label", 0, 0) as Record<
      string,
      unknown
    >[];
    expect(text.type).toBe("text");
    expect(text.text).toBe("My Label");
    expect(text.originalText).toBe("My Label");
  });

  it("both elements share the same groupId", () => {
    const [rect, text] = createLinkElement("https://example.com", "Label", 0, 0) as Record<
      string,
      unknown
    >[];
    const rectGroupIds = rect.groupIds as string[];
    const textGroupIds = text.groupIds as string[];
    expect(rectGroupIds).toHaveLength(1);
    expect(textGroupIds).toHaveLength(1);
    expect(rectGroupIds[0]).toBe(textGroupIds[0]);
  });

  it("text containerId references the rectangle id", () => {
    const [rect, text] = createLinkElement("https://example.com", "Label", 0, 0) as Record<
      string,
      unknown
    >[];
    expect(text.containerId).toBe(rect.id);
  });

  it("rectangle boundElements references the text id", () => {
    const [rect, text] = createLinkElement("https://example.com", "Label", 0, 0) as Record<
      string,
      unknown
    >[];
    const bound = rect.boundElements as { id: string; type: string }[];
    expect(bound).toHaveLength(1);
    expect(bound[0].id).toBe(text.id);
    expect(bound[0].type).toBe("text");
  });

  it("both elements have customData.isLinkObject = true", () => {
    const [rect, text] = createLinkElement("https://example.com", "Label", 0, 0) as Record<
      string,
      unknown
    >[];
    expect((rect.customData as Record<string, unknown>).isLinkObject).toBe(true);
    expect((text.customData as Record<string, unknown>).isLinkObject).toBe(true);
  });

  it("centers the rectangle at the given coordinates", () => {
    const centerX = 300;
    const centerY = 400;
    const [rect] = createLinkElement("https://example.com", "Label", centerX, centerY) as Record<
      string,
      unknown
    >[];
    const width = 240;
    const height = 64;
    expect(rect.x).toBe(centerX - width / 2);
    expect(rect.y).toBe(centerY - height / 2);
  });

  it("uses the url as text link is null on text element", () => {
    const [, text] = createLinkElement("https://example.com", "Label", 0, 0) as Record<
      string,
      unknown
    >[];
    expect(text.link).toBeNull();
  });

  it("rectangle has roundness type 3 for rounded corners", () => {
    const [rect] = createLinkElement("https://example.com", "Label", 0, 0) as Record<
      string,
      unknown
    >[];
    expect(rect.roundness).toEqual({ type: 3 });
  });

  it("rectangle uses blue stroke and light-blue fill", () => {
    const [rect] = createLinkElement("https://example.com", "Label", 0, 0) as Record<
      string,
      unknown
    >[];
    expect(rect.strokeColor).toBe("#3b82f6");
    expect(rect.backgroundColor).toBe("#eff6ff");
  });
});
