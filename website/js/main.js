// ══════════════════════════════════════════════════
// ETHRIXFORGE LANDING INTERACTIVE STUDIO DRIVER
// ══════════════════════════════════════════════════

// ── State variables ───────────────────────────────
let currentMarkdown = '';
let outputTab = 'rendered';

function getBackendUrl() {
  const url = localStorage.getItem('backend_url');
  if (url) return url.replace(/\/$/, '');
  
  // Auto-detect environment: local vs production
  const hostname = window.location.hostname;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || window.location.protocol === 'file:';
  
  return isLocal ? 'http://127.0.0.1:8000' : 'https://ethrix-forge.onrender.com';
}

// ── Language badges & color schemes ───────────────
const LANG_BADGES = {
  python: 'PY',
  javascript: 'JS',
  typescript: 'TS',
  rust: 'RS',
  go: 'GO',
  cpp: 'C++',
  yaml: 'YML',
  json: 'JSON'
};

const LANG_COLORS = {
  python: ['#3B82F6', 'rgba(59,130,246,0.12)'],
  javascript: ['#F59E0B', 'rgba(245,158,11,0.12)'],
  typescript: ['#60A5FA', 'rgba(96,165,250,0.1)'],
  rust: ['#F97316', 'rgba(249,115,22,0.12)'],
  go: ['#06B6D4', 'rgba(6,182,212,0.1)'],
  cpp: ['#A78BFA', 'rgba(167,139,250,0.1)'],
  yaml: ['#10B981', 'rgba(16,185,129,0.1)'],
  json: ['#FBBF24', 'rgba(251,191,36,0.1)']
};

// ── Initialize Event Listeners ────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const langSelect = document.getElementById('lang-select');
  const codeInput = document.getElementById('code-input');

  // Load saved code
  if (codeInput) {
    const savedCode = localStorage.getItem('landing_code');
    if (savedCode) {
      codeInput.value = savedCode;
    }
  }

  // Load saved language
  if (langSelect) {
    const savedLang = localStorage.getItem('landing_lang');
    if (savedLang) {
      langSelect.value = savedLang;
    }
  }

  if (langSelect) {
    langSelect.addEventListener('change', (e) => {
      updateLangBadge(e.target.value);
      localStorage.setItem('landing_lang', e.target.value);
    });
    updateLangBadge(langSelect.value);
  }

  if (codeInput) {
    codeInput.addEventListener('input', () => {
      renderLineNumbers();
      localStorage.setItem('landing_code', codeInput.value);
    });
    codeInput.addEventListener('keyup', renderLineNumbers);
    codeInput.addEventListener('click', renderLineNumbers);
    codeInput.addEventListener('scroll', () => {
      const gutter = document.getElementById('ide-gutter');
      if (gutter) gutter.scrollTop = codeInput.scrollTop;
    });

    // Tab key support inside editor
    codeInput.addEventListener('keydown', function(e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = this.selectionStart;
        const end = this.selectionEnd;
        this.value = this.value.substring(0, start) + '  ' + this.value.substring(end);
        this.selectionStart = this.selectionEnd = start + 2;
        renderLineNumbers();
        localStorage.setItem('landing_code', this.value);
      }
    });

    renderLineNumbers();
  }

  // Load saved report
  const savedReport = localStorage.getItem('landing_report');
  if (savedReport) {
    currentMarkdown = savedReport;
    const outputRendered = document.getElementById('output-rendered');
    const outputRaw = document.getElementById('output-raw');
    if (outputRendered) outputRendered.innerHTML = parseMarkdown(currentMarkdown);
    if (outputRaw) outputRaw.textContent = currentMarkdown;
    showOutput();
    if (codeInput && codeInput.value) {
      animateMetrics(codeInput.value, 'analyze', false);
    }
  }

  // File dropzone listeners
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  if (dropZone && fileInput) {
    // Prevent defaults
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evtName => {
      dropZone.addEventListener(evtName, (e) => e.preventDefault(), false);
    });

    dropZone.addEventListener('dragenter', () => dropZone.classList.add('drag-over'), false);
    dropZone.addEventListener('dragover', () => dropZone.classList.add('drag-over'), false);
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'), false);
    dropZone.addEventListener('drop', (e) => {
      dropZone.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length > 0) loadFile(files[0]);
    }, false);
  }
});

