"use client";

import { useState, useCallback, useEffect, useRef } from "react";

interface UseAutoSaveParams<T> {
  data: T | null;
  onSave: (updates: Partial<T>) => Promise<void>;
}

export function useAutoSave<T extends Record<string, unknown>>({ data, onSave }: UseAutoSaveParams<T>) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [originalData, setOriginalData] = useState<T | null>(data);

  // Track the resource ID to detect navigation to different resources
  const currentIdRef = useRef<string | null>(null);

  // Reset baseline when navigating to a different resource (by ID)
  useEffect(() => {
    if (data) {
      const dataId = (data as T & { id?: string }).id;

      // If we have an ID and it's different from current, or if we don't have an ID yet
      if (dataId !== currentIdRef.current) {
        currentIdRef.current = dataId || null;
        setOriginalData(data);
      }
    }
  }, [data]);

  const handleFieldBlur = useCallback(
    async (field: string, value: unknown) => {
      const originalValue = originalData?.[field];

      if (data && originalValue !== value) {
        setSavedField(field);
        setSaving(true);

        try {
          await onSave({ [field]: value } as Partial<T>);

          // Update baseline for this field
          setOriginalData((prev) => (prev ? { ...prev, [field]: value } : prev));

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
    [data, originalData, onSave],
  );

  // Manual baseline reset for full data updates (e.g., after server response)
  const updateOriginalData = useCallback((newData: T) => {
    setOriginalData(newData);
  }, []);

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
