import React from 'react';
import Link from 'next/link';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex h-full bg-zinc-50 dark:bg-black">
        <aside className="w-64 border-r border-zinc-200 dark:border-zinc-800 p-4">
          <nav className="flex flex-col gap-2">
            <Link href="/" className="px-3 py-2 font-semibold">Dashboard</Link>
            <Link href="/legends" className="px-3 py-2 font-semibold">Legends</Link>
            <Link href="/documents" className="px-3 py-2 font-semibold">Documents</Link>
            <Link href="/projects" className="px-3 py-2 font-semibold">Projects</Link>
          </nav>
        </aside>
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </body>
    </html>
  );
}
