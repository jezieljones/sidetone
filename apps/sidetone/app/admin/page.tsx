import { AppHeader } from "../components/AppHeader";
import { AdminUsersRuntime } from "../components/AdminUsersRuntime";
import { requireAdminUser } from "../lib/admin-access";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdminUser("/admin");

  return (
    <div className="min-h-screen bg-background">
      <AppHeader active="admin" />
      <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-20 pt-6 md:px-6">
        <section className="enamel-panel grid gap-4 p-6 md:p-8">
          <div className="enamel-badge w-fit">Admin</div>
          <div className="grid gap-3">
            <h1 className="roster-display text-5xl leading-none md:text-7xl">Sidetone users.</h1>
            <p className="max-w-3xl text-lg leading-8 text-muted-foreground">
              See new Clerk signups and whether they have initialized Sidetone.
            </p>
          </div>
        </section>

        <AdminUsersRuntime />
      </main>
    </div>
  );
}
