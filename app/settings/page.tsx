'use client';

import { useState, useEffect } from 'react';

interface Settings {
  ai_provider: 'gemini' | 'deepseek';
  gemini_api_key?: string;
  deepseek_api_key?: string;
  gemini_model: string;
  deepseek_model?: string;
}

/** Effective tuning the server resolved (DB override > env > code fallback). */
type Tuning = Record<string, Record<string, unknown>>;

interface SettingsResponse extends Settings {
  tuning?: Tuning;
  tuning_overrides?: Tuning;
}

// No model id is hardcoded here: the list comes from Scan Models, which queries
// the provider. Before the first scan the dropdown offers only the configured
// value, so nothing can silently select a retired model.

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: '20px',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: '600',
  color: 'var(--foreground-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '8px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  fontSize: '14px',
  fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--foreground)',
  fontSize: '13px',
  fontWeight: '500',
  cursor: 'pointer',
  transition: 'all 150ms ease-out',
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'var(--primary)',
  color: 'var(--surface)',
  border: '1px solid var(--primary)',
};

const hintStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--foreground-muted)',
  marginTop: '4px',
  lineHeight: 1.4,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: '600',
  color: 'var(--foreground)',
  marginBottom: '12px',
  paddingBottom: '8px',
  borderBottom: '1px solid var(--border)',
};

/** One editable tuning number. */
function NumberField({
  label, hint, value, step, min, max, onChange,
}: {
  label: string;
  hint?: string;
  value: unknown;
  step?: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="number"
        style={inputStyle}
        value={numeric}
        step={step ?? 1}
        min={min}
        max={max}
        onChange={e => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
      {hint && <p style={hintStyle}>{hint}</p>}
    </div>
  );
}

/** One editable tuning boolean (a select, so intent is explicit). */
function BoolField({
  label, hint, value, onChange,
}: {
  label: string;
  hint?: string;
  value: unknown;
  onChange: (v: boolean) => void;
}) {
  const b = value === true;
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <select
        style={selectStyle}
        value={b ? 'true' : 'false'}
        onChange={e => onChange(e.target.value === 'true')}
      >
        <option value="false">Disabled</option>
        <option value="true">Enabled</option>
      </select>
      {hint && <p style={hintStyle}>{hint}</p>}
    </div>
  );
}

/** One editable tuning text value (lists, URLs, models). */
function TextField({
  label, hint, value, placeholder, onChange,
}: {
  label: string;
  hint?: string;
  value: unknown;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="text"
        style={inputStyle}
        placeholder={placeholder}
        value={typeof value === 'string' ? value : ''}
        onChange={e => onChange(e.target.value)}
      />
      {hint && <p style={hintStyle}>{hint}</p>}
    </div>
  );
}

const buttonDisabledStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  opacity: 0.5,
  cursor: 'not-allowed',
};

const alertStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  fontSize: '13px',
  marginBottom: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const alertErrorStyle: React.CSSProperties = {
  ...alertStyle,
  background: 'var(--danger-soft)',
  borderColor: 'var(--danger)',
  color: 'var(--danger)',
};

