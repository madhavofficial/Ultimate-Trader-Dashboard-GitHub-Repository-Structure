import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Smart Market Watch — Checkpoint Delta Intelligence",
  description: "Understand what meaningfully changed in your watchlist since you last checked, and what deserves your attention now.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background text-on-surface antialiased min-h-screen selection:bg-primary-container selection:text-on-primary-container">
        {children}
      </body>
    </html>
  );
}
