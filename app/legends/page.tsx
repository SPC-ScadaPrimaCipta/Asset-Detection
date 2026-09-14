'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Legend {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

export default function LegendsPage() {
  const [legends, setLegends] = useState<Legend[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/legends').then(r => r.json()).then(data => { setLegends(data); setLoading(false); });
  }, []);

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Legend Library</h1>
        <Link href="/legends/new" className="px-4 py-2 bg-blue-600 text-white rounded-lg">New Legend</Link>
      </div>
      <div className="border rounded-lg bg-white dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-100 dark:bg-zinc-800">
            <tr>
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Description</th>
              <th className="text-left p-3">Created</th>
              <th className="text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {legends.map(l => (
              <tr key={l.id} className="border-t">
                <td className="p-3 font-medium">{l.name}</td>
                <td className="p-3 text-zinc-600 dark:text-zinc-400">{l.description}</td>
                <td className="p-3 text-zinc-600 dark:text-zinc-400">{new Date(l.created_at).toLocaleDateString()}</td>
                <td className="p-3 text-right">
                  <Link href={`/legends/${l.id}`} className="text-blue-600 hover:underline">Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}