"use client";

import { FriendlyErrorFallback } from "./components/FriendlyErrorFallback";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <FriendlyErrorFallback error={error} reset={reset} />
      </body>
    </html>
  );
}
