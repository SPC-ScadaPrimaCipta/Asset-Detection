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
      style={{ height: "100%" }}
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
          minHeight: "100%",
          margin: 0,
          padding: 0,
          background: "var(--bg-page)",
          color: "var(--foreground)",
          fontFamily:
            'var(--font-plus-jakarta, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
          display: "flex",
          justifyContent: "center",
          alignItems: "stretch",
          boxSizing: "border-box",
        }}
      >
        <ThemeProvider>
          {/* Outer Frame Wrapper matching 1440px desktop reference */}
          <div
            style={{
              width: "100%",
              maxWidth: 1440,
              minHeight: "100vh",
              padding: "16px",
              display: "flex",
              boxSizing: "border-box",
            }}
          >
            {/* Dashboard App Frame Container */}
            <div
              style={{
                width: "100%",
                background: "var(--bg-app)",
                borderRadius: "var(--radius-frame, 28px)",
                boxShadow: "var(--shadow-frame)",
                display: "flex",
                overflow: "hidden",
                border: "1px solid var(--border)",
                minHeight: "calc(100vh - 32px)",
              }}
            >
              {/* Rounded Royal Blue Sidebar */}
              <aside
                style={{
                  width: "var(--sidebar-width, 240px)",
                  display: "flex",
                  flexDirection: "column",
                  flexShrink: 0,
                  background: "var(--sidebar-bg)",
                  borderRadius: "var(--radius-sidebar, 24px)",
                  margin: "12px 0 12px 12px",
                  overflow: "hidden",
                  boxShadow: "0 8px 30px rgba(0, 0, 0, 0.15)",
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
                  overflowY: "auto",
                  padding: "24px 28px",
                  minWidth: 0,
                }}
              >
                {/* Neuro Top Header */}
                <Header operatorName="Operator" />

                {/* Main Content Body */}
                <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
              </main>
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
