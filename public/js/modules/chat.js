/**
 * Flowboard AI — Chat Module
 * AI Chat panel with threads, markdown, streaming, tabs
 */
const Chat = (() => {
  let currentThreadId = null;
  let isStreaming = false;
  let activeTab = 'answer';
  let selectedModelValue = ''; // persist model selection across re-renders

  function render(project, panelEl, providers, callbacks) {
    if (!project) return;
    const thread = currentThreadId ? project.chatThreads.find(t => t.id === currentThreadId) : null;
    if (!thread) {
      if (project.chatThreads.length === 0) {
        const t = createChatThread('General');
        project.chatThreads.push(t);
      }
      currentThreadId = project.chatThreads[0].id;
    }

    const ct = project.chatThreads.find(t => t.id === currentThreadId);
    const provList = providers || [];

    panelEl.innerHTML = `
      <div class="chat-header">
        <div class="chat-header-left">
          <h3>AI Chat</h3>
          <select class="chat-thread-select" id="chatThreadSelect">
            ${project.chatThreads.map(t => `<option value="${t.id}" ${t.id === currentThreadId ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}
          </select>
          <button class="btn-icon chat-new-thread" id="chatNewThread" title="New thread">+</button>
        </div>
        <div class="chat-header-right">
          <select class="chat-model-select" id="chatModelSelect">
            <option value="">Select model...</option>
            ${provList.filter(p => p.enabled !== false).map(p => {
              const models = (p.models && p.models.length) ? p.models : [p.defaultModel || 'default'];
              return models.map(m => `<option value="${p.id}::${m}" ${selectedModelValue === p.id+'::'+m ? 'selected' : ''}>${esc(p.name)} / ${esc(m)}</option>`).join('');
            }).join('')}
          </select>
        </div>
      </div>
      <div class="chat-tabs">
        <button class="chat-tab ${activeTab === 'answer' ? 'active' : ''}" data-tab="answer">Answer</button>
        <button class="chat-tab ${activeTab === 'sources' ? 'active' : ''}" data-tab="sources">Sources</button>
        <button class="chat-tab ${activeTab === 'logs' ? 'active' : ''}" data-tab="logs">Logs</button>
        <button class="chat-tab ${activeTab === 'artifacts' ? 'active' : ''}" data-tab="artifacts">Artifacts</button>
      </div>
      <div class="chat-messages" id="chatMessages">
        ${renderMessages(ct)}
        ${isStreaming ? '<div class="chat-msg msg-ai"><div class="msg-avatar"><i data-lucide="bot" style="width:14px;height:14px"></i></div><div class="msg-content"><div class="msg-text chat-loading"><span class="dot-pulse"></span> Thinking...</div></div></div>' : ''}
      </div>
      <div class="chat-input-area">
        <div class="chat-suggestions" id="chatSuggestions">
          <button class="suggestion-btn" data-action="generate-subtasks">Generate subtasks</button>
          <button class="suggestion-btn" data-action="run-selected">Run selected tasks</button>
          <button class="suggestion-btn" data-action="summarize">Summarize project</button>
        </div>
        <div class="chat-input-row">
          <textarea class="chat-input" id="chatInput" placeholder="Ask AI anything..." rows="1" ${isStreaming ? 'disabled' : ''}></textarea>
          <button class="chat-send-btn" id="chatSendBtn" title="Send" ${isStreaming ? 'disabled' : ''}>
            ${isStreaming ? '<span class="dot-pulse"></span>' : '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>'}
          </button>
        </div>
      </div>`;

    // Persist model selection on change
    panelEl.querySelector('#chatModelSelect')?.addEventListener('change', e => {
      selectedModelValue = e.target.value;
    });

    // Events
    panelEl.querySelector('#chatThreadSelect')?.addEventListener('change', e => {
      currentThreadId = e.target.value;
      render(project, panelEl, providers, callbacks);
    });
    panelEl.querySelector('#chatNewThread')?.addEventListener('click', () => {
      const t = createChatThread('Chat ' + (project.chatThreads.length + 1));
      project.chatThreads.push(t);
      currentThreadId = t.id;
      render(project, panelEl, providers, callbacks);
      callbacks.onSave?.();
    });
    panelEl.querySelectorAll('.chat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.tab;
        panelEl.querySelectorAll('.chat-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));
      });
    });

    const input = panelEl.querySelector('#chatInput');
    const sendBtn = panelEl.querySelector('#chatSendBtn');

    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(project, panelEl, providers, callbacks); }
    });
    input?.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
    sendBtn?.addEventListener('click', () => sendMessage(project, panelEl, providers, callbacks));

    panelEl.querySelectorAll('.suggestion-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'generate-subtasks') callbacks.onSuggestion?.('Generate subtasks for the current project tasks');
        else if (action === 'run-selected') callbacks.onRunSelected?.();
        else if (action === 'summarize') callbacks.onSuggestion?.('Summarize the current project status');
      });
    });

    scrollToBottom(panelEl);
    Icons.render(panelEl);
  }

  function renderMessages(thread) {
    if (!thread || !thread.messages.length) {
      return `<div class="chat-empty">
        <div class="chat-empty-icon"><i data-lucide="bot" style="width:32px;height:32px"></i></div>
        <p>Start a conversation with AI</p>
        <p class="chat-empty-sub">Ask questions, generate tasks, or run automations</p>
      </div>`;
    }
    return thread.messages.map(msg => {
      const isUser = msg.role === 'user';
      return `<div class="chat-msg ${isUser ? 'msg-user' : 'msg-ai'}">
        <div class="msg-avatar">${isUser ? '<i data-lucide="user" style="width:14px;height:14px"></i>' : '<i data-lucide="bot" style="width:14px;height:14px"></i>'}</div>
        <div class="msg-content">
          <div class="msg-text">${isUser ? esc(msg.content) : renderMarkdown(msg.content)}</div>
          <div class="msg-meta">${relativeTime(msg.ts)}</div>
        </div>
      </div>`;
    }).join('');
  }

  function renderMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\n/g, '<br>');
  }

  async function sendMessage(project, panelEl, providers, callbacks) {
    const input = panelEl.querySelector('#chatInput');
    const text = input?.value?.trim();
    if (!text || isStreaming) return;

    const thread = project.chatThreads.find(t => t.id === currentThreadId);
    if (!thread) return;

    // Add user message
    thread.messages.push({ role: 'user', content: text, ts: Date.now() });
    input.value = '';
    input.style.height = 'auto';

    // Get selected model (use persisted value)
    const providerId = selectedModelValue.split('::')[0];
    const model = selectedModelValue.split('::')[1];

    if (!providerId) {
      thread.messages.push({ role: 'assistant', content: 'No AI provider selected. Please select a model above.', ts: Date.now() });
      render(project, panelEl, providers, callbacks);
      callbacks.onSave?.();
      return;
    }

    // Show loading state
    isStreaming = true;
    render(project, panelEl, providers, callbacks);

    try {
      const msgs = thread.messages.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }));
      if (thread.systemPrompt) msgs.unshift({ role: 'system', content: thread.systemPrompt });

      const resp = await apiPost('/api/ai/chat', { providerId, model, messages: msgs, stream: false });

      if (resp.error) {
        thread.messages.push({ role: 'assistant', content: `Error: ${resp.error}`, ts: Date.now() });
      } else {
        const aiText = resp.choices?.[0]?.message?.content || 'No response received.';
        thread.messages.push({ role: 'assistant', content: aiText, ts: Date.now() });
      }
    } catch (err) {
      thread.messages.push({ role: 'assistant', content: `Connection error: ${err.message}`, ts: Date.now() });
    }

    isStreaming = false;
    render(project, panelEl, providers, callbacks);
    callbacks.onSave?.();
  }

  function scrollToBottom(panelEl) {
    const msgs = panelEl.querySelector('#chatMessages');
    if (msgs) setTimeout(() => msgs.scrollTop = msgs.scrollHeight, 50);
  }

  function setThread(id) { currentThreadId = id; }

  return { render, setThread };
})();
