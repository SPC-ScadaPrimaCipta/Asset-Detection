import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-full font-sans" style={{ background: 'var(--hmi-bg)', color: 'var(--hmi-text-primary)' }}>
        {/* ── Sidebar ── */}
        <aside className="w-56 shrink-0 flex flex-col" style={{
          background: '#0b1526',
          borderRight: '1px solid #1e293b',
        }}>
          {/* Brand */}
          <div className="px-4 py-4" style={{ borderBottom: '1px solid #1e293b' }}>
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #3b82f6 100%)' }}>
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-bold tracking-widest uppercase" style={{ color: '#38bdf8' }}>Asset</p>
                <p className="text-xs font-semibold tracking-wider uppercase" style={{ color: '#475569', marginTop: '-2px' }}>Detection</p>
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex flex-col gap-0.5 p-2 flex-1">
            <style>{`
              .hmi-nav-link {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 14px;
                color: #64748b;
                text-decoration: none;
                transition: background 0.15s, color 0.15s;
              }
              .hmi-nav-link:hover {
                background: #1e293b;
                color: #f1f5f9;
              }
            `}</style>
            {[
              { href: '/',         label: 'Dashboard',     icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
              { href: '/projects', label: 'Projects',      icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
              { href: '/detection',label: 'Detection',     icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
              { href: '/review',   label: 'Review',        icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
              { href: '/documents',label: 'Documents',     icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
              { href: '/legends',  label: 'Legends',       icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
              { href: '/assets',   label: 'Asset Register',icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
            ].map(({ href, label, icon }) => (
              <Link key={href} href={href} className="hmi-nav-link">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                </svg>
                {label}
              </Link>
            ))}
          </nav>

          {/* Footer */}
          <div className="px-4 py-3" style={{ borderTop: '1px solid #1e293b' }}>
            <p className="text-xs" style={{ color: '#334155' }}>v0.1.0 — MVP</p>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-y-auto p-6" style={{ background: 'var(--hmi-bg)' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
