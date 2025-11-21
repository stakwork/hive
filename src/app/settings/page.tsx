import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DisconnectAccount } from "@/components/DisconnectAccount";
import { ThemeSettings } from "@/components/ThemeSettings";
import { Github } from "lucide-react";
import { BackButton } from "@/components/BackButton";

export default async function UserSettingsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/");
  }

  const userId = (session.user as { id?: string })?.id;
  if (!userId) {
    redirect("/");
  }

  const user = {
    name: session?.user?.name,
    email: session?.user?.email,
    image: session?.user?.image,
    github: (
      session?.user as {
        github?: {
          username?: string;
          publicRepos?: number;
          followers?: number;
        };
      }
    )?.github,
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex items-center gap-4">
            <BackButton />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">User Settings</h1>
            <p className="text-muted-foreground mt-2">Manage your personal preferences and connected accounts.</p>
          </div>

          <ThemeSettings />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Github className="w-5 h-5" />
                Connected Accounts
              </CardTitle>
              <CardDescription>Manage your connected third-party accounts</CardDescription>
            </CardHeader>
            <CardContent>
              <DisconnectAccount user={user} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
