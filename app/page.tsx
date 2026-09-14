export default function Home() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Asset Detection — Risk Mapping</h1>
      <p>Clone of Risk Mapping module from promia-web-sb</p>

      <section style={{ marginTop: '2rem' }}>
        <h2>Navigation</h2>
        <ul>
          <li>
            <a href="/risk-analysis/risk-mapping">Risk Mapping (List)</a>
          </li>
          <li>
            <a href="/api/risk-mapping/pfd">API Test: /api/risk-mapping/pfd</a>
          </li>
          <li>
            <a href="/api/risk-mapping/jobs">API Test: /api/risk-mapping/jobs</a>
          </li>
        </ul>
      </section>

      <section style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
        <h2>Status</h2>
        <p>Phase 2: Integration scaffolding complete</p>
        <p>Phase 3: Verification in progress</p>

        <h3>Checklist</h3>
        <ul>
          <li>☐ Database adapters implemented</li>
          <li>☐ Auth adapters configured</li>
          <li>☐ Storage adapters implemented</li>
          <li>☐ Database migration runs</li>
          <li>☐ API endpoints callable</li>
          <li>☐ Frontend pages load</li>
          <li>☐ Worker process starts</li>
          <li>☐ Upload → job → worker → complete</li>
          <li>☐ No regressions in promia-web-sb</li>
        </ul>
      </section>

      <section style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#fff3cd', borderRadius: '8px' }}>
        <h3>⚠️ Next Steps</h3>
        <ol>
          <li>Configure adapters in <code>risk-mapping/lib/adapters/</code></li>
          <li>Copy/link auth from your NextAuth setup</li>
          <li>Implement storage operations</li>
          <li>Run <code>npm run db:migrate</code></li>
          <li>Test endpoints</li>
          <li>Start background worker</li>
        </ol>
      </section>
    </main>
  );
}
