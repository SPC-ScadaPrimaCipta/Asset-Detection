'use client';

import { useState, useEffect } from 'react';

export default function DocumentsPage() {
  const [files, setFiles] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetch('/api/documents').then(r => r.json()).then(setFiles);
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', e.target.files[0]);
    formData.append('project_id', '00000000-0000-0000-0000-000000000000'); // Temp

    await fetch('/api/documents', { method: 'POST', body: formData });
    setUploading(false);
    fetch('/api/documents').then(r => r.json()).then(setFiles);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Documents</h1>
      <input type="file" onChange={handleUpload} disabled={uploading} className="p-2 border rounded" />
      <div className="border rounded-lg bg-white">
        {files.map(f => (
          <div key={f.id} className="p-3 border-b">{f.filename} ({f.page_count} pages)</div>
        ))}
      </div>
    </div>
  );
}