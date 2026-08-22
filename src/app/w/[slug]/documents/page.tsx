import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import DocxEditorPage from "@/components/docx-editor/DocxEditorPage";

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ s3Key?: string; nodeId?: string; url?: string }>;
}) {
  const { slug } = await params;
  const { s3Key, nodeId, url } = await searchParams;
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!s3Key && !nodeId && !url) redirect(`/w/${slug}`);
  return <DocxEditorPage />;
}
