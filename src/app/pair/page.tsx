import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/nextauth";
import { PairDevice } from "./_components/PairDevice";

/**
 * `/pair?code=BCDF-GHJK` — where a person approves a strut device (the link
 * and QR the desktop app shows; `lib/strut-devices.ts`). Public in the
 * middleware so a signed-out visitor reaches this check and is sent to
 * sign-in with the code kept.
 */
export default async function PairPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const session = await getServerSession(authOptions);
  if (!(session?.user as { id?: string } | undefined)?.id) {
    const back = code ? `/pair?code=${encodeURIComponent(code)}` : "/pair";
    redirect(`/auth/signin?redirect=${encodeURIComponent(back)}`);
  }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-16 max-w-lg">
        <PairDevice initialCode={code ?? ""} />
      </div>
    </div>
  );
}
