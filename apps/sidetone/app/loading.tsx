import { Card, CardContent, CardHeader } from "./components/ui/card";

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-5 md:px-6 md:py-6">
      <Card>
        <CardHeader className="gap-4 p-6 md:p-8">
          <div className="h-7 w-32 animate-pulse rounded-md border border-primary/40 bg-muted" />
          <div className="h-12 w-full max-w-xl animate-pulse rounded-md border border-primary/30 bg-muted" />
          <div className="h-5 w-full max-w-lg animate-pulse rounded-md border border-primary/20 bg-muted" />
        </CardHeader>
        <CardContent className="grid gap-3 px-6 pb-6 md:px-8 md:pb-8">
          <div className="h-24 animate-pulse border-t border-border bg-muted/40" />
          <div className="h-16 animate-pulse border-t border-border bg-muted/30" />
        </CardContent>
      </Card>
    </main>
  );
}
