"use client";

import { FriendlyErrorFallback } from "./components/FriendlyErrorFallback";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <FriendlyErrorFallback error={error} reset={reset} />;
}
