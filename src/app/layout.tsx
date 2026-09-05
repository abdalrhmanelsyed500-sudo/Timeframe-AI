import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Timeframe AI — automated documentary production",
    template: "%s · Timeframe AI",
  },
  description:
    "Turn a voiceover and a transcript into a finished, rendered documentary: story analysis, a visual bible, generated imagery, a deterministic timeline and a validated MP4.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#08090c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink-950 text-ink-100 antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-amber-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink-950"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
