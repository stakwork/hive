import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import SwarmsTable from "./SwarmsTable";

export default function SwarmsPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Swarms</CardTitle>
            <CardDescription>
              EC2 instances tagged Swarm=superadmin
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <SwarmsTable />
        </CardContent>
      </Card>
    </div>
  );
}
