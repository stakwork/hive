import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RECURSION_MAX_CONCURRENT_KEY } from "@/services/legal-recursion-cron";
import { LegalRecursionConfigPanel } from "./LegalRecursionConfigPanel";

const RECURSION_MAX_CONCURRENT_DEFAULT = 3;

export default async function LegalRecursionPage() {
  const record = await db.platformConfig.findUnique({
    where: { key: RECURSION_MAX_CONCURRENT_KEY },
  });

  const initialValue = record ? parseInt(record.value, 10) : RECURSION_MAX_CONCURRENT_DEFAULT;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Legal Benchmark Recursion</CardTitle>
          <CardDescription>
            Configure the concurrency cap for the automated legal benchmark recursion janitor
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LegalRecursionConfigPanel initialValue={initialValue} />
        </CardContent>
      </Card>
    </div>
  );
}