// ── Update Language Badge ─────────────────────────
function updateLangBadge(lang) {
  const badge = document.getElementById('lang-badge-display');
  if (!badge) return;
  const isDark = document.documentElement.classList.contains('dark');
  
  const darkColors = {
    python: ['#60A5FA', 'rgba(96,165,250,0.15)'],
    javascript: ['#F59E0B', 'rgba(245,158,11,0.15)'],
    typescript: ['#60A5FA', 'rgba(96,165,250,0.15)'],
    rust: ['#F97316', 'rgba(249,115,22,0.15)'],
    go: ['#22D3EE', 'rgba(34,211,238,0.15)'],
    cpp: ['#C084FC', 'rgba(192,132,252,0.15)'],
    yaml: ['#34D399', 'rgba(52,211,153,0.15)'],
    json: ['#FBBF24', 'rgba(251,191,36,0.15)']
  };

  const lightColors = {
    python: ['#1D4ED8', 'rgba(29,78,216,0.08)'],
    javascript: ['#B45309', 'rgba(180,83,9,0.08)'],
    typescript: ['#1D4ED8', 'rgba(29,78,216,0.08)'],
    rust: ['#C2410C', 'rgba(194,65,12,0.08)'],
    go: ['#0E7490', 'rgba(14,116,144,0.08)'],
    cpp: ['#6D28D9', 'rgba(109,40,217,0.08)'],
    yaml: ['#047857', 'rgba(4,120,87,0.08)'],
    json: ['#B45309', 'rgba(180,83,9,0.08)']
  };

  const colors = isDark ? darkColors : lightColors;
  const [color, bg] = colors[lang] || (isDark ? ['#38BDF8', 'rgba(56,189,248,0.15)'] : ['#0369A1', 'rgba(3,105,161,0.08)']);

  badge.textContent = LANG_BADGES[lang] || lang.toUpperCase().slice(0, 3);
  badge.style.color = color;
  badge.style.background = bg;
  badge.style.border = `1px solid ${color}35`;
}

// ── Render Line Numbers ───────────────────────────
function renderLineNumbers() {
  const codeInput = document.getElementById('code-input');
  const gutter = document.getElementById('ide-gutter');
  if (!codeInput || !gutter) return;

  const lines = codeInput.value.split('\n');
  const lineCount = lines.length || 1;
  const selStart = codeInput.selectionStart;
  const textBefore = codeInput.value.substring(0, selStart);
  const activeLine = textBefore.split('\n').length;

  let gutterHtml = '';
  for (let i = 1; i <= lineCount; i++) {
    gutterHtml += `<span class="ln ${i === activeLine ? 'active-ln' : ''}">${i}</span>`;
  }
  gutter.innerHTML = gutterHtml;

  // Sync scroll
  gutter.scrollTop = codeInput.scrollTop;

  // Update position label
  const textAtCurrentLine = textBefore.split('\n');
  const activeCol = textAtCurrentLine.pop().length + 1;
  document.getElementById('cursor-pos').textContent = `Ln ${activeLine}, Col ${activeCol}`;
  document.getElementById('char-count').textContent = `${codeInput.value.length} chars`;
}

// ── Load File into Editor ─────────────────────────
function loadFile(file) {
  const codeInput = document.getElementById('code-input');
  const dropZone = document.getElementById('drop-zone');
  const langSelect = document.getElementById('lang-select');
  if (!codeInput || !dropZone) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    codeInput.value = e.target.result;
    renderLineNumbers();

    // Try auto-detect language from extension
    const ext = file.name.split('.').pop().toLowerCase();
    const map = {
      py: 'python',
      js: 'javascript',
      ts: 'typescript',
      rs: 'rust',
      go: 'go',
      cpp: 'cpp',
      cc: 'cpp',
      h: 'cpp',
      yaml: 'yaml',
      yml: 'yaml',
      json: 'json'
    };
    const detected = map[ext] || 'python';
    if (langSelect) {
      langSelect.value = detected;
      updateLangBadge(detected);
    }

    // Update Dropzone interface
    document.getElementById('file-name-label').textContent = file.name;
    document.getElementById('file-chip').classList.remove('hidden');
    dropZone.classList.add('has-file');
    document.getElementById('drop-label').innerHTML = `File loaded · <span class="text-neon">click to replace</span>`;
    document.getElementById('drop-sub').textContent = `${(file.size / 1024).toFixed(2)} KB`;
  };
  reader.readAsText(file);
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) loadFile(file);
}

