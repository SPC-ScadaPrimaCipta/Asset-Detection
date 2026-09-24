'use client';

import { useState, useEffect } from 'react';

interface Settings {
  ai_provider: 'gemini' | 'deepseek';
  gemini_api_key?: string;
  deepseek_api_key?: string;
  gemini_model: string;
  deepseek_model?: string;
}

const DEFAULT_GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
];

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

  const [availableModels, setAvailableModels] = useState<{ id: string; name: string }[]>(
    DEFAULT_GEMINI_MODELS.map(m => ({ id: m, name: m }))
  );
  const [scanning, setScanning] = useState(false);
  const [dsQuota, setDsQuota] = useState<{ balance: string; currency: string; granted?: string; toppedUp?: string } | null>(null);
  const [dsModels, setDsModels] = useState<{ id: string; name: string }[]>([]);

  const [formData, setFormData] = useState<Settings>({
    ai_provider: 'gemini',
    gemini_model: 'gemini-2.0-flash',
  });

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) throw new Error('Failed to load settings');
        const data = await res.json() as Settings;
        setSettings(data);
        setFormData(prev => ({
          ...prev,
          ai_provider: data.ai_provider,
          gemini_model: data.gemini_model,
          deepseek_model: data.deepseek_model || 'deepseek-chat',
        }));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Load failed');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

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
      const payload: Record<string, string | undefined> = {
        ai_provider: formData.ai_provider,
        gemini_model: formData.gemini_model,
        deepseek_model: formData.deepseek_model,
      };
      if (formData.gemini_api_key) payload.gemini_api_key = formData.gemini_api_key;
      if (formData.deepseek_api_key) payload.deepseek_api_key = formData.deepseek_api_key;

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Save failed');
      }

      const updated = await res.json() as Settings;
      setSettings(updated);
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
                {availableModels.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
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
                value={formData.deepseek_model || 'deepseek-chat'}
                onChange={e => setFormData(f => ({ ...f, deepseek_model: e.target.value }))}
              >
                <option value="deepseek-chat">deepseek-chat</option>
                {dsModels.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
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
