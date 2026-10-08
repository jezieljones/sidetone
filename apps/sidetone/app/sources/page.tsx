import { AppHeader } from "../components/AppHeader";
import { SourceSettingsRuntime } from "../components/SourceSettingsRuntime";
import { requireAdminUser } from "../lib/admin-access";

export const metadata = {
  title: "Sources · Sidetone",
  description: "Manage the places Sidetone can capture calls from."
};

export default async function SourcesPage() {
  await requireAdminUser("/sources");

  return (
    <>
      <AppHeader active="sources" />
      <div className="theme-dashboard min-h-screen">
        <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 pb-20 pt-6 md:px-6">
          <SourceSettingsRuntime />
        </main>
      </div>
    </>
  );
}
