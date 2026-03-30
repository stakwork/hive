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
        <CardHeader>
          <CardTitle>Swarms</CardTitle>
          <CardDescription>
            EC2 instances tagged Swarm=superadmin
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SwarmsTable />
        </CardContent>
      </Card>
    </div>
  );
}
