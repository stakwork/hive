import { db } from "@/lib/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PromoteSuperadminForm, RevokeSuperadminButton } from "./components";

export default async function AdminUsersPage() {
  // Fetch all superadmin users
  const superadmins = await db.user.findMany({
    where: { role: "SUPER_ADMIN" },
    select: {
      id: true,
      name: true,
      email: true,
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">User Management</h2>
        <p className="text-muted-foreground">
          Manage superadmin privileges for platform users
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Promote User to Superadmin</CardTitle>
          <CardDescription>
            Enter the email address of an existing Hive user to grant them
            superadmin access
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PromoteSuperadminForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current Superadmins</CardTitle>
          <CardDescription>
            Users with platform-wide administrative access
          </CardDescription>
        </CardHeader>
        <CardContent>
          {superadmins.length === 0 ? (
            <p className="text-muted-foreground">No superadmins found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {superadmins.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.name || "—"}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <RevokeSuperadminButton
                        userId={user.id}
                        userName={user.name}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
