import { LearnChat } from "./components/LearnChat";
import { StoreProvider } from "@/stores/StoreProvider";

interface LearnPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export default async function LearnPage({ params }: LearnPageProps) {
  const { slug } = await params;

  return (
    <div className="flex-1 flex flex-col h-full">
      <StoreProvider storeId={`workspace-${slug}`}>
        <LearnChat workspaceSlug={slug} />
      </StoreProvider>
    </div>
  );
}