const alertSuccessStyle: React.CSSProperties = {
  ...alertStyle,
  background: 'var(--success-soft)',
  borderColor: 'var(--success)',
  color: 'var(--success)',
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [availableModels, setAvailableModels] = useState<{ id: string; name: string }[]>([]);
  const [scanning, setScanning] = useState(false);
  const [dsQuota, setDsQuota] = useState<{ balance: string; currency: string; granted?: string; toppedUp?: string } | null>(null);
  const [dsModels, setDsModels] = useState<{ id: string; name: string }[]>([]);

  const [tuning, setTuning] = useState<Tuning | null>(null);

  const [formData, setFormData] = useState<Settings>({
    ai_provider: 'gemini',
    gemini_model: '',
  });

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) throw new Error('Failed to load settings');
        const data = await res.json() as SettingsResponse;
        setSettings(data);
        setFormData(prev => ({
          ...prev,
          ai_provider: data.ai_provider,
          gemini_model: data.gemini_model,
          deepseek_model: data.deepseek_model,
        }));
        setTuning(data.tuning ?? null);
        // Offer the configured model even before a scan, so the select is never
        // empty and a stale saved value is visible.
        if (data.gemini_model) {
          setAvailableModels([{ id: data.gemini_model, name: data.gemini_model }]);
        }
        if (data.deepseek_model) {
          setDsModels([{ id: data.deepseek_model, name: data.deepseek_model }]);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Load failed');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  /** Update one tuning leaf, e.g. path ['regions','overlap'] → 0.2 */
  const setTuningValue = (path: string[], value: unknown) => {
    setTuning(prev => {
      if (!prev) return prev;
      const next: Tuning = { ...prev };
      const [head, ...rest] = path;
      const group = { ...(next[head] ?? {}) } as Record<string, unknown>;
      let cursor = group;
      for (let i = 0; i < rest.length - 1; i++) {
        cursor[rest[i]] = { ...(cursor[rest[i]] as Record<string, unknown> ?? {}) };
        cursor = cursor[rest[i]] as Record<string, unknown>;
      }
      const leaf = rest[rest.length - 1];
      cursor[leaf] = value;
      next[head] = group;
      return next;
    });
  };

  const handleScan = async (provider: 'gemini' | 'deepseek') => {
    const key = provider === 'gemini' ? formData.gemini_api_key : formData.deepseek_api_key;
    if (!key) {
      setError(`Please enter an API key for ${provider} to scan models.`);
      return;
    }

    setScanning(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/settings/scan-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, api_key: key }),
      });
      const data = await res.json();

      if (!res.ok || !data.valid) {
        throw new Error(data.error || 'Failed to scan models');
      }

      if (provider === 'gemini') {
        setAvailableModels(data.models);
        setSuccess(`Successfully scanned ${data.models.length} Gemini models.`);
        if (data.models.length > 0 && !data.models.find((m: any) => m.id === formData.gemini_model)) {
          setFormData(prev => ({ ...prev, gemini_model: data.models[0].id }));
        }
      } else {
        setDsModels(data.models);
        if (data.models.length > 0 && !data.models.find((m: any) => m.id === formData.deepseek_model)) {
          setFormData(prev => ({ ...prev, deepseek_model: data.models[0].id }));
        }
        if (data.quota) {
          setDsQuota(data.quota);
          setSuccess(`DeepSeek: Balance ${data.quota.balance} ${data.quota.currency}, ${data.models.length} models available.`);
        } else {
          setSuccess(`Successfully scanned ${data.models.length} DeepSeek models.`);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      // Only include key fields if user typed something — empty = keep existing DB value
      const payload: Record<string, unknown> = {
        ai_provider: formData.ai_provider,
        gemini_model: formData.gemini_model,
        deepseek_model: formData.deepseek_model,
      };
      if (formData.gemini_api_key) payload.gemini_api_key = formData.gemini_api_key;
      if (formData.deepseek_api_key) payload.deepseek_api_key = formData.deepseek_api_key;
      // Send the whole effective tuning document. The server merges it into
      // settings.tuning, so saving one section never clears another.
      if (tuning) payload.tuning = tuning;

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Save failed');
      }

      const updated = await res.json() as SettingsResponse;
      setSettings(updated);
      // Re-sync from the server's resolved values so the UI shows what a job
      // will actually use, not what was typed.
      if (updated.tuning) setTuning(updated.tuning);
      setSuccess('Settings saved.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px' }}>
        <p style={{ color: 'var(--foreground-muted)' }}>Loading settings…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '800px' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--foreground)', marginBottom: '8px' }}>Settings</h1>
        <p style={{ fontSize: '14px', color: 'var(--foreground-muted)' }}>Manage AI provider and API keys</p>
      </div>

      {error && (
        <div style={alertErrorStyle}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '16px' }}>×</button>
        </div>
      )}

      {success && (
        <div style={alertSuccessStyle}>
          <span>{success}</span>
          <button onClick={() => setSuccess('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '16px' }}>×</button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {/* Provider Selection */}
        <div style={cardStyle}>
          <h2 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--foreground)', marginBottom: '16px' }}>AI Provider</h2>
          <div style={{ display: 'flex', gap: '12px' }}>
            {(['gemini', 'deepseek'] as const).map(provider => (
              <button
                key={provider}
                onClick={() => setFormData(f => ({ ...f, ai_provider: provider }))}
                style={{
                  ...buttonStyle,
                  flex: 1,
                  background: formData.ai_provider === provider ? 'var(--primary-soft)' : 'var(--surface)',
                  color: formData.ai_provider === provider ? 'var(--primary)' : 'var(--foreground)',
                  fontWeight: formData.ai_provider === provider ? '600' : '500',
                }}
              >
                {provider === 'gemini' ? 'Google Gemini' : 'DeepSeek'}
              </button>
            ))}
          </div>
        </div>

        {/* Gemini Configuration */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--foreground)' }}>Google Gemini</h2>
            <button
              onClick={() => handleScan('gemini')}
              disabled={scanning || !formData.gemini_api_key}
              style={scanning || !formData.gemini_api_key ? { ...buttonStyle, opacity: 0.5, cursor: 'not-allowed' } : buttonStyle}
            >
              {scanning ? 'Scanning…' : 'Scan Models'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={labelStyle}>API Key</label>
              <input
                type="password"
                placeholder="Enter Gemini API key"
                style={inputStyle}
                value={formData.gemini_api_key || ''}
                onChange={e => setFormData(f => ({ ...f, gemini_api_key: e.target.value }))}
              />
              <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '6px' }}>Stored securely server-side only</p>
            </div>

            <div>
              <label style={labelStyle}>Model</label>
              <select
                style={selectStyle}
                value={formData.gemini_model}
                onChange={e => setFormData(f => ({ ...f, gemini_model: e.target.value }))}
              >
                {availableModels.length === 0 && (
                  <option value="">Scan models to populate this list</option>
                )}
                {availableModels.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <p style={hintStyle}>
                Models are discovered from your API key, never hardcoded. If the
                configured model is deprecated it is skipped at runtime and the
                next available one is tried.
              </p>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', fontStyle: 'italic' }}>
              Note: Monitor quota via Google Cloud Console
            </p>
          </div>
        </div>

        {/* DeepSeek Configuration */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--foreground)' }}>DeepSeek</h2>
            <button
              onClick={() => handleScan('deepseek')}
              disabled={scanning || !formData.deepseek_api_key}
              style={scanning || !formData.deepseek_api_key ? { ...buttonStyle, opacity: 0.5, cursor: 'not-allowed' } : buttonStyle}
            >
              {scanning ? 'Scanning…' : 'Check Balance'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={labelStyle}>API Key</label>
              <input
                type="password"
                placeholder="Enter DeepSeek API key"
                style={inputStyle}
                value={formData.deepseek_api_key || ''}
                onChange={e => setFormData(f => ({ ...f, deepseek_api_key: e.target.value }))}
              />
              <p style={{ fontSize: '12px', color: 'var(--foreground-muted)', marginTop: '6px' }}>Stored securely server-side only</p>
            </div>

            <div>
              <label style={labelStyle}>Model</label>
              <select
                style={selectStyle}
                value={formData.deepseek_model || ''}
                onChange={e => setFormData(f => ({ ...f, deepseek_model: e.target.value }))}
              >
                {dsModels.length === 0 && (
                  <option value="">Check balance to populate this list</option>
                )}
                {dsModels.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <p style={hintStyle}>
                Text-only provider. Run Detection needs image understanding and
                refuses DeepSeek, exactly like Scan Legend does.
              </p>
            </div>

            {dsQuota && (
              <div style={{ ...cardStyle, background: 'var(--info-soft)', borderColor: 'var(--info)', padding: '16px', marginTop: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--info)' }}>Account Balance</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--info)' }}>{dsQuota.balance} {dsQuota.currency}</span>
                </div>

                {dsQuota.granted && dsQuota.toppedUp && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                        <span style={{ color: 'var(--success)' }}>Free Quota</span>
                        <span style={{ fontWeight: '600', color: 'var(--success)' }}>{dsQuota.granted}</span>
                      </div>
                      <div style={{ width: '100%', height: '4px', background: 'var(--background)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            background: 'var(--success)',
                            borderRadius: '2px',
                            width: `${Math.min(100, (parseFloat(dsQuota.granted) / (parseFloat(dsQuota.granted) + parseFloat(dsQuota.toppedUp))) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                        <span style={{ color: 'var(--accent)' }}>Top-up Balance</span>
                        <span style={{ fontWeight: '600', color: 'var(--accent)' }}>{dsQuota.toppedUp}</span>
                      </div>
                      <div style={{ width: '100%', height: '4px', background: 'var(--background)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            background: 'var(--accent)',
                            borderRadius: '2px',
                            width: `${Math.min(100, (parseFloat(dsQuota.toppedUp) / (parseFloat(dsQuota.granted) + parseFloat(dsQuota.toppedUp))) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Runtime tuning — resolution order: this form > .env > code fallback */}
        {tuning && (
          <>
            {/* Regions & performance */}
            <div style={cardStyle}>
              <h2 style={sectionTitleStyle}>Region Detection (tiled pages)</h2>
              <p style={{ ...hintStyle, marginBottom: '16px' }}>
                Gemini downscales large images, so a full page compresses small
                P&ID tags. Splitting a page into overlapping upscaled crops
                restores legibility — at the cost of one Gemini call per region.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px' }}>
                <div>
                  <label style={labelStyle}>Mode</label>
                  <select
                    style={selectStyle}
                    value={String(tuning.regions?.mode ?? 'regions')}
                    onChange={e => setTuningValue(['regions', 'mode'], e.target.value)}
                  >
                    <option value="regions">Regions (accurate, more calls)</option>
                    <option value="page">Single page (cheapest)</option>
                  </select>
                  <p style={hintStyle}>
                    Tiled = better on small tags. Single page = one call, but a
                    dense A3 sheet often misses 6pt tags.
                  </p>
                </div>
                <NumberField
                  label="Columns (0 = auto)"
                  hint="0 derives the grid from the page aspect ratio."
                  value={tuning.regions?.cols} min={0} max={8}
                  onChange={v => setTuningValue(['regions', 'cols'], v)}
                />
                <NumberField
                  label="Rows (0 = auto)"
                  value={tuning.regions?.rows} min={0} max={8}
                  onChange={v => setTuningValue(['regions', 'rows'], v)}
                />
                <NumberField
                  label="Region overlap"
                  hint="Fractional overlap, so a symbol on a border is not cut in half."
                  step={0.01} min={0} max={0.4}
                  value={tuning.regions?.overlap}
                  onChange={v => setTuningValue(['regions', 'overlap'], v)}
                />
                <NumberField
                  label="Min crop width (px)"
                  hint="Regions are upscaled to at least this width before sending."
                  value={tuning.regions?.cropMinWidth} min={100}
                  onChange={v => setTuningValue(['regions', 'cropMinWidth'], v)}
                />
                <NumberField
                  label="Max crop width (px)"
                  value={tuning.regions?.cropMaxWidth} min={200}
                  onChange={v => setTuningValue(['regions', 'cropMaxWidth'], v)}
                />
                <NumberField
                  label="Delay between regions (ms)"
                  hint="Keeps sequential calls under the per-minute request limit."
                  value={tuning.regions?.delayMs} min={0}
                  onChange={v => setTuningValue(['regions', 'delayMs'], v)}
                />
                <BoolField
                  label="Full-page catch-up pass"
                  hint="One extra call per page to catch symbols the grid split awkwardly."
                  value={tuning.regions?.catchup}
                  onChange={v => setTuningValue(['regions', 'catchup'], v)}
                />
                <NumberField
                  label="Region dedupe IoU"
                  hint="Same tag (or type when untagged) + IoU above this merges into one detection."
                  step={0.05} min={0} max={1}
                  value={tuning.regions?.dedupeIou}
                  onChange={v => setTuningValue(['regions', 'dedupeIou'], v)}
                />
                <NumberField
                  label="PDF render scale"
                  hint="3.0 ≈ 216 DPI. Each +1.0 roughly quadruples PNG size."
                  step={0.5} min={0.5} max={10}
                  value={tuning.detection?.renderScale}
                  onChange={v => setTuningValue(['detection', 'renderScale'], v)}
                />
              </div>
            </div>

            {/* Decision thresholds */}
            <div style={cardStyle}>
              <h2 style={sectionTitleStyle}>Detection Thresholds</h2>
              <p style={{ ...hintStyle, marginBottom: '16px' }}>
                Raise the review threshold to send more detections to a human;
                lower it to accept more automatically.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px' }}>
                <NumberField
                  label="Review threshold"
                  hint="Below this overall confidence a detection is flagged NEEDS_REVIEW."
                  step={0.01} min={0} max={1}
                  value={tuning.detection?.reviewThreshold}
                  onChange={v => setTuningValue(['detection', 'reviewThreshold'], v)}
                />
                <NumberField
                  label="Null-field threshold"
                  hint="Per-field confidence below this is stored as null."
                  step={0.01} min={0} max={1}
                  value={tuning.detection?.nullFieldConfidenceThreshold}
                  onChange={v => setTuningValue(['detection', 'nullFieldConfidenceThreshold'], v)}
                />
                <NumberField
                  label="Penalty: no tag"
                  step={0.01} min={0} max={1}
                  value={tuning.detection?.penaltyNoTag}
                  onChange={v => setTuningValue(['detection', 'penaltyNoTag'], v)}
                />
                <NumberField
                  label="Penalty: thin evidence"
                  step={0.01} min={0} max={1}
                  value={tuning.detection?.penaltyThinEvidence}
                  onChange={v => setTuningValue(['detection', 'penaltyThinEvidence'], v)}
                />
                <NumberField
                  label="Penalty: oversized bbox"
                  step={0.01} min={0} max={1}
                  value={tuning.detection?.penaltyBboxOversize}
                  onChange={v => setTuningValue(['detection', 'penaltyBboxOversize'], v)}
                />
                <NumberField
                  label="Bbox max, symbols (units)"
                  hint="0-1000 space. Larger boxes likely include pipe lines."
                  value={tuning.detection?.bboxMaxSymbolUnits} min={10}
                  onChange={v => setTuningValue(['detection', 'bboxMaxSymbolUnits'], v)}
                />
                <NumberField
                  label="Bbox max, large equipment (units)"
                  hint="Vessels, tanks and exchangers are legitimately bigger."
                  value={tuning.detection?.bboxMaxLargeEquipmentUnits} min={10}
                  onChange={v => setTuningValue(['detection', 'bboxMaxLargeEquipmentUnits'], v)}
                />
                <NumberField
                  label="NMS IoU threshold"
                  hint="Overlapping boxes with the same tag merge above this."
                  step={0.05} min={0} max={1}
                  value={tuning.detection?.nmsIouThreshold}
                  onChange={v => setTuningValue(['detection', 'nmsIouThreshold'], v)}
                />
              </div>
            </div>

            {/* Generation */}
            <div style={cardStyle}>
              <h2 style={sectionTitleStyle}>Generation Parameters</h2>
              <p style={{ ...hintStyle, marginBottom: '16px' }}>
                Temperature near 0 keeps extraction stable. Raising it trades
                consistency for variety, which is rarely wanted for P&amp;ID data.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px' }}>
                <NumberField
                  label="Detection temperature"
                  step={0.05} min={0} max={2}
                  value={(tuning.generation?.gemini as Record<string, unknown>)?.temperature}
                  onChange={v => setTuningValue(['generation', 'gemini', 'temperature'], v)}
                />
                <NumberField
                  label="Detection max output tokens"
                  hint="Dense P&amp;ID pages produce many detections; too low truncates the JSON."
                  value={(tuning.generation?.gemini as Record<string, unknown>)?.maxOutputTokens} min={256}
                  onChange={v => setTuningValue(['generation', 'gemini', 'maxOutputTokens'], v)}
                />
                <NumberField
                  label="Legend temperature"
                  step={0.05} min={0} max={2}
                  value={(tuning.generation?.legend as Record<string, unknown>)?.temperature}
                  onChange={v => setTuningValue(['generation', 'legend', 'temperature'], v)}
                />
                <NumberField
                  label="Legend max output tokens"
                  value={(tuning.generation?.legend as Record<string, unknown>)?.maxOutputTokens} min={256}
                  onChange={v => setTuningValue(['generation', 'legend', 'maxOutputTokens'], v)}
                />
              </div>
            </div>

            {/* Model selection & fallback */}
            <div style={cardStyle}>
              <h2 style={sectionTitleStyle}>Model Fallback</h2>
              <p style={{ ...hintStyle, marginBottom: '16px' }}>
                Used when the configured model is unavailable or returns a
                transient error. The first available model wins.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px' }}>
                <TextField
                  label="Preferred Gemini models"
                  hint="Comma-separated, highest preference first."
                  placeholder="gemini-3.6-flash, gemini-flash-lite-latest"
                  value={Array.isArray(tuning.model?.preferred) ? (tuning.model.preferred as string[]).join(', ') : ''}
                  onChange={v => setTuningValue(['model', 'preferred'], v.split(',').map(s => s.trim()).filter(Boolean))}
                />
                <TextField
                  label="JSON-incompatible models"
                  hint="Models that ignore responseMimeType=json. Skipped before any request."
                  placeholder="gemini-3.5-flash, gemini-3.5-flash-lite"
                  value={tuning.model?.jsonIncompatible instanceof Set
                    ? Array.from(tuning.model.jsonIncompatible as Set<string>).join(', ')
                    : Array.isArray(tuning.model?.jsonIncompatible) ? (tuning.model.jsonIncompatible as string[]).join(', ') : ''}
                  onChange={v => setTuningValue(['model', 'jsonIncompatible'], v.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))}
                />
                <TextField
                  label="Gemini API base URL"
                  hint="Override for a proxy or regional gateway."
                  value={tuning.model?.geminiBaseUrl}
                  onChange={v => setTuningValue(['model', 'geminiBaseUrl'], v)}
                />
                <TextField
                  label="DeepSeek API base URL"
                  value={tuning.model?.deepseekBaseUrl}
                  onChange={v => setTuningValue(['model', 'deepseekBaseUrl'], v)}
                />
                <NumberField
                  label="Retry attempts"
                  value={tuning.model?.retryMaxAttempts} min={1} max={10}
                  onChange={v => setTuningValue(['model', 'retryMaxAttempts'], v)}
                />
                <NumberField
                  label="Retry base delay (ms)"
                  value={tuning.model?.retryBaseDelayMs} min={0}
                  onChange={v => setTuningValue(['model', 'retryBaseDelayMs'], v)}
                />
                <NumberField
                  label="Model attempt delay (ms)"
                  hint="Pause before trying the next model after a provider error."
                  value={tuning.model?.modelAttemptDelayMs} min={0}
                  onChange={v => setTuningValue(['model', 'modelAttemptDelayMs'], v)}
                />
                <NumberField
                  label="Max model attempts per page"
                  hint="Caps the fallback chain so an all-503 run fails fast. 0 = try every candidate."
                  value={tuning.model?.maxModelAttempts} min={0} max={10}
                  onChange={v => setTuningValue(['model', 'maxModelAttempts'], v)}
                />
                <NumberField
                  label="Circuit breaker failures"
                  hint="Consecutive provider errors that trip a model's breaker. 0 = disabled."
                  value={tuning.model?.circuitFailures} min={0} max={20}
                  onChange={v => setTuningValue(['model', 'circuitFailures'], v)}
                />
                <NumberField
                  label="Circuit breaker cooldown (ms)"
                  hint="How long a tripped model is skipped before being retried."
                  value={tuning.model?.circuitCooldownMs} min={0}
                  onChange={v => setTuningValue(['model', 'circuitCooldownMs'], v)}
                />
                <NumberField
                  label="Requests per minute ceiling"
                  hint="Enforced across Scan Legend and Run Detection together. Free tier is 15; the 429s in a region sweep are almost always this being too low."
                  value={tuning.model?.requestsPerMinute} min={1} max={600}
                  onChange={v => setTuningValue(['model', 'requestsPerMinute'], v)}
                />
              </div>
            </div>

            {/* Worker runtime: BullMQ lock + concurrency */}
            <div style={cardStyle}>
              <h2 style={sectionTitleStyle}>Detection Worker (restart required)</h2>
              <p style={{ ...hintStyle, marginBottom: '16px' }}>
                Read once when the worker process starts, so a change here needs
                a worker restart. The lock duration must cover the slowest
                realistic job: with tiled regions one page is several requests,
                and each request may walk the whole fallback chain. The BullMQ
                30-second default expires mid-job and makes it re-run the job,
                which writes a second copy of every detection.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px' }}>
                <NumberField
                  label="Concurrency"
                  hint="Jobs run at once. 1 keeps request rate low enough for the free tier."
                  value={tuning.performance?.workerConcurrency} min={1} max={16}
                  onChange={v => setTuningValue(['performance', 'workerConcurrency'], v)}
                />
                <NumberField
                  label="Lock duration (ms)"
                  hint="Must exceed the slowest job. BullMQ default is 30000, which is too short."
                  value={tuning.performance?.workerLockDurationMs} min={30000}
                  onChange={v => setTuningValue(['performance', 'workerLockDurationMs'], v)}
                />
                <NumberField
                  label="Lock renew time (ms)"
                  hint="How often the lock is renewed. Must stay below the lock duration."
                  value={tuning.performance?.workerLockRenewTimeMs} min={1000}
                  onChange={v => setTuningValue(['performance', 'workerLockRenewTimeMs'], v)}
                />
                <NumberField
                  label="Stalled check interval (ms)"
                  value={tuning.performance?.workerStalledIntervalMs} min={1000}
                  onChange={v => setTuningValue(['performance', 'workerStalledIntervalMs'], v)}
                />
                <NumberField
                  label="Max stalled count"
                  hint="How many times a stalled job is retried before it is failed."
                  value={tuning.performance?.workerMaxStalledCount} min={0} max={5}
                  onChange={v => setTuningValue(['performance', 'workerMaxStalledCount'], v)}
                />
              </div>
            </div>

            {/* Per-detection enrichment */}
            <div style={cardStyle}>
              <h2 style={sectionTitleStyle}>Optional Enrichment (off by default)</h2>
              <p style={{ ...hintStyle, marginBottom: '16px' }}>
                Each option adds an extra Gemini request <em>per detection</em>.
                On a 19-symbol page that is 38 extra requests on top of the page
                call, which exhausts the free tier and pushes a page past the
                120s budget. Detection quality does not depend on them — enable
                only with quota headroom.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px' }}>
                <BoolField
                  label="Symbol feature extraction"
                  hint="Describes each symbol crop (shape, connections) via an extra call."
                  value={(tuning.detection?.symbolFeatures as Record<string, unknown>)?.extract}
                  onChange={v => setTuningValue(['detection', 'symbolFeatures', 'extract'], v)}
                />
                <BoolField
                  label="Symbol embedding"
                  hint="Requires feature extraction, and EMBEDDING_DIMENSIONS must match your vector column."
                  value={(tuning.detection?.symbolFeatures as Record<string, unknown>)?.embed}
                  onChange={v => setTuningValue(['detection', 'symbolFeatures', 'embed'], v)}
                />
              </div>
            </div>
          </>
        )}

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving}
          style={saving ? buttonDisabledStyle : { ...primaryButtonStyle, width: '100%' }}
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
