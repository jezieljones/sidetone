import { AppHeader } from "./components/AppHeader";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";

export default function NotFound() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex min-h-[calc(100vh-96px)] w-full max-w-4xl items-center px-4 py-10 md:px-6">
        <Card className="w-full">
          <CardHeader className="gap-4 p-6 md:p-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
              Sidetone
            </p>
            <CardTitle className="max-w-2xl text-4xl font-semibold md:text-5xl">
              This page is not available.
            </CardTitle>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              The link may have changed, or this call record may not be ready yet.
            </p>
          </CardHeader>
          <CardContent className="px-6 pb-6 md:px-8 md:pb-8">
            <Button asChild>
              <a href="/">Back home</a>
            </Button>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
