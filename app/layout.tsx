import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import SidebarNav from "./sidebar-nav";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Neuro. — Asset Detection",
  description: "Automatic Industrial P&ID Asset Detection",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={plusJakartaSans.variable}
      style={{ height: "100%" }}
      suppressHydrationWarning
    >
      <body
        style={{
          display: "flex",
          height: "100%",
          margin: 0,
          padding: 0,
          background: "var(--bg-page)",
          color: "var(--foreground)",
          fontFamily:
            'var(--font-plus-jakarta, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
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
              src="/ptm.png"
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
