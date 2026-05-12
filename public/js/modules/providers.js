/**
 * Flowboard AI — Provider Settings Module
 */
const Providers = (() => {
  const PROVIDER_TYPES = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'google', label: 'Google / Gemini' },
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'mimo', label: 'Mimo (Xiaomi)' },
    { value: 'ollama', label: 'Ollama (local)' },
    { value: 'lmstudio', label: 'LM Studio (local)' },
    { value: 'custom', label: 'Custom OpenAI-compatible' }
  ];

  const DEFAULT_URLS = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta',
    deepseek: 'https://api.deepseek.com',
    mimo: 'https://token-plan-sgp.xiaomimimo.com/v1',
    ollama: 'http://localhost:11434/v1',
    lmstudio: 'http://localhost:1234/v1',
    custom: ''
  };

  const PRESETS = [
    {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek V4 Pro',
      type: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-pro',
      models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
      icon: '<i data-lucide="brain" style="width:16px;height:16px"></i>',
      color: '#4f8ef7',
      desc: 'DeepSeek V4 Pro — 1M context, 384K output, deep thinking, tool calls',
      maxTokens: 16384
    },
    {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      type: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      icon: '<i data-lucide="zap" style="width:16px;height:16px"></i>',
      color: '#38bdf8',
      desc: 'DeepSeek V4 Flash — 1M context, 384K output, fast & cheap ($0.14/1M in)',
      maxTokens: 16384
    },
    {
      id: 'mimo-pro',
      name: 'Mimo Pro (Xiaomi)',
      type: 'mimo',
      baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
      defaultModel: 'mimo-v2.5-pro',
      models: ['mimo-v2.5-pro', 'mimo-v2-pro'],
      icon: '<i data-lucide="smartphone" style="width:16px;height:16px"></i>',
      color: '#ff6900',
      desc: 'Xiaomi MiMo Pro — 1M context, 128K output, function call, deep thinking',
      maxTokens: 16384
    },
    {
      id: 'mimo-omni',
      name: 'Mimo Omni (Xiaomi)',
      type: 'mimo',
      baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
      defaultModel: 'mimo-v2.5',
      models: ['mimo-v2.5', 'mimo-v2-omni'],
      icon: '<i data-lucide="zap" style="width:16px;height:16px"></i>',
      color: '#f97316',
      desc: 'Xiaomi MiMo Omni — full-modal understanding, 1M context',
      maxTokens: 16384
    }
  ];

  function renderSettings(containerEl, providers, callbacks) {
    containerEl.innerHTML = `
      <div class="settings-page">
        <div class="settings-header-row">
          <h1>AI Providers</h1>
          <button class="btn btn-primary" id="addProviderBtn">+ Add Provider</button>
        </div>
        <p class="settings-subtitle">Configure AI providers for chat and task execution. API keys are stored securely on the server.</p>

        <div class="settings-section">
          <h3>Quick Add — Presets</h3>
          <p class="settings-subtitle" style="margin-bottom:12px">One-click setup. You'll only need to enter your API key.</p>
          <div class="preset-grid">
            ${PRESETS.map(pr => `
              <button class="preset-card" data-preset="${pr.id}" title="${esc(pr.desc)}">
                <div class="preset-card-info">
                  <div class="preset-card-name">${esc(pr.name)}</div>
                  <div class="preset-card-desc">${esc(pr.desc)}</div>
                </div>
                <svg class="preset-arrow" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="providers-list" id="providersList">
          ${providers.length === 0 ? '<div class="empty-state-sm"><p>No providers configured yet.</p></div>' : providers.map(p => renderProviderCard(p)).join('')}
        </div>

        <div class="settings-section" style="margin-top:24px">
          <h3>Security Architecture</h3>
          <div class="security-info">
            <div class="security-row"><span class="security-icon"><i data-lucide="lock" style="width:14px;height:14px"></i></span><span>API keys are stored server-side in <code>.providers.json</code></span></div>
            <div class="security-row"><span class="security-icon"><i data-lucide="shield-check" style="width:14px;height:14px"></i></span><span>Frontend never receives raw API keys — only masked references</span></div>
            <div class="security-row"><span class="security-icon"><i data-lucide="shield" style="width:14px;height:14px"></i></span><span>All AI calls are proxied through <code>/api/ai/chat</code></span></div>
            <div class="security-row"><span class="security-icon"><i data-lucide="radio" style="width:14px;height:14px"></i></span><span>Provider credentials never leave the server process</span></div>
          </div>
        </div>
      </div>`;

    containerEl.querySelector('#addProviderBtn')?.addEventListener('click', () => openProviderModal(null, callbacks));
    containerEl.querySelectorAll('.preset-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = PRESETS.find(p => p.id === btn.dataset.preset);
        if (preset) openProviderModal({
          name: preset.name,
          type: preset.type,
          baseUrl: preset.baseUrl,
          defaultModel: preset.defaultModel,
          models: preset.models,
          defaultTemp: 0.7,
          maxTokens: preset.maxTokens || 16384,
          timeout: 60000,
          streaming: true,
          _isPreset: true
        }, callbacks);
      });
    });
    containerEl.querySelectorAll('.prov-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = providers.find(x => x.id === btn.dataset.id);
        if (p) openProviderModal(p, callbacks);
      });
    });
    containerEl.querySelectorAll('.prov-test-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.textContent = 'Testing...';
        btn.disabled = true;
        const result = await apiPost(`/api/providers/${btn.dataset.id}/test`, {});
        btn.textContent = result.status === 'connected' ? 'Connected' : 'Failed';
        btn.className = 'btn btn-sm ' + (result.status === 'connected' ? 'btn-success' : 'btn-danger');
        setTimeout(() => callbacks.onRefresh?.(), 1500);
      });
    });
    containerEl.querySelectorAll('.prov-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Delete this provider?')) {
          await apiDelete(`/api/providers/${btn.dataset.id}`);
          callbacks.onRefresh?.();
        }
      });
    });
  }

  function renderProviderCard(p) {
    const statusDot = p.connectionStatus === 'connected' ? 'status-connected' : (p.connectionStatus === 'error' ? 'status-error' : 'status-unknown');
    return `<div class="provider-card">
      <div class="provider-card-header">
        <div class="provider-card-left">
          <span class="provider-status-dot ${statusDot}"></span>
          <strong>${esc(p.name)}</strong>
          <span class="provider-type-badge">${esc(p.type || 'custom')}</span>
        </div>
        <div class="provider-card-right">
          <button class="btn btn-sm btn-secondary prov-test-btn" data-id="${p.id}">Test</button>
          <button class="btn btn-sm btn-secondary prov-edit-btn" data-id="${p.id}">Edit</button>
          <button class="btn btn-sm btn-danger prov-delete-btn" data-id="${p.id}">×</button>
        </div>
      </div>
      <div class="provider-card-body">
        <div class="prov-detail"><span>URL:</span> ${esc(p.baseUrl || '—')}</div>
        <div class="prov-detail"><span>Key:</span> ${esc(p.apiKey || '—')}</div>
        <div class="prov-detail"><span>Model:</span> ${esc(p.defaultModel || '—')}</div>
        <div class="prov-detail"><span>Streaming:</span> ${p.streaming !== false ? 'Yes' : 'No'}</div>
      </div>
    </div>`;
  }

  function openProviderModal(existing, callbacks) {
    const isPreset = existing?._isPreset;
    const isEdit = !!existing && !isPreset;
    const modal = document.getElementById('providerModal');
    modal.querySelector('#provModalTitle').textContent = isEdit ? 'Edit Provider' : (isPreset ? `Add ${existing.name}` : 'Add Provider');
    modal.querySelector('#provModalSave').textContent = isEdit ? 'Save' : 'Add';

    const f = modal.querySelector('#providerForm');
    f.querySelector('#provName').value = existing?.name || '';
    f.querySelector('#provType').value = existing?.type || 'openai';
    f.querySelector('#provUrl').value = existing?.baseUrl || DEFAULT_URLS['openai'];
    f.querySelector('#provApiKey').value = '';
    f.querySelector('#provApiKey').placeholder = isEdit ? 'Leave blank to keep current' : 'Enter your API key...';
    f.querySelector('#provModel').value = existing?.defaultModel || '';
    f.querySelector('#provModels').value = (existing?.models || []).join(', ');
    f.querySelector('#provTemp').value = existing?.defaultTemp ?? 0.7;
    f.querySelector('#provMaxTokens').value = existing?.maxTokens || 2048;
    f.querySelector('#provTimeout').value = existing?.timeout || 30000;
    f.querySelector('#provStreaming').checked = existing?.streaming !== false;
    f.querySelector('#provHeaders').value = existing?.customHeaders ? JSON.stringify(existing.customHeaders) : '';

    // Auto-fill URL on type change
    f.querySelector('#provType').addEventListener('change', e => {
      const url = DEFAULT_URLS[e.target.value] || '';
      if (url) f.querySelector('#provUrl').value = url;
    });

    modal.classList.add('active');

    modal.querySelector('#provModalSave').onclick = async () => {
      const data = {
        name: f.querySelector('#provName').value.trim(),
        type: f.querySelector('#provType').value,
        baseUrl: f.querySelector('#provUrl').value.trim(),
        defaultModel: f.querySelector('#provModel').value.trim(),
        models: f.querySelector('#provModels').value.split(',').map(s => s.trim()).filter(Boolean),
        defaultTemp: parseFloat(f.querySelector('#provTemp').value) || 0.7,
        maxTokens: parseInt(f.querySelector('#provMaxTokens').value) || 2048,
        timeout: parseInt(f.querySelector('#provTimeout').value) || 30000,
        streaming: f.querySelector('#provStreaming').checked,
        customHeaders: (() => { try { return JSON.parse(f.querySelector('#provHeaders').value || '{}'); } catch { return {}; } })(),
        enabled: true,
        connectionStatus: 'unknown'
      };
      const key = f.querySelector('#provApiKey').value.trim();
      if (key) data.apiKey = key;

      if (!data.name) return;

      if (isEdit) {
        await apiPut(`/api/providers/${existing.id}`, data);
      } else {
        await apiPost('/api/providers', data);
      }
      modal.classList.remove('active');
      callbacks.onRefresh?.();
    };
  }

  return { renderSettings, PROVIDER_TYPES };
})();
