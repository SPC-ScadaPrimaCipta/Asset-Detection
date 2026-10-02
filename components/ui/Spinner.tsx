export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const px = size === 'sm' ? 16 : size === 'lg' ? 32 : 20;
  return (
    <svg width={px} height={px} style={{ color: 'var(--foreground-muted)', animation: 'spin 1s linear infinite' }} fill="none" viewBox="0 0 24 24" aria-hidden>
      <circle opacity={0.25} cx={12} cy={12} r={10} stroke="currentColor" strokeWidth={4} />
      <path opacity={0.75} fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}
