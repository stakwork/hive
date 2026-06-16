/** Serialized Automation as returned by the org automations API. */
export interface AutomationDTO {
  id: string;
  name: string;
  prompt: string;
  /** 24-hour "HH:MM" wall-clock time, interpreted in `timezone`. */
  timeOfDay: string;
  timezone: string;
  enabled: boolean;
  /** Human label, e.g. "Daily at 4:00 AM". */
  schedule: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
}

export interface CreateAutomationRequest {
  name: string;
  prompt: string;
  timeOfDay: string;
  timezone?: string;
}

export interface UpdateAutomationRequest {
  name?: string;
  prompt?: string;
  timeOfDay?: string;
  timezone?: string;
  enabled?: boolean;
}
