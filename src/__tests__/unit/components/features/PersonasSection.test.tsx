import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { PersonasSection } from "@/components/features/PersonasSection";
import { COMMON_PERSONAS } from "@/lib/constants/personas";

describe("PersonasSection", () => {
  const defaultProps = {
    personas: [],
    savedField: null,
    saving: false,
    saved: false,
    onChange: vi.fn(),
    onBlur: vi.fn(),
  };

  beforeAll(() => {
    // Mock scrollIntoView for Command component (cmdk)
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Dropdown Suggestions", () => {
    it("should only show COMMON_PERSONAS in dropdown", async () => {
      render(<PersonasSection {...defaultProps} />);
      
      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.focus(input);

      await waitFor(() => {
        COMMON_PERSONAS.forEach((persona) => {
          expect(screen.getByText(persona)).toBeInTheDocument();
        });
      });
    });

    it("should filter dropdown based on input", async () => {
      render(<PersonasSection {...defaultProps} />);
      
      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.change(input, { target: { value: "Admin" } });

      await waitFor(() => {
        expect(screen.getByText("Admin")).toBeInTheDocument();
        expect(screen.getByText("System Administrator")).toBeInTheDocument();
        // Other personas should not be visible (not containing "Admin")
        expect(screen.queryByText("End User")).not.toBeInTheDocument();
      });
    });

    it("should exclude already selected personas from dropdown", async () => {
      render(<PersonasSection {...defaultProps} personas={["Admin", "End User"]} />);
      
      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.focus(input);

      await waitFor(() => {
        // Already selected personas should not appear in dropdown
        const dropdownItems = screen.queryAllByRole("option");
        const dropdownText = dropdownItems.map(item => item.textContent);
        
        expect(dropdownText).not.toContain("Admin");
        expect(dropdownText).not.toContain("End User");
        expect(dropdownText).toContain("Developer");
      });
    });

    it("should show 'No more personas available' when all personas are selected", async () => {
      render(<PersonasSection {...defaultProps} personas={[...COMMON_PERSONAS]} />);
      
      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText("No more personas available")).toBeInTheDocument();
      });
    });

    it("should show 'No more personas available' when filtered results are empty", async () => {
      render(<PersonasSection {...defaultProps} />);
      
      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.change(input, { target: { value: "NonExistentPersona" } });

      await waitFor(() => {
        expect(screen.getByText("No more personas available")).toBeInTheDocument();
      });
    });
  });

  describe("Adding Personas via Dropdown", () => {
    it("should add persona when selected from dropdown", async () => {
      const onChange = vi.fn();
      const onBlur = vi.fn();
      
      render(<PersonasSection {...defaultProps} onChange={onChange} onBlur={onBlur} />);
      
      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText("Admin")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Admin"));

      expect(onChange).toHaveBeenCalledWith(["Admin"]);
      expect(onBlur).toHaveBeenCalledWith(["Admin"]);
    });

    it("should clear input after adding persona from dropdown", async () => {
      render(<PersonasSection {...defaultProps} />);
      
      const input = screen.getByPlaceholderText(/Add persona/i) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "Admin" } });
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText("Admin")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Admin"));

      // Input should be cleared after selection
      await waitFor(() => {
        expect(input.value).toBe("");
      });
    });
  });

  describe("Enter Key Behavior", () => {
    it("should NOT add custom persona when pressing Enter with non-COMMON_PERSONAS text", async () => {
      const onChange = vi.fn();
      const onBlur = vi.fn();
      
      render(<PersonasSection {...defaultProps} onChange={onChange} onBlur={onBlur} />);
      
      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.change(input, { target: { value: "Custom Persona" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // onChange and onBlur should NOT be called
      expect(onChange).not.toHaveBeenCalled();
      expect(onBlur).not.toHaveBeenCalled();
    });

    it("should add persona when pressing Enter with valid COMMON_PERSONAS text", async () => {
      const onChange = vi.fn();
      const onBlur = vi.fn();
      
      render(<PersonasSection {...defaultProps} onChange={onChange} onBlur={onBlur} />);
      
      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.change(input, { target: { value: "Admin" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      expect(onChange).toHaveBeenCalledWith(["Admin"]);
      expect(onBlur).toHaveBeenCalledWith(["Admin"]);
    });

    it("should remove last persona when pressing Backspace on empty input", () => {
      const onChange = vi.fn();
      const onBlur = vi.fn();
      
      render(
        <PersonasSection 
          {...defaultProps} 
          personas={["Admin", "Developer"]}
          onChange={onChange}
          onBlur={onBlur}
        />
      );
      
      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.keyDown(input, { key: "Backspace", code: "Backspace" });

      expect(onChange).toHaveBeenCalledWith(["Admin"]);
      expect(onBlur).toHaveBeenCalledWith(["Admin"]);
    });

    it("should close dropdown when pressing Escape", async () => {
      render(<PersonasSection {...defaultProps} />);
      
      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText("End User")).toBeInTheDocument();
      });

      fireEvent.keyDown(input, { key: "Escape", code: "Escape" });

      await waitFor(() => {
        expect(screen.queryByText("End User")).not.toBeInTheDocument();
      });
    });
  });

  describe("Add Button Behavior", () => {
    it("should be disabled when input is empty", () => {
      render(<PersonasSection {...defaultProps} />);
      
      const addButton = screen.getByRole("button", { name: /Add/i });
      expect(addButton).toBeDisabled();
    });

    it("should be disabled when input contains non-COMMON_PERSONAS text", () => {
      render(<PersonasSection {...defaultProps} />);
      
      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.change(input, { target: { value: "Custom Persona" } });

      const addButton = screen.getByRole("button", { name: /Add/i });
      expect(addButton).toBeDisabled();
    });

    it("should be enabled when input contains valid COMMON_PERSONAS text", () => {
      render(<PersonasSection {...defaultProps} />);
      
      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.change(input, { target: { value: "Admin" } });

      const addButton = screen.getByRole("button", { name: /Add/i });
      expect(addButton).not.toBeDisabled();
    });

    it("should NOT add persona when clicked with non-COMMON_PERSONAS text", () => {
      const onChange = vi.fn();
      const onBlur = vi.fn();
      
      render(<PersonasSection {...defaultProps} onChange={onChange} onBlur={onBlur} />);
      
      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.change(input, { target: { value: "Custom Persona" } });

      const addButton = screen.getByRole("button", { name: /Add/i });
      // Button should be disabled, but even if clicked, should not add
      fireEvent.click(addButton);

      expect(onChange).not.toHaveBeenCalled();
      expect(onBlur).not.toHaveBeenCalled();
    });

    it("should add persona when clicked with valid COMMON_PERSONAS text", () => {
      const onChange = vi.fn();
      const onBlur = vi.fn();
      
      render(<PersonasSection {...defaultProps} onChange={onChange} onBlur={onBlur} />);
      
      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.change(input, { target: { value: "Admin" } });

      const addButton = screen.getByRole("button", { name: /Add/i });
      fireEvent.click(addButton);

      expect(onChange).toHaveBeenCalledWith(["Admin"]);
      expect(onBlur).toHaveBeenCalledWith(["Admin"]);
    });
  });

  describe("Existing Personas Display", () => {
    it("should display all existing personas as badges", () => {
      render(
        <PersonasSection 
          {...defaultProps} 
          personas={["Admin", "Developer", "End User"]}
        />
      );

      expect(screen.getByText("Admin")).toBeInTheDocument();
      expect(screen.getByText("Developer")).toBeInTheDocument();
      expect(screen.getByText("End User")).toBeInTheDocument();
    });

    it("should display legacy custom personas (backward compatibility)", () => {
      // Legacy custom personas that are not in COMMON_PERSONAS
      render(
        <PersonasSection 
          {...defaultProps} 
          personas={["Custom Legacy Persona", "Admin", "Another Custom"]}
        />
      );

      // All personas should be displayed, including custom ones
      expect(screen.getByText("Custom Legacy Persona")).toBeInTheDocument();
      expect(screen.getByText("Admin")).toBeInTheDocument();
      expect(screen.getByText("Another Custom")).toBeInTheDocument();
    });

    it("should allow removal of any persona including legacy custom ones", () => {
      const onChange = vi.fn();
      const onBlur = vi.fn();
      
      render(
        <PersonasSection 
          {...defaultProps} 
          personas={["Custom Legacy Persona", "Admin"]}
          onChange={onChange}
          onBlur={onBlur}
        />
      );

      const removeButtons = screen.getAllByRole("button", { name: /Remove/i });
      // Click remove button for "Custom Legacy Persona"
      fireEvent.click(removeButtons[0]);

      expect(onChange).toHaveBeenCalledWith(["Admin"]);
      expect(onBlur).toHaveBeenCalledWith(["Admin"]);
    });

    it("should show remove button for each persona", () => {
      render(
        <PersonasSection 
          {...defaultProps} 
          personas={["Admin", "Developer"]}
        />
      );

      const removeButtons = screen.getAllByRole("button", { name: /Remove/i });
      expect(removeButtons).toHaveLength(2);
    });

    it("should remove persona when X button is clicked", () => {
      const onChange = vi.fn();
      const onBlur = vi.fn();
      
      render(
        <PersonasSection 
          {...defaultProps} 
          personas={["Admin", "Developer", "End User"]}
          onChange={onChange}
          onBlur={onBlur}
        />
      );

      // Find and click the remove button for "Developer"
      const removeButton = screen.getByRole("button", { name: /Remove Developer/i });
      fireEvent.click(removeButton);

      expect(onChange).toHaveBeenCalledWith(["Admin", "End User"]);
      expect(onBlur).toHaveBeenCalledWith(["Admin", "End User"]);
    });
  });

  describe("Saving States", () => {
    it("should show 'Saving...' when saving is true", () => {
      render(
        <PersonasSection 
          {...defaultProps} 
          savedField="personas"
          saving={true}
        />
      );

      expect(screen.getByText("Saving...")).toBeInTheDocument();
    });

    it("should show 'Saved' with checkmark when saved is true and saving is false", () => {
      render(
        <PersonasSection 
          {...defaultProps} 
          savedField="personas"
          saving={false}
          saved={true}
        />
      );

      expect(screen.getByText("Saved")).toBeInTheDocument();
      // Check icon should be present
      const checkIcon = document.querySelector(".text-green-600");
      expect(checkIcon).toBeInTheDocument();
    });

    it("should not show saving state when savedField is different", () => {
      render(
        <PersonasSection 
          {...defaultProps} 
          savedField="otherField"
          saving={true}
        />
      );

      expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    it("should not add duplicate personas", () => {
      const onChange = vi.fn();
      
      render(
        <PersonasSection 
          {...defaultProps} 
          personas={["Admin"]}
          onChange={onChange}
        />
      );

      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.change(input, { target: { value: "Admin" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // onChange should not be called because "Admin" already exists
      expect(onChange).not.toHaveBeenCalled();
    });

    it("should trim whitespace from input before validation", () => {
      const onChange = vi.fn();
      
      render(<PersonasSection {...defaultProps} onChange={onChange} />);

      const input = screen.getByPlaceholderText(/Add persona/i);
      fireEvent.change(input, { target: { value: "  Admin  " } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      expect(onChange).toHaveBeenCalledWith(["Admin"]);
    });

    it("should be case-sensitive when matching COMMON_PERSONAS", () => {
      const onChange = vi.fn();
      
      render(<PersonasSection {...defaultProps} onChange={onChange} />);

      const input = screen.getByPlaceholderText(/Add persona/i);
      // Try with lowercase
      fireEvent.change(input, { target: { value: "admin" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      // Should not add because case doesn't match
      expect(onChange).not.toHaveBeenCalled();
    });

    it("should handle empty personas array", () => {
      render(<PersonasSection {...defaultProps} personas={[]} />);

      expect(screen.getByPlaceholderText(/Add persona/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Add/i })).toBeInTheDocument();
    });
  });
});
