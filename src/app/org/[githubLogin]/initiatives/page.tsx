import { redirect } from "next/navigation";
import { orgRedirectTarget } from "@/lib/helpers/org-redirects";

interface PageProps {
  params: Promise<{ githubLogin: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Folded into another page; old links land there. */
export default async function Page({ params, searchParams }: PageProps) {
  const { githubLogin } = await params;
  redirect(orgRedirectTarget("initiatives", githubLogin, await searchParams));
}
