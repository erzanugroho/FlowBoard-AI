/**
 * Flowboard — Data Layer & Sample Data
 */
const STORAGE_KEY = 'flowboard-data';
const PROJECT_COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];

function uid() {
  return 'id_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const SAMPLE_DATA = {
  projects: [
    {
      id: uid(), name: 'Website Redesign', description: 'Complete overhaul of the company website with modern design system and improved UX.', color: '#6366f1', updatedAt: Date.now() - 3600000,
      columns: [
        { id: uid(), title: 'Backlog', cards: [
          { id: uid(), title: 'Research competitor websites', description: 'Analyze top 5 competitor sites for design patterns and features.', priority: 'low', label: 'design', due: '2026-05-20', assignee: 'Sarah', createdAt: Date.now() - 86400000 },
          { id: uid(), title: 'Content audit', description: 'Review all existing pages and flag outdated content.', priority: 'medium', label: '', due: '', assignee: '', createdAt: Date.now() - 72000000 }
        ]},
        { id: uid(), title: 'Todo', cards: [
          { id: uid(), title: 'Design homepage mockup', description: 'Create high-fidelity mockup for the new homepage layout.', priority: 'high', label: 'design', due: '2026-05-15', assignee: 'Alex', createdAt: Date.now() - 50000000 },
          { id: uid(), title: 'Setup CI/CD pipeline', description: 'Configure automated deployment to staging.', priority: 'medium', label: 'backend', due: '2026-05-18', assignee: 'Mike', createdAt: Date.now() - 40000000 }
        ]},
        { id: uid(), title: 'In Progress', cards: [
          { id: uid(), title: 'Implement navigation component', description: 'Build responsive navigation with mobile hamburger menu.', priority: 'high', label: 'frontend', due: '2026-05-12', assignee: 'Alex', createdAt: Date.now() - 30000000 }
        ]},
        { id: uid(), title: 'Done', cards: [
          { id: uid(), title: 'Setup project repository', description: 'Initialize Git repo with branch protection rules.', priority: 'low', label: 'backend', due: '', assignee: 'Mike', createdAt: Date.now() - 200000000 }
        ]}
      ]
    },
    {
      id: uid(), name: 'Mobile App v2', description: 'Second major release of the mobile application with new features and performance improvements.', color: '#3b82f6', updatedAt: Date.now() - 7200000,
      columns: [
        { id: uid(), title: 'Backlog', cards: [
          { id: uid(), title: 'Push notification system', description: 'Implement push notifications for order updates.', priority: 'medium', label: 'feature', due: '2026-06-01', assignee: '', createdAt: Date.now() }
        ]},
        { id: uid(), title: 'Todo', cards: [
          { id: uid(), title: 'Fix login crash on Android 14', description: 'App crashes on certain Android 14 devices during OAuth flow.', priority: 'high', label: 'bug', due: '2026-05-10', assignee: 'Jordan', createdAt: Date.now() }
        ]},
        { id: uid(), title: 'In Progress', cards: [
          { id: uid(), title: 'Dark mode implementation', description: 'Add system-aware dark mode toggle to all screens.', priority: 'medium', label: 'frontend', due: '2026-05-16', assignee: 'Sarah', createdAt: Date.now() }
        ]},
        { id: uid(), title: 'Done', cards: [] }
      ]
    },
    {
      id: uid(), name: 'Q2 Marketing Campaign', description: 'Plan and execute multi-channel marketing campaign for Q2 product launch.', color: '#10b981', updatedAt: Date.now() - 86400000,
      columns: [
        { id: uid(), title: 'Backlog', cards: [] },
        { id: uid(), title: 'Todo', cards: [
          { id: uid(), title: 'Write blog post series', description: 'Create 4-part blog series about product features.', priority: 'medium', label: 'feature', due: '2026-05-25', assignee: 'Emma', createdAt: Date.now() }
        ]},
        { id: uid(), title: 'In Progress', cards: [
          { id: uid(), title: 'Design social media assets', description: 'Create templates for Instagram, Twitter, and LinkedIn.', priority: 'high', label: 'design', due: '2026-05-14', assignee: 'Alex', createdAt: Date.now() }
        ]},
        { id: uid(), title: 'Done', cards: [
          { id: uid(), title: 'Define target audience', description: 'Document buyer personas and audience segments.', priority: 'low', label: '', due: '', assignee: 'Emma', createdAt: Date.now() }
        ]}
      ]
    }
  ],
  settings: { theme: 'light', density: 'comfortable' }
};

function loadAppData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.projects)) return d;
    }
  } catch (e) { console.warn('Load error:', e); }
  return JSON.parse(JSON.stringify(SAMPLE_DATA));
}

function saveAppData(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.warn('Save error:', e); }
}

function countTasks(project) {
  return project.columns.reduce((sum, col) => sum + col.cards.length, 0);
}
