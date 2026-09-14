'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewLegendPage() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/legends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });
    if (res.ok) router.push('/legends');
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">New Legend</h1>
      <form onSubmit={handleSubmit} className="space-y-4 bg-white dark:bg-zinc-900 p-6 rounded-lg border">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} className="w-full p-2 border rounded" required />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} className="w-full p-2 border rounded" rows={3} />
        </div>
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg">Save</button>
      </form>
    </div>
  );
}