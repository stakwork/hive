"use client";

import { useState, useRef, useCallback } from "react";

interface UseAutoSaveParams<T> {
  data: T | null;
  onSave: (updates: Partial<T>) => Promise<void>;
}

export function useAutoSave<T extends Record<string, unknown>>({ data, onSave }: UseAutoSaveParams<T>) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedField, setSavedField] = useState<string | null>(null);
  const originalDataRef = useRef<T | null>(data);

  // Update original data when data changes externally
  const updateOriginalData = useCallback((newData: T) => {
    originalDataRef.current = newData;
  }, []);

  const handleFieldBlur = useCallback(
    async (field: string, value: unknown) => {
      const originalValue = originalDataRef.current?.[field];

      if (data && originalValue !== value) {
        setSavedField(field);
        setSaving(true);

        try {
          await onSave({ [field]: value } as Partial<T>);

          // Show "Saved" indicator
          setSaved(true);
          setTimeout(() => {
            setSaved(false);
            setSavedField(null);
          }, 2000);
        } catch (error) {
          console.error(`Failed to save ${field}:`, error);
        } finally {
          setSaving(false);
        }
      }
    },
    [data, onSave]
  );

  // Trigger saved state manually for non-field saves (like status/assignee)
  const triggerSaved = useCallback((field: string) => {
    setSavedField(field);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      setSavedField(null);
    }, 2000);
  }, []);

  return {
    saving,
    saved,
    savedField,
    handleFieldBlur,
    updateOriginalData,
    triggerSaved,
  };
}
