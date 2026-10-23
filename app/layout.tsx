import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import SidebarNav from "./sidebar-nav";
import Header from "@/components/Header";
import { ThemeProvider } from "@/components/ThemeProvider";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Neuro. — Automatic Asset Detection",
  description: "AI-Powered Industrial P&ID Asset & Symbol Detection Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={plusJakartaSans.variable}
      style={{ height: "100%", width: "100%" }}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('neuro-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`,
          }}
        />
      </head>
      <body
        style={{
          minHeight: "100vh",
          width: "100%",
          margin: 0,
          padding: 0,
          background: "var(--bg-app)",
          color: "var(--foreground)",
          fontFamily:
            'var(--font-plus-jakarta, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
          boxSizing: "border-box",
        }}
      >
        <ThemeProvider>
          {/* Full-width App Container with Outer Padding for Floating Sidebar */}
          <div
            style={{
              width: "100%",
              minHeight: "100vh",
              display: "flex",
              background: "var(--bg-app)",
              boxSizing: "border-box",
              padding: "16px",
              gap: "20px",
            }}
          >
            {/* Floating Rounded Royal Blue Sidebar - Completely isolated from edges */}
            <aside
              style={{
                width: "var(--sidebar-width, 240px)",
                display: "flex",
                flexDirection: "column",
                flexShrink: 0,
                background: "var(--sidebar-bg)",
                height: "calc(100vh - 32px)",
                position: "sticky",
                top: "16px",
                borderRadius: "var(--radius-sidebar, 24px)",
                overflow: "hidden",
                boxShadow: "0 12px 36px rgba(0, 0, 0, 0.22)",
                border: "1px solid var(--border)",
                zIndex: 20,
              }}
            >
              <SidebarNav />
            </aside>

            {/* Main Content Area with Header */}
            <main
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minHeight: "calc(100vh - 32px)",
                overflowY: "auto",
                padding: "8px 12px 16px 0",
                minWidth: 0,
                background: "transparent",
                boxSizing: "border-box",
              }}
            >
              {/* Neuro Top Header */}
              <Header operatorName="Operator" />

              {/* Main Content Body - Full Width */}
              <div style={{ flex: 1, minWidth: 0, width: "100%" }}>{children}</div>
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
