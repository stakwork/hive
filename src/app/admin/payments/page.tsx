import { db } from "@/lib/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { PaymentsConfigPanel } from "./PaymentsConfigPanel";

export default async function PaymentsPage() {
  const configs = await db.platformConfig.findMany({
    where: { key: { in: ["hiveAmountUsd", "graphmindsetAmountUsd"] } },
  });

  const hive = parseFloat(
    configs.find((c) => c.key === "hiveAmountUsd")?.value ?? "50"
  );
  const graphmindset = parseFloat(
    configs.find((c) => c.key === "graphmindsetAmountUsd")?.value ?? "50"
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
          <CardDescription>
            Configure onboarding prices for each product
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PaymentsConfigPanel
            initialHive={hive}
            initialGraphmindset={graphmindset}
          />
        </CardContent>
      </Card>
    </div>
  );
}