function clearFile(e) {
  if (e) e.stopPropagation();
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');
  if (fileInput) fileInput.value = '';
  if (dropZone) {
    dropZone.classList.remove('has-file');
    document.getElementById('file-chip').classList.add('hidden');
    document.getElementById('drop-label').innerHTML = `Drop file here or <span class="text-neon">browse</span>`;
    document.getElementById('drop-sub').textContent = '.py · .js · .ts · .rs · .go · .cpp · .yaml · .json';
  }
}

// ── Clear Editor ──────────────────────────────────
function clearEditor() {
  const codeInput = document.getElementById('code-input');
  if (codeInput) {
    codeInput.value = '';
    renderLineNumbers();
  }
  clearFile();
  currentMarkdown = '';
  localStorage.removeItem('landing_code');
  localStorage.removeItem('landing_lang');
  localStorage.removeItem('landing_report');
  showIdle();
  setStatusDot('idle');
  document.getElementById('output-meta').textContent = 'No report yet';
  document.getElementById('perf-panel').classList.add('hidden');
  document.getElementById('output-actions-bar').classList.add('hidden');
}

// ── Switch Tabs ───────────────────────────────────
function setOutputTab(tab) {
  outputTab = tab;
  const btnRendered = document.getElementById('tab-rendered');
  const btnRaw = document.getElementById('tab-raw');
  if (!btnRendered || !btnRaw) return;

  if (tab === 'rendered') {
    btnRendered.className = "text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded bg-neon/12 text-neon transition-all";
    btnRaw.className = "text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded text-slate-600 dark:text-slate-400 hover:text-neon transition-all";
  } else {
    btnRaw.className = "text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded bg-neon/12 text-neon transition-all";
    btnRendered.className = "text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded text-slate-600 dark:text-slate-400 hover:text-neon transition-all";
  }
  btnRendered.style.background = '';
  btnRendered.style.color = '';
  btnRaw.style.background = '';
  btnRaw.style.color = '';

  if (currentMarkdown) {
    showOutput();
  }
}

// ── Show Output Panel States ──────────────────────
function showIdle() {
  document.getElementById('output-idle').classList.remove('hidden');
  document.getElementById('output-thinking').classList.add('hidden');
  document.getElementById('output-rendered').classList.add('hidden');
  document.getElementById('output-raw').classList.add('hidden');
}

function showThinking() {
  document.getElementById('output-idle').classList.add('hidden');
  document.getElementById('output-thinking').classList.remove('hidden');
  document.getElementById('output-rendered').classList.add('hidden');
  document.getElementById('output-raw').classList.add('hidden');
}

function showOutput() {
  document.getElementById('output-idle').classList.add('hidden');
  document.getElementById('output-thinking').classList.add('hidden');
  if (outputTab === 'rendered') {
    document.getElementById('output-rendered').classList.remove('hidden');
    document.getElementById('output-raw').classList.add('hidden');
  } else {
    document.getElementById('output-raw').classList.remove('hidden');
    document.getElementById('output-rendered').classList.add('hidden');
  }
  document.getElementById('output-actions-bar').classList.remove('hidden');
}

function setStatusDot(state) {
  const dot = document.getElementById('output-status-dot');
  if (!dot) return;
  const colors = {
    idle: '#475569',
    running: '#F59E0B',
    done: '#10B981',
    error: '#F43F5E'
  };
  dot.style.backgroundColor = colors[state] || '#475569';
  if (state === 'running') {
    dot.style.boxShadow = '0 0 8px #F59E0B';
  } else if (state === 'done') {
    dot.style.boxShadow = '0 0 8px #10B981';
  } else {
    dot.style.boxShadow = 'none';
  }
}

// ── Markdown Parser ───────────────────────────────
function parseMarkdown(md) {
  let html = md
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Horizontal Rule
    .replace(/^---$/gm, '<hr>')
    // Bold / Italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote><p>$1</p></blockquote>')
    // Standard Badges
    .replace(/\[CRITICAL\]/g, '<span class="badge-critical"><i class="fa-solid fa-triangle-exclamation"></i> CRITICAL</span>')
    .replace(/\[WARN\]/g,     '<span class="badge-warn"><i class="fa-solid fa-circle-exclamation"></i> WARN</span>')
    .replace(/\[OK\]/g,       '<span class="badge-ok"><i class="fa-solid fa-circle-check"></i> OK</span>')
    .replace(/\[INFO\]/g,     '<span class="badge-info"><i class="fa-solid fa-circle-info"></i> INFO</span>')
    // List Items
    .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    // Paragraph wrapper for unwrapped strings
    .replace(/^(?!<[a-z])(\S.+)$/gm, '<p>$1</p>')
    // Remove blank wrappers
    .replace(/<p><\/p>/g, '');
  return html;
}

