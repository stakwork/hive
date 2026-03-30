import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/lib/db";
import LlmModelsTable from "./LlmModelsTable";

export default async function LlmModelsPage() {
  const models = await db.llmModel.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>LLM Models</CardTitle>
          <CardDescription>Manage LLM provider pricing</CardDescription>
        </CardHeader>
        <CardContent>
          <LlmModelsTable initialData={models} />
        </CardContent>
      </Card>
    </div>
  );
}
