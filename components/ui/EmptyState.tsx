import React from 'react';

export function EmptyState({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
      {icon && <div className="mb-4 opacity-40">{icon}</div>}
      <p className="text-sm font-medium text-zinc-500">{title}</p>
      {subtitle && <p className="text-xs mt-1">{subtitle}</p>}
    </div>
  );
}