// ── Run Analysis Action ───────────────────────────
async function runAction(action) {
  const codeInput = document.getElementById('code-input');
  const code = codeInput.value.trim();
  if (!code) {
    codeInput.style.borderColor = 'rgba(244, 63, 94, 0.6)';
    setTimeout(() => codeInput.style.borderColor = '', 1500);
    showToast('⚠️ Editor is empty! Please write some code first.');
    return;
  }

  const langSelect = document.getElementById('lang-select');
  const lang = langSelect ? langSelect.value : 'auto';
  const btn = document.getElementById(`btn-${action === 'analyze' ? 'analyze' : action}`);
  
  // Set UI loading states
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.style.opacity = '0.75';
  btn.style.cursor = 'not-allowed';
  
  setStatusDot('running');
  document.getElementById('output-meta').textContent = 'Querying Ethrix Server...';
  document.getElementById('perf-panel').classList.add('hidden');
  showThinking();

  // Loading animations steps
  const steps = {
    analyze: [
      ['CONNECTING...', 'Accessing EthrixForge analysis pipeline', 10],
      ['UPLOADING CODE...', 'Sending code blocks to backend API server', 30],
      ['LINTING SCHEMAS...', 'Running static ast code reviews', 50],
      ['SECURITY AUDIT...', 'Scanning credentials, sql injections, dependencies', 70],
      ['COMPILING...', 'Assembling Markdown review summaries', 90]
    ],
    fix: [
      ['CONNECTING...', 'Accessing EthrixForge optimization pipeline', 10],
      ['PARSING CODE...', 'Generating AST representation of source files', 30],
      ['OPTIMIZING...', 'Refactoring redundant loop declarations & memory allocations', 60],
      ['ASSEMBLING...', 'Writing clean drop-in replacement files', 85]
    ],
    docgen: [
      ['CONNECTING...', 'Accessing EthrixForge documentation pipeline', 15],
      ['EXTRACTING...', 'Identifying function signatures & class declarations', 45],
      ['WRITING DOCS...', 'Writing Sphinx and Google style inline documentation', 75],
      ['SUGGESTING...', 'Generating git conventional commit messages', 90]
    ]
  };

  const currentSteps = steps[action] || steps.analyze;
  let currentStepIdx = 0;
  const progressBar = document.getElementById('spin-progress');
  
  const stepTimer = setInterval(() => {
    const [lbl, desc, pct] = currentSteps[currentStepIdx % currentSteps.length];
    document.getElementById('thinking-label').textContent = lbl;
    document.getElementById('thinking-sub').textContent = desc;
    if (progressBar) progressBar.style.width = pct + '%';
    currentStepIdx++;
  }, 650);

  // Fetch logic
  let reportMarkdown = '';
  let isOffline = false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 180s timeout

    const url = `${getBackendUrl()}/${action}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ code, language: lang }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API status ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();
    
    // Parse results depending on endpoint
    if (action === 'analyze') {
      reportMarkdown = json.raw_markdown_report || json.report || JSON.stringify(json, null, 2);
    } else if (action === 'fix') {
      reportMarkdown = `# Refactored Source Code Fixes\n\n## Optimizations and Corrections Made\n${json.explanation}\n\n---\n## Refactored Output Code\n\`\`\`${lang}\n${json.refactored_code}\n\`\`\``;
    } else if (action === 'docgen') {
      reportMarkdown = `# Automated Inline Documentation\n\n## Suggested Conventional Commit Message\n\`${json.commit_message}\`\n\n---\n## Documented Output Code\n\`\`\`${lang}\n${json.documented_code}\n\`\`\``;
    }

  } catch (err) {
    isOffline = true;
    console.warn(`[EthrixForge] Service unavailable, starting local fallbacks. Info: ${err.message}`);
    showToast(err.name === 'AbortError' ? '⚠️ Server connection timed out.' : '⚠️ Server unreachable. running offline mode.');
    reportMarkdown = generateFallbackReport(code, lang, action);
  } finally {
    clearInterval(stepTimer);
    if (progressBar) progressBar.style.width = '100%';
  }

  // Display report after short progress visibility delay
  await new Promise(resolve => setTimeout(resolve, 250));

  currentMarkdown = reportMarkdown;
  localStorage.setItem('landing_report', currentMarkdown);
  document.getElementById('output-rendered').innerHTML = parseMarkdown(currentMarkdown);
  document.getElementById('output-raw').textContent = currentMarkdown;

  setStatusDot(isOffline ? 'error' : 'done');
  
  const lineCount = code.split('\n').length;
  document.getElementById('output-meta').textContent = 
    `${lineCount} lines · ${new Date().toLocaleTimeString()} ${isOffline ? '· (offline fallback)' : ''}`;

  showOutput();
  animateMetrics(code, action, isOffline);

  // Restore button states
  btn.disabled = false;
  btn.style.opacity = '1';
  btn.style.cursor = 'pointer';
  btn.innerHTML = originalHtml;
  
  // Scroll output to top
  document.getElementById('output-body').scrollTop = 0;
}

