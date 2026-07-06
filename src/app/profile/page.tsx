import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ActivityFeed } from "./_components/ActivityFeed";
import { BackButton } from "./_components/BackButton";
import { ActivityRecapCard } from "@/components/daily-recap/ActivityRecapCard";

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/");
  }

  const name = session.user.name ?? "User";
  const image = session.user.image;

  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="mb-6">
          <BackButton />
        </div>
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          {image ? (
            <Image
              src={image}
              alt={name}
              width={48}
              height={48}
              className="rounded-full"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-sm font-semibold">
              {initials}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold">{name}</h1>
            <p className="text-sm text-muted-foreground">My Activity</p>
          </div>
        </div>

        <ActivityRecapCard />
        <div className="mt-2">
          <Link
            href="/settings"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Manage Activity Recap in Settings →
          </Link>
        </div>
        <ActivityFeed userId={session.user.id as string} />
      </div>
    </div>
  );
}
