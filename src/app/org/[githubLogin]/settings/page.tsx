import { Suspense } from "react";
import { OrgSettingsShell } from "../_components/OrgSettingsShell";

interface SettingsPageProps {
  params: Promise<{ githubLogin: string }>;
}

export default async function OrgSettingsPage({ params }: SettingsPageProps) {
  const { githubLogin } = await params;
  return (
    <Suspense>
      <OrgSettingsShell githubLogin={githubLogin} />
    </Suspense>
  );
}
