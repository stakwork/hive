import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LegalRecursionConfigPanel } from "./LegalRecursionConfigPanel";

export default async function LegalRecursionPage() {
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
          <LegalRecursionConfigPanel />
        </CardContent>
      </Card>
    </div>
  );
}
