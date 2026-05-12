/**
 * Flowboard AI — MCP Client (#10)
 * Connects to external MCP (Model Context Protocol) tool servers
 */
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');

class MCPClient {
  constructor(config) {
    this.name = config.name;
    this.type = config.type; // 'stdio' or 'sse'
    this.command = config.command;
    this.args = config.args || [];
    this.env = config.env || {};
    this.url = config.url;
    this.headers = config.headers || {};
    this.tools = [];
    this.process = null;
    this.requestId = 0;
    this.pending = new Map();
    this.buffer = '';
  }

  async connect() {
    if (this.type === 'stdio') return this._connectStdio();
    if (this.type === 'sse') return this._connectSSE();
    throw new Error(`Unknown MCP type: ${this.type}`);
  }

  async _connectStdio() {
    this.process = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process.stdout.on('data', chunk => {
      this.buffer += chunk.toString();
      this._processBuffer();
    });

    this.process.on('error', err => { this.tools = []; });
    this.process.on('exit', () => { this.process = null; });

    // Initialize and list tools
    await this._send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    const result = await this._send('tools/list', {});
    this.tools = (result?.tools || []).map(t => ({
      type: 'function',
      function: { name: `mcp_${this.name}_${t.name}`, description: `[MCP:${this.name}] ${t.description}`, parameters: t.inputSchema || { type: 'object', properties: {} } }
    }));
    return this.tools;
  }

  async _connectSSE() {
    // For SSE-based MCP servers, list tools via HTTP
    const url = new URL(this.url + '/tools/list');
    const mod = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = mod.get(url.href, { headers: this.headers, timeout: 10000 }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            this.tools = (result.tools || []).map(t => ({
              type: 'function',
              function: { name: `mcp_${this.name}_${t.name}`, description: `[MCP:${this.name}] ${t.description}`, parameters: t.inputSchema || { type: 'object', properties: {} } }
            }));
            resolve(this.tools);
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
    });
  }

  async callTool(toolName, args) {
    // Strip mcp prefix
    const actualName = toolName.replace(`mcp_${this.name}_`, '');
    if (this.type === 'stdio') {
      const result = await this._send('tools/call', { name: actualName, arguments: args });
      return { success: true, output: JSON.stringify(result?.content || result, null, 2).slice(0, 8000) };
    }
    if (this.type === 'sse') {
      return this._callSSE(actualName, args);
    }
    return { success: false, output: 'MCP not connected' };
  }

  async _callSSE(toolName, args) {
    const url = new URL(this.url + '/tools/call');
    const mod = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify({ name: toolName, arguments: args });
    return new Promise((resolve) => {
      const req = mod.request(url.href, { method: 'POST', headers: { ...this.headers, 'Content-Type': 'application/json' }, timeout: 30000 }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ success: true, output: data.slice(0, 8000) }); }
          catch { resolve({ success: false, output: 'Parse error' }); }
        });
      });
      req.on('error', e => resolve({ success: false, output: e.message }));
      req.write(body);
      req.end();
    });
  }

  _send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.pending.set(id, { resolve, reject });
      if (this.process?.stdin?.writable) this.process.stdin.write(msg);
      else reject(new Error('MCP process not running'));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('MCP timeout')); } }, 15000);
    });
  }

  _processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          resolve(msg.result);
        }
      } catch {}
    }
  }

  disconnect() {
    if (this.process) { this.process.kill(); this.process = null; }
  }
}

// MCP Manager — manages multiple MCP servers
class MCPManager {
  constructor() { this.clients = new Map(); }

  async addServer(config) {
    const client = new MCPClient(config);
    try {
      await client.connect();
      this.clients.set(config.name, client);
      return client.tools;
    } catch (err) {
      return [];
    }
  }

  removeServer(name) {
    const client = this.clients.get(name);
    if (client) { client.disconnect(); this.clients.delete(name); }
  }

  getAllTools() {
    const tools = [];
    for (const client of this.clients.values()) tools.push(...client.tools);
    return tools;
  }

  async callTool(fullName, args) {
    for (const [name, client] of this.clients) {
      if (fullName.startsWith(`mcp_${name}_`)) return client.callTool(fullName, args);
    }
    return { success: false, output: 'MCP tool not found' };
  }

  isMCPTool(name) { return name.startsWith('mcp_'); }

  disconnectAll() { for (const c of this.clients.values()) c.disconnect(); this.clients.clear(); }
}

module.exports = { MCPClient, MCPManager };
