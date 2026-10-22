import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SidebarNav from "./sidebar-nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Asset Detection",
  description: "Automatic P&ID Asset Detection",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      style={{ height: "100%" }}
      suppressHydrationWarning
    >
      <body
        style={{
          display: "flex",
          height: "100%",
          margin: 0,
          padding: 0,
          background: "var(--background)",
          color: "var(--foreground)",
          fontFamily:
            'var(--font-geist-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
        }}
      >
        <aside
          style={{
            width: "var(--sidebar-width)",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            background:
              "linear-gradient(180deg, #121D26 0%, #182832 58%, #14212A 100%)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Brand */}
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src="/spc.png"
              alt="Asset Detection"
              style={{
                width: "100%",
                maxWidth: "160px",
                height: "auto",
                objectFit: "contain",
              }}
            />
          </div>

          {/* Navigation */}
          <SidebarNav />
        </aside>

        <main
          style={{
            flex: 1,
            overflowY: "auto",
            background: "var(--background)",
          }}
        >
          <div style={{ padding: "32px" }}>{children}</div>
        </main>
      </body>
    </html>
  );
}
