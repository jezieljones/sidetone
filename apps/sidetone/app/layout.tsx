import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { OfflineBanner } from "./components/OfflineBanner";
import { Providers } from "./providers";

export const dynamic = "force-dynamic";

const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
const title = "Sidetone | Take the call. Sidetone takes the notes.";
const description =
  "Self-hosted conversation notes, searchable transcripts, and editable documents.";




export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  applicationName: "Sidetone",
  title,
  description,
  alternates: {
    canonical: "/"
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Sidetone",
    title,
    description,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Sidetone phone-call companion for live context and after-call records."
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/twitter-image"]
  },
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
  robots: {
    index: false,
    follow: false
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0A192F"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <Providers>
          <OfflineBanner />
          {children}
        </Providers>
      </body>
    </html>
  );
}
