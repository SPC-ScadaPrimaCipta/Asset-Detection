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
          {/* Full-width App Frame Container */}
          <div
            style={{
              width: "100%",
              minHeight: "100vh",
              display: "flex",
              background: "var(--bg-app)",
              boxSizing: "border-box",
            }}
          >
            {/* Full-height Docked Royal Blue Sidebar */}
            <aside
              style={{
                width: "var(--sidebar-width, 240px)",
                display: "flex",
                flexDirection: "column",
                flexShrink: 0,
                background: "var(--sidebar-bg)",
                height: "100vh",
                position: "sticky",
                top: 0,
                overflowY: "auto",
                boxShadow: "2px 0 16px rgba(0, 0, 0, 0.08)",
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
                minHeight: "100vh",
                overflowY: "auto",
                padding: "24px 32px",
                minWidth: 0,
                background: "var(--bg-app)",
                boxSizing: "border-box",
              }}
            >
              {/* Neuro Top Header */}
              <Header operatorName="Operator" />

              {/* Main Content Body */}
              <div style={{ flex: 1, minWidth: 0, width: "100%" }}>{children}</div>
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