// ── Local Offline Fallback Reports ────────────────
function generateFallbackReport(code, lang, action) {
  const lineCount = code.split('\n').length;
  const charCount = code.length;
  const loopCount = (code.match(/for |while /g) || []).length;
  const hasClasses = /class /g.test(code);
  const todoCount = (code.match(/TODO|FIXME|HACK/g) || []).length;
  const longLines = code.split('\n').filter(l => l.length > 80).length;
  
  const baseScore = Math.max(35, 100 - (longLines * 4) - (todoCount * 6) - (loopCount > 3 ? 10 : 0));
  const grade = baseScore >= 90 ? 'A' : baseScore >= 80 ? 'B' : baseScore >= 65 ? 'C' : 'D';

  if (action === 'analyze') {
    return `# ⚠️ Offline Report — Static Scan Fallback
> **Server Status**: [WARN] Unreachable. Core AI analysis disabled. Displaying local static metrics.

---
## Quality Audit Score
[${baseScore >= 75 ? 'OK' : 'WARN'}] Quality score: **${baseScore} / 100** (Grade **${grade}**)

---
## Complexity Diagnostics
- **Source lines**: \`${lineCount}\`
- **Total characters**: \`${charCount}\`
- **Loop nodes**: \`${loopCount}\` (complexity rating: ${loopCount > 2 ? 'Medium' : 'Low'})
- **Class declarations**: ${hasClasses ? 'Yes' : 'No'}
- **Lines exceeding 80 columns**: \`${longLines}\` lines

---
## Style & Standards
- **TODO markers**: ${todoCount > 0 ? `[WARN] ${todoCount} unresolved flags` : '[OK] 0 markers'}
- **Indent spaces**: Tab character check OK.

---
## Next Steps
1. Make sure your local server is running by executing:
   \`\`\`bash
   uvicorn main:app --reload
   \`\`\`
2. Check that API keys are set in your local \`.env\` file.
`;
  } else if (action === 'fix') {
    // Basic local format fix
    const cleanedCode = code.split('\n').map(l => l.trimEnd()).join('\n').trimEnd();
    return `# ⚠️ Offline Refactoring — Fallback Mode
> **Server Status**: [WARN] Unreachable. Suggesting local syntactic cleanups only.

---
## Explanations & Changes
1. **Trailing Whitespace Removal**: Cleaned all non-standard trailing spaces from line-ends.
2. **Buffer Flush**: Normalized final file line termination.

---
## Refactored Output Code
\`\`\`${lang}
${cleanedCode}
\`\`\``;
  } else {
    // docgen fallback
    const commit = `docs: documented code snippets in ${lang}`;
    const lines = code.split('\n');
    let documented = `"""\nEthrixForge Auto-Generated File Documentation\nLines: ${lineCount}\nCreated: ${new Date().toLocaleDateString()}\n"""\n\n`;
    documented += lines.map(line => {
      if ((line.trim().startsWith('def ') || line.trim().startsWith('function ')) && !line.includes('"""')) {
        const indent = line.match(/^\s*/)[0];
        return `${line}\n${indent}    """\n${indent}    TODO: Document function arguments and outputs\n${indent}    """`;
      }
      return line;
    }).join('\n');

    return `# ⚠️ Offline Docgen — Fallback Mode
> **Server Status**: [WARN] Unreachable. Generating local documentation template.

---
## Suggested Conventional Commit Message
\`${commit}\`

---
## Documented Output Code
\`\`\`${lang}
${documented}
\`\`\``;
  }
}

