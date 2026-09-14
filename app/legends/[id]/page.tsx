'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface Legend {
  id: string;
  name: string;
  description: string;
}

interface Symbol {
  id: string;
  asset_type: string;
  tag_pattern: string;
  description: string;
}

export default function LegendDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [legend, setLegend] = useState<Legend | null>(null);
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ asset_type: '', tag_pattern: '', description: '' });

  useEffect(() => {
    fetch(`/api/legends/${params.id}`).then(r => r.json()).then(setLegend);
    fetch(`/api/legends/${params.id}/symbols`).then(r => r.json()).then(setSymbols);
  }, [params.id]);

  const handleAddSymbol = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`/api/legends/${params.id}/symbols`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    if (res.ok) {
      setSymbols([...symbols, { id: crypto.randomUUID(), ...formData }]);
      setFormData({ asset_type: '', tag_pattern: '', description: '' });
      setShowForm(false);
    }
  };

  if (!legend) return <div className="p-8">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{legend.name}</h1>
        <button onClick={() => router.push('/legends')} className="px-4 py-2 border rounded-lg">Back</button>
      </div>
      <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border">
        <h2 className="font-semibold mb-4">Symbols</h2>
        {showForm && (
          <form onSubmit={handleAddSymbol} className="mb-4 p-4 border rounded bg-zinc-50 dark:bg-zinc-800 space-y-3">
            <input placeholder="Asset Type" value={formData.asset_type} onChange={e => setFormData({...formData, asset_type: e.target.value})} className="w-full p-2 border rounded" required />
            <input placeholder="Tag Pattern (e.g. P-###)" value={formData.tag_pattern} onChange={e => setFormData({...formData, tag_pattern: e.target.value})} className="w-full p-2 border rounded" />
            <textarea placeholder="Description" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full p-2 border rounded" rows={2} />
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg">Add</button>
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
            </div>
          </form>
        )}
        <button onClick={() => setShowForm(true)} className="px-4 py-2 border border-dashed rounded-lg w-full mb-4">+ Add Symbol</button>
        <table className="w-full text-sm">
          <thead className="bg-zinc-100 dark:bg-zinc-800">
            <tr>
              <th className="text-left p-2">Asset Type</th>
              <th className="text-left p-2">Tag Pattern</th>
              <th className="text-left p-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {symbols.map(s => (
              <tr key={s.id} className="border-t">
                <td className="p-2 font-medium">{s.asset_type}</td>
                <td className="p-2 text-zinc-600 dark:text-zinc-400">{s.tag_pattern}</td>
                <td className="p-2 text-zinc-600 dark:text-zinc-400">{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}