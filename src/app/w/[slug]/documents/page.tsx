import { canAccessServerFeature, FEATURE_FLAGS } from "@/lib/feature-flags";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import DocxEditorPage from "@/components/docx-editor/DocxEditorPage";

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!canAccessServerFeature(FEATURE_FLAGS.AI_DOC_EDITOR)) {
    redirect(`/w/${slug}`);
  }
  return <DocxEditorPage />;
}
