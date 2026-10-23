import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import SidebarNav from "./sidebar-nav";
import { ThemeProvider } from "@/components/ThemeProvider";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Neuro. — Asset Detection",
  description: "Automatic Industrial P&ID Asset Detection",
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
        <ThemeProvider>
          <aside
            style={{
              width: "var(--sidebar-width)",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              borderRight: "1px solid var(--border)",
              background: "var(--sidebar-bg)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Brand */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
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
        </ThemeProvider>
      </body>
    </html>
  );
}
