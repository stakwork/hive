import { OrgSchematic } from "../OrgSchematic";

interface SchematicPageProps {
  params: Promise<{ githubLogin: string }>;
}

export default async function SchematicPage({ params }: SchematicPageProps) {
  const { githubLogin } = await params;
  return (
    <div className="flex-1 flex flex-col min-h-0 h-full">
      <OrgSchematic githubLogin={githubLogin} />
    </div>
  );
}
