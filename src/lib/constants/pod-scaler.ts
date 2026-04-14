export const POD_SCALER_QUEUE_WAIT_MINUTES = 5;
export const POD_SCALER_STALENESS_WINDOW_DAYS = 30;
export const POD_SCALER_SCALE_UP_BUFFER = 2;
export const POD_SCALER_MAX_VM_CEILING = 20;
export const POD_SCALER_SCALE_DOWN_COOLDOWN_MINUTES = 30;
export const POD_SCALER_CRON_ENABLED_DEFAULT = true;

export const POD_SCALER_CONFIG_KEYS = {
  queueWaitMinutes: "podScalerQueueWaitMinutes",
  stalenessWindowDays: "podScalerStalenessWindowDays",
  scaleUpBuffer: "podScalerScaleUpBuffer",
  maxVmCeiling: "podScalerMaxVmCeiling",
  scaleDownCooldownMinutes: "podScalerScaleDownCooldownMinutes",
  cronEnabled: "podScalerCronEnabled",
} as const;
