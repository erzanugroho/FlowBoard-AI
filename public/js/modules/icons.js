/**
 * Flowboard AI — Icon System
 * Replaces emojis with Lucide SVG icons for professional look
 */
const Icons = (() => {
  // Icon helper — returns inline SVG string
  function i(name, size = 16, cls = '') {
    return `<i data-lucide="${name}" class="icon ${cls}" style="width:${size}px;height:${size}px"></i>`;
  }

  // Render all pending lucide icons in a container
  function render(container) {
    if (window.lucide) lucide.createIcons({ nodes: container ? [container] : undefined });
  }

  // Semantic icon map
  const map = {
    // Agent & AI
    agent: 'bot',
    user: 'user',
    spark: 'sparkles',
    brain: 'brain',
    wand: 'wand-2',

    // Tools
    terminal: 'terminal',
    file: 'file-text',
    fileEdit: 'file-pen',
    fileWrite: 'file-plus',
    search: 'search',
    folder: 'folder',
    folderOpen: 'folder-open',
    list: 'list',

    // Actions
    play: 'play',
    stop: 'square',
    retry: 'rotate-ccw',
    send: 'send-horizontal',
    plus: 'plus',
    trash: 'trash-2',
    edit: 'pencil',
    move: 'move',
    check: 'check',
    x: 'x',
    copy: 'copy',

    // Status
    success: 'check-circle-2',
    error: 'x-circle',
    warning: 'alert-triangle',
    info: 'info',
    loading: 'loader-2',
    clock: 'clock',

    // Navigation
    back: 'arrow-left',
    settings: 'settings',
    key: 'key-round',
    palette: 'command',
    keyboard: 'keyboard',
    sun: 'sun',
    moon: 'moon',
    menu: 'menu',
    chevronRight: 'chevron-right',

    // Board
    board: 'layout-grid',
    card: 'sticky-note',
    columns: 'columns-3',
    activity: 'activity',
    zap: 'zap',
    rocket: 'rocket',

    // Panel
    chat: 'message-square',
    code: 'code-2',
    diff: 'git-compare',
    shield: 'shield-check',
    lock: 'lock',
    unlock: 'unlock',
    tokens: 'coins',
    fileChanged: 'file-diff',
  };

  function get(key, size = 16, cls = '') {
    return i(map[key] || key, size, cls);
  }

  return { i, get, render, map };
})();
