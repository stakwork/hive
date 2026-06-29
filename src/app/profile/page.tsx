import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { redirect } from "next/navigation";
import Image from "next/image";
import { ActivityFeed } from "./_components/ActivityFeed";
import { BackButton } from "./_components/BackButton";
import { TimezoneSettings } from "./_components/TimezoneSettings";
import { VoiceLearningSettings } from "./_components/VoiceLearningSettings";
import { DailyRecapCard } from "@/components/daily-recap/DailyRecapCard";

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

        <div className="mb-8">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Preferences</h2>
          <TimezoneSettings />
          <VoiceLearningSettings />
        </div>

        <DailyRecapCard />
        <ActivityFeed userId={session.user.id as string} />
      </div>
    </div>
  );
}
