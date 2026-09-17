'use client';

import { useState, useEffect } from 'react';

interface Settings {
  ai_provider: 'gemini' | 'deepseek';
  gemini_api_key?: string;
  deepseek_api_key?: string;
  gemini_model: string;
}

const DEFAULT_GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
];

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
  const [dsQuota, setDsQuota] = useState<{ balance: string, currency: string } | null>(null);
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
        setFormData(data);
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
        setSuccess(`Successfully scanned ${data.models.length} Gemini models!`);
        // if current model isn't in list, select first available
        if (data.models.length > 0 && !data.models.find((m: any) => m.id === formData.gemini_model)) {
          setFormData(prev => ({ ...prev, gemini_model: data.models[0].id }));
        }
      } else {
        setDsModels(data.models);
        if (data.quota) {
           setDsQuota(data.quota);
           setSuccess(`Successfully scanned DeepSeek models. Balance: ${data.quota.balance} ${data.quota.currency}`);
        } else {
           setSuccess(`Successfully scanned ${data.models.length} DeepSeek models!`);
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
      if (!formData.gemini_api_key && !formData.deepseek_api_key) {
        throw new Error('At least one API key required');
      }

      if (formData.ai_provider === 'gemini' && !formData.gemini_api_key) {
        throw new Error('Gemini API key required for Gemini provider');
      }

      if (formData.ai_provider === 'deepseek' && !formData.deepseek_api_key) {
        throw new Error('DeepSeek API key required for DeepSeek provider');
      }

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Save failed');
      }

      const updated = await res.json() as Settings;
      setSettings(updated);
      setSuccess('Settings saved successfully');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-zinc-400">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Settings</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage AI providers and API keys</p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError('')}
            className="text-red-400 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400 flex items-center justify-between">
          <span>{success}</span>
          <button
            onClick={() => setSuccess('')}
            className="text-emerald-400 hover:text-emerald-600"
          >
            ✕
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 space-y-6">
        {/* AI Provider Selection */}
        <div>
          <label className="block mb-3">
            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">AI Provider</span>
            <p className="text-xs text-zinc-500 mt-0.5">Select which AI service to use for detection</p>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {(['gemini', 'deepseek'] as const).map(provider => (
              <button
                key={provider}
                onClick={() => setFormData(f => ({ ...f, ai_provider: provider }))}
                className={`px-4 py-3 rounded-lg border-2 transition-colors text-sm font-medium ${
                  formData.ai_provider === provider
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                    : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                }`}
              >
                {provider.charAt(0).toUpperCase() + provider.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Gemini Settings */}
        <div className="space-y-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Google Gemini</h3>
            <button
              onClick={() => handleScan('gemini')}
              disabled={scanning || !formData.gemini_api_key}
              className="px-2.5 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              {scanning ? 'Scanning...' : 'Scan Models'}
            </button>
          </div>

          <div>
            <label className="block">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Gemini Model</span>
              <select
                value={formData.gemini_model}
                onChange={e => setFormData(f => ({ ...f, gemini_model: e.target.value }))}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {availableModels.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <label className="block">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">API Key</span>
              <input
                type="password"
                value={formData.gemini_api_key || ''}
                onChange={e => setFormData(f => ({ ...f, gemini_api_key: e.target.value }))}
                placeholder="sk-..."
                className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-zinc-400 mt-1">Your Gemini API key is stored securely server-side</p>
            </label>
          </div>
        </div>

        {/* DeepSeek Settings */}
        <div className="space-y-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">DeepSeek</h3>
            <button
              onClick={() => handleScan('deepseek')}
              disabled={scanning || !formData.deepseek_api_key}
              className="px-2.5 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              {scanning ? 'Scanning...' : 'Check Balance & Models'}
            </button>
          </div>

          <div>
            <label className="block">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">API Key</span>
              <input
                type="password"
                value={formData.deepseek_api_key || ''}
                onChange={e => setFormData(f => ({ ...f, deepseek_api_key: e.target.value }))}
                placeholder="sk-..."
                className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-zinc-400 mt-1">Your DeepSeek API key is stored securely server-side</p>
            </label>
          </div>

          {dsQuota && (
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3">
              <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Account Balance</p>
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mt-1">
                {dsQuota.balance} {dsQuota.currency}
              </p>
            </div>
          )}

          {dsModels.length > 0 && (
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Available Models ({dsModels.length})</p>
              <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                {dsModels.map(model => (
                  <div key={model.id} className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 truncate">
                    {model.name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Save Button */}
        <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
