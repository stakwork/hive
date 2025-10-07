import { describe, it, expect, vi, beforeEach } from "vitest";
import { modal } from "@/lib/modal";
import { useModalStore } from "@/stores/useModalsStore";

vi.mock("@/stores/useModalsStore", () => ({
  useModalStore: {
    getState: vi.fn(),
  },
}));

describe("modal", () => {
  const mockOpen = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useModalStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
      open: mockOpen,
    });
  });

  describe("open", () => {
    it("should call store open method with name", () => {
      modal.open("testModal");

      expect(useModalStore.getState).toHaveBeenCalled();
      expect(mockOpen).toHaveBeenCalledWith("testModal", undefined);
    });

    it("should call store open method with name and props", () => {
      const props = { userId: "123", action: "edit" };
      modal.open("testModal", props);

      expect(useModalStore.getState).toHaveBeenCalled();
      expect(mockOpen).toHaveBeenCalledWith("testModal", props);
    });

    it("should handle empty props object", () => {
      modal.open("testModal", {});

      expect(mockOpen).toHaveBeenCalledWith("testModal", {});
    });

    it("should handle complex props", () => {
      const props = {
        user: { id: "123", name: "Test" },
        callback: vi.fn(),
        items: [1, 2, 3],
      };
      modal.open("complexModal", props);

      expect(mockOpen).toHaveBeenCalledWith("complexModal", props);
    });

    it("should work with different modal names", () => {
      modal.open("addMember");
      expect(mockOpen).toHaveBeenCalledWith("addMember", undefined);

      modal.open("deleteConfirm");
      expect(mockOpen).toHaveBeenCalledWith("deleteConfirm", undefined);

      modal.open("editWorkspace");
      expect(mockOpen).toHaveBeenCalledWith("editWorkspace", undefined);
    });
  });
});