export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav style={{ padding: '1rem', borderBottom: '1px solid #ccc' }}>
        <a href="/" style={{ marginRight: '1rem' }}>Home</a>
        <a href="/risk-analysis/risk-mapping">Risk Mapping</a>
      </nav>
      <main>{children}</main>
    </div>
  );
}
