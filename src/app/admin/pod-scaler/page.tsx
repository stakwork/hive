import { db } from "@/lib/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  POD_SCALER_CONFIG_KEYS,
  POD_SCALER_QUEUE_WAIT_MINUTES,
  POD_SCALER_STALENESS_WINDOW_DAYS,
  POD_SCALER_SCALE_UP_BUFFER,
  POD_SCALER_MAX_VM_CEILING,
  POD_SCALER_SCALE_DOWN_COOLDOWN_MINUTES,
  POD_SCALER_CRON_ENABLED_DEFAULT,
  POD_SCALER_UTILISATION_THRESHOLD,
} from "@/lib/constants/pod-scaler";
import { PodScalerConfigPanel } from "./PodScalerConfigPanel";

export default async function PodScalerPage() {
  const configs = await db.platformConfig.findMany({
    where: { key: { in: Object.values(POD_SCALER_CONFIG_KEYS) } },
  });

  const getValue = (key: keyof typeof POD_SCALER_CONFIG_KEYS, defaultVal: number) => {
    const record = configs.find((c) => c.key === POD_SCALER_CONFIG_KEYS[key]);
    return record ? parseInt(record.value, 10) : defaultVal;
  };

  const initialValues = {
    queueWaitMinutes: getValue("queueWaitMinutes", POD_SCALER_QUEUE_WAIT_MINUTES),
    stalenessWindowDays: getValue("stalenessWindowDays", POD_SCALER_STALENESS_WINDOW_DAYS),
    scaleUpBuffer: getValue("scaleUpBuffer", POD_SCALER_SCALE_UP_BUFFER),
    maxVmCeiling: getValue("maxVmCeiling", POD_SCALER_MAX_VM_CEILING),
    scaleDownCooldownMinutes: getValue("scaleDownCooldownMinutes", POD_SCALER_SCALE_DOWN_COOLDOWN_MINUTES),
    cronEnabled: getValue("cronEnabled", POD_SCALER_CRON_ENABLED_DEFAULT ? 1 : 0),
    podUtilisationThreshold: getValue("podUtilisationThreshold", POD_SCALER_UTILISATION_THRESHOLD),
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pod Scaler</CardTitle>
          <CardDescription>
            Configure thresholds and limits for the automated pod scaler
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PodScalerConfigPanel initialValues={initialValues} />
        </CardContent>
      </Card>
    </div>
  );
}
