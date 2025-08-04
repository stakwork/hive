import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/DashboardLayout";

export default async function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/");
  }

  const user = {
    name: session.user?.name,
    email: session.user?.email,
    image: session.user?.image,
    github: (
      session.user as {
        github?: {
          username?: string;
          publicRepos?: number;
          followers?: number;
        };
      }
    )?.github,
  };

  return <DashboardLayout user={user}>{children}</DashboardLayout>;
}
