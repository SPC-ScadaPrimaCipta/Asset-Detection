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
            borderRight: "1px solid rgba(255,255,255,0.06)",
            background:
              "linear-gradient(180deg, #001E38 0%, #002B4E 55%, #003B63 100%)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Brand */}
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src="/lg.png"
              alt="Asset Detection"
              style={{
                width: "100%",
                maxWidth: "180px",
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
