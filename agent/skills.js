/**
 * Flowboard AI — Skills Loader
 * Loads .md skill files from skills directories and injects them into agent presets
 */
const fs = require('fs');
const path = require('path');

// All known skill directories from various AI tools
const SKILLS_DIRS = (() => {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return [
    // Kiro
    path.join(home, '.kiro', 'skills'),
    // Claude Code
    path.join(home, '.claude', 'skills'),
    path.join(home, '.claude', 'commands'),
    // Codex
    path.join(home, '.codex', 'skills'),
    path.join(home, '.codex', 'prompts'),
    // Antigravity
    path.join(home, '.antigravity', 'skills'),
    // Cursor
    path.join(home, '.cursor', 'rules'),
    path.join(home, '.cursor', 'prompts'),
    // Aider
    path.join(home, '.aider', 'prompts'),
    // Copilot
    path.join(home, '.copilot', 'prompts'),
    // Flowboard custom
    path.join(home, '.flowboard', 'skills')
  ].filter(d => fs.existsSync(d));
})();

function parseSkillFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const content = raw.replace(/\r\n/g, '\n'); // Normalize line endings
    // Parse frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fmMatch) return { name: path.basename(path.dirname(filePath)), description: '', content };

    const frontmatter = {};
    fmMatch[1].split('\n').forEach(line => {
      const idx = line.indexOf(':');
      if (idx > 0) frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });

    return {
      name: frontmatter.name || path.basename(path.dirname(filePath)),
      description: frontmatter.description || '',
      allowedTools: frontmatter['allowed-tools'] || '',
      content: fmMatch[2].trim()
    };
  } catch { return null; }
}

function loadSkillsFromDir(dir) {
  const skills = [];
  if (!fs.existsSync(dir)) return skills;

  try {
    const entries = fs.readdirSync(dir);
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const fullPath = path.join(dir, name);

      // Case 1: folder with SKILL.md inside
      const skillFile = path.join(fullPath, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        const skill = parseSkillFile(skillFile);
        if (skill) { skill.source = path.basename(dir); skills.push(skill); }
        continue;
      }

      // Case 2: direct .md file in the directory
      if (name.endsWith('.md') && fs.statSync(fullPath).isFile()) {
        const skill = parseSkillFile(fullPath);
        if (skill) { skill.source = path.basename(dir); skills.push(skill); }
      }
    }
  } catch {}
  return skills;
}

// #11 Lazy cache for skills
let _skillsCache = null;
let _skillsCacheTime = 0;
const SKILLS_CACHE_TTL = 60000; // 1 minute

function loadAllSkills(extraDirs) {
  const now = Date.now();
  if (_skillsCache && (now - _skillsCacheTime) < SKILLS_CACHE_TTL) return _skillsCache;

  const dirs = [...SKILLS_DIRS, ...(extraDirs || [])];
  const skills = [];
  const seen = new Set();

  for (const dir of dirs) {
    for (const skill of loadSkillsFromDir(dir)) {
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        skills.push(skill);
      }
    }
  }
  _skillsCache = skills;
  _skillsCacheTime = now;
  return skills;
}

function getSkillByName(name, extraDirs) {
  const skills = loadAllSkills(extraDirs);
  return skills.find(s => s.name === name) || null;
}

// Auto-detect best skill based on prompt content
const SKILL_MATCHERS = [
  { skill: 'brainstorming', keywords: ['brainstorm', 'how to approach', 'how should i', 'what should', 'plan this', 'strategy for', 'help me think'] },
  { skill: 'image-to-code', keywords: ['image to code', 'convert design', 'implement design', 'from image', 'screenshot to code'] },
  { skill: 'imagegen-frontend-mobile', keywords: ['mobile app design', 'ios app screen', 'android app screen', 'mobile ui design', 'app screen concept'] },
  { skill: 'imagegen-frontend-web', keywords: ['generate design image', 'web design mockup', 'design reference image', 'section mockup'] },
  { skill: 'gpt-taste', keywords: ['gsap', 'scroll animation', 'parallax', 'motion design', 'bento grid', 'editorial typography', 'scroll trigger'] },
  { skill: 'industrial-brutalist-ui', keywords: ['brutalist', 'industrial ui', 'terminal aesthetic', 'military ui', 'data-heavy dashboard'] },
  { skill: 'minimalist-ui', keywords: ['minimalist', 'clean ui', 'simple interface', 'editorial style', 'monochrome ui', 'flat design'] },
  { skill: 'brandkit', keywords: ['brand identity', 'logo design', 'brand guide', 'brand kit', 'visual identity', 'brand system'] },
  { skill: 'redesign-existing-projects', keywords: ['redesign', 'upgrade design', 'improve the look', 'make it look better', 'modernize ui'] },
  { skill: 'stitch-design-taste', keywords: ['design system', 'design tokens', 'component library system'] },
  { skill: 'full-output-enforcement', keywords: ['full code', 'complete implementation', 'no placeholder', 'entire file', 'whole file'] },
  { skill: 'high-end-visual-design', keywords: ['premium design', 'luxury website', 'awwwards', 'high-end ui', 'landing page design', 'hero section design', 'agency-level', 'landing page', 'premium landing'] },
  { skill: 'design-taste-frontend', keywords: ['frontend component', 'react component', 'css component', 'tailwind component', 'ui component', 'dark mode', 'responsive layout'] }
];

function detectSkill(prompt) {
  const lower = prompt.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;

  for (const matcher of SKILL_MATCHERS) {
    let score = 0;
    for (const kw of matcher.keywords) {
      if (lower.includes(kw)) score += kw.split(' ').length; // Multi-word matches score higher
    }
    if (score > bestScore) { bestScore = score; bestMatch = matcher.skill; }
  }

  // Only return if confidence is reasonable (at least 1 keyword matched)
  return bestScore >= 1 ? bestMatch : null;
}

function listSkillNames(extraDirs) {
  return loadAllSkills(extraDirs).map(s => ({ name: s.name, description: s.description }));
}

module.exports = { loadAllSkills, getSkillByName, listSkillNames, parseSkillFile, detectSkill };