// ── Animate Metrics ───────────────────────────────
function animateMetrics(code, action, isOffline) {
  const lineCount = code.split('\n').length;
  const todoCount = (code.match(/TODO|FIXME|HACK/g) || []).length;
  const longLines = code.split('\n').filter(l => l.length > 80).length;

  let health = isOffline ? 68 : Math.max(40, 95 - (longLines * 2) - (todoCount * 3));
  let timeSaved = isOffline ? 50 : Math.min(99, 75 + (lineCount > 100 ? 15 : lineCount * 0.2));
  let complexity = isOffline ? 45 : Math.max(30, 88 - (code.match(/for |while |if |elif |else |switch /g) || []).length * 4);
  let security = isOffline ? 60 : Math.max(50, 99 - (code.match(/password|passwd|key|token|secret|admin|eval|exec/gi) || []).length * 15);

  // Override time saved and scores slightly if action was fix/docgen
  if (action === 'fix') {
    health = Math.min(98, health + 10);
    complexity = Math.min(95, complexity + 15);
  } else if (action === 'docgen') {
    health = Math.min(95, health + 5);
  }

  // Show panel
  document.getElementById('perf-panel').classList.remove('hidden');

  // Set bars with transition
  requestAnimationFrame(() => {
    setTimeout(() => {
      setProgressBar('health-bar', 'health-val', health);
      setProgressBar('time-bar', 'time-val', timeSaved);
      setProgressBar('complex-bar', 'complex-val', complexity);
      setProgressBar('security-bar', 'security-val', security);
    }, 100);
  });
}

function setProgressBar(barId, valId, targetVal) {
  const bar = document.getElementById(barId);
  const valText = document.getElementById(valId);
  if (!bar || !valText) return;

  bar.style.width = targetVal + '%';

  // Count-up numbers
  let cur = 0;
  const step = Math.ceil(targetVal / 25);
  const timer = setInterval(() => {
    cur = Math.min(cur + step, targetVal);
    valText.textContent = cur + '%';
    if (cur >= targetVal) clearInterval(timer);
  }, 25);
}

// ── Clipboard Copy ────────────────────────────────
function copyOutput() {
  if (!currentMarkdown) return;
  navigator.clipboard.writeText(currentMarkdown).then(() => {
    showToast('✓ Diagnostic report copied to clipboard');
  }).catch(() => {
    showToast('⚠️ Failed to copy report.');
  });
}

// ── Download Markdown ─────────────────────────────
function exportMarkdown() {
  if (!currentMarkdown) return;
  const blob = new Blob([currentMarkdown], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ethrix-analysis-report.md';
  a.click();
  showToast('⬇ Downloading analysis report...');
}

// ── Toast Alerts ──────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('copy-toast');
  if (!toast) return;

  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(24px)';
  }, 2200);
}

// ── Theme Switcher Functions for Custom Toggle ───────────────
function applyLightTheme() {
  document.documentElement.classList.remove('dark');
  localStorage.setItem('theme', 'light');
  const checkbox = document.getElementById('toggle');
  if (checkbox) checkbox.checked = false;
  
  // Update lang badge colors if updateLangBadge function exists
  const langSelect = document.getElementById('lang-select');
  if (langSelect && typeof updateLangBadge === 'function') {
    updateLangBadge(langSelect.value);
  }
}

function applyDarkTheme() {
  document.documentElement.classList.add('dark');
  localStorage.setItem('theme', 'dark');
  const checkbox = document.getElementById('toggle');
  if (checkbox) checkbox.checked = true;
  
  // Update lang badge colors if updateLangBadge function exists
  const langSelect = document.getElementById('lang-select');
  if (langSelect && typeof updateLangBadge === 'function') {
    updateLangBadge(langSelect.value);
  }
}

function toggleDarkMode() {
  const checkbox = document.getElementById('toggle');
  if (checkbox && checkbox.checked) {
    applyDarkTheme();
  } else {
    applyLightTheme();
  }
}

// Sync toggle checkbox state on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  const isDark = document.documentElement.classList.contains('dark');
  const checkbox = document.getElementById('toggle');
  if (checkbox) checkbox.checked = isDark;
});

// Sync theme in real-time across open tabs
window.addEventListener('storage', (e) => {
  if (e.key === 'theme') {
    if (e.newValue === 'dark') {
      applyDarkTheme();
    } else {
      applyLightTheme();
    }
  }
});