"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const updateStatus = () => setOffline(!window.navigator.onLine);
    updateStatus();
    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
  }, []);

  if (!offline) {
    return null;
  }

  return (
    <div className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-xl items-center justify-center gap-2 rounded-md border border-warning/70 bg-[#122742]/95 px-4 py-3 text-sm font-medium text-foreground shadow-electric">
      <WifiOff className="size-4 text-warning" />
      Sidetone will reconnect when your internet returns.
    </div>
  );
}
