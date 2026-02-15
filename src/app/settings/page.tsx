import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DisconnectAccount } from "@/components/DisconnectAccount";
import { ThemeSettings } from "@/components/ThemeSettings";
import { SphinxLink } from "@/components/SphinxLink";
import { Github, Zap } from "lucide-react";
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


  const sessionUser = session.user as {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    github?: {
      username?: string;
      publicRepos?: number;
      followers?: number;
    };
    lightningPubkey?: string | null;
  };

  const user = {
    name: sessionUser.name,
    email: sessionUser.email,
    image: sessionUser.image,
    github: sessionUser.github,
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
            <p className="text-muted-foreground mt-2">
              Manage your personal preferences and connected accounts.
            </p>
          </div>
          
          <ThemeSettings />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Github className="w-5 h-5" />
                Connected Accounts
              </CardTitle>
              <CardDescription>
                Manage your connected third-party accounts
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DisconnectAccount user={user} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5" />
                Sphinx Wallet
              </CardTitle>
              <CardDescription>
                Link your Sphinx Lightning identity to your Hive account
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SphinxLink linkedPubkey={sessionUser.lightningPubkey} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}