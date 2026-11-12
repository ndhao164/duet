(() => {
  const POLL_LIVE_MS = 1200;
  const POLL_IDLE_MS = 2500;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  const state = {
    etag: '',
    snap: null,
    tab: 'pipeline',
    sevFilter: 'ALL',
    selectedSwarmId: params.get('swarmId') || '',
    lastHostConv: '',
    lastOptionsKey: '',
    demoMode: false,
    demoStage: 0,
    pollTimer: null,
  };

  // Sync light/dark scheme from Antigravity's injected :root --background token
  function syncTheme() {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background, #f7f8fa)';
    document.documentElement.appendChild(probe);
    const rgb = (getComputedStyle(probe).color.match(/[\d.]+/g) || []).map(Number);
    probe.remove();
    if (rgb.length >= 3) {
      const scale = getComputedStyle(document.documentElement).getPropertyValue('--background').includes('color(') ? 1 : 255;
      const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / scale;
      document.documentElement.dataset.theme = lum < 0.5 ? 'dark' : 'light';
    }
  }
  syncTheme();
  new MutationObserver(syncTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style'],
  });

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const PHASE_LABELS = {
    idle: 'Standing by',
    building: 'Carbon building',
    reviewing: 'Argon reviewing',
    fixing: 'Fixing feedback',
    approved: 'All slices approved',
  };

  const STATUS_LABELS = {
    working: 'Working',
    waiting: 'Waiting',
    done: 'Completed',
    killed: 'Stopped',
    error: 'Error',
  };

  // Fallback sample preview used ONLY when zero real swarms exist on disk
  const DEMO_STAGES = [
    {
      label: 'Sample 1/2 — Carbon Lead Coder spawns parallel workers while Argon stands by',
      snap: {
        title: 'Duet Sample Preview (No real sessions yet)',
        phase: 'building',
        coders: [
          {
            name: 'coder',
            model: 'Gemini 4 Carbon (High)',
            status: 'working',
            steps: 9,
            activity: 'Coordinating 2 parallel workers across backend & UI slices',
            conversationId: null,
            files: [
              { name: 'contracts.ts', path: 'src/shared/contracts.ts', uri: null },
              { name: 'scanner.ts', path: 'src/server/scanner.ts', uri: null },
            ],
            subagents: [
              {
                index: 1,
                role: '@slice-backend',
                status: 'done',
                steps: 6,
                activity: 'Write scanner.ts',
                files: [{ name: 'scanner.ts', uri: null }],
              },
              {
                index: 2,
                role: '@slice-frontend',
                status: 'working',
                steps: 4,
                activity: 'Edit dashboard.ts',
                files: [],
              },
            ],
          },
        ],
        reviewers: [
          {
            name: 'reviewer',
            model: 'Gemini 4 Argon (High)',
            status: 'waiting',
            steps: 1,
            activity: 'Waiting on swarm board for Milestone 1 handoff',
            conversationId: null,
            subagents: [],
          },
        ],
        files: [
          { name: 'contracts.ts', uri: null },
          { name: 'scanner.ts', uri: null },
        ],
        findings: [],
        messages: [
          { seq: 1, agent: 'coordinator', time: '12:01', text: '@coder Build backend scanner & UI using shared contracts.\n@reviewer Audit each completed slice.' },
        ],
        stats: { totalSubagents: 2, activeSubagents: 1, filesTouched: 2, slicesSent: 0, feedbackRounds: 0, blockers: 0, majors: 0, nits: 0, approvedCount: 0 },
      },
    },
    {
      label: 'Sample 2/2 — Argon verifies all slices and posts [APPROVED]',
      snap: {
        title: 'Duet Sample Preview (No real sessions yet)',
        phase: 'approved',
        coders: [
          {
            name: 'coder',
            model: 'Gemini 4 Carbon (High)',
            status: 'waiting',
            steps: 16,
            activity: 'All feedback resolved & tests green',
            conversationId: null,
            files: [
              { name: 'contracts.ts', uri: null },
              { name: 'scanner.ts', uri: null },
              { name: 'dashboard.ts', uri: null },
            ],
            subagents: [
              { index: 1, role: '@slice-backend', status: 'done', steps: 6, activity: 'Completed slice', files: [{ name: 'scanner.ts', uri: null }] },
              { index: 2, role: '@slice-frontend', status: 'done', steps: 7, activity: 'Completed slice', files: [{ name: 'dashboard.ts', uri: null }] },
            ],
          },
        ],
        reviewers: [
          {
            name: 'reviewer',
            model: 'Gemini 4 Argon (High)',
            status: 'waiting',
            steps: 8,
            activity: 'Posted #3: Verified all slices & tests pass',
            conversationId: null,
            subagents: [],
          },
        ],
        files: [
          { name: 'contracts.ts', uri: null },
          { name: 'scanner.ts', uri: null },
          { name: 'dashboard.ts', uri: null },
        ],
        findings: [
          { id: '3-0', seq: 3, reviewer: 'reviewer', severity: 'APPROVED', summary: 'All slices verified against contracts and unit tests.', resolved: false, time: '12:05' },
        ],
        messages: [
          { seq: 2, agent: 'coder', time: '12:03', text: '@reviewer Milestone 1 ready; all tests pass.' },
          { seq: 3, agent: 'reviewer', time: '12:05', text: '@coordinator [APPROVED] All slices verified against contracts and unit tests.' },
        ],
        stats: { totalSubagents: 2, activeSubagents: 0, filesTouched: 3, slicesSent: 1, feedbackRounds: 0, blockers: 0, majors: 0, nits: 0, approvedCount: 1 },
      },
    },
  ];

  function openConv(convId) {
    if (!convId) return;
    window.sidecar?.ui?.toggleConversation?.(convId);
  }

  function openFile(uri) {
    if (!uri) return;
    window.sidecar?.ui?.toggleAuxPane?.({ tabType: 'fileView', uri });
  }

  function switchTab(tab) {
    state.tab = tab;
    for (const id of ['pipeline', 'findings', 'board']) {
      const btn = $(`tabbtn-${id}`);
      const panel = $(`panel-${id}`);
      const on = id === tab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
      panel.classList.toggle('hidden', !on);
    }
  }

  function jumpToBoardSeq(seq) {
    switchTab('board');
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-post-seq="${CSS.escape(String(seq))}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function renderFileChips(files) {
    if (!files || !files.length) return '';
    return `<div class="file-list">${files
      .map((f) => {
        const attrs = f.uri ? `data-file-uri="${esc(f.uri)}" title="Open ${esc(f.path || f.name)}"` : '';
        return `<button type="button" class="file-chip" ${attrs}>${esc(f.name)}</button>`;
      })
      .join('')}</div>`;
  }

  function renderWorkerList(workers, emptyText) {
    if (!workers || !workers.length) {
      return `<p class="empty-note">${esc(emptyText)}</p>`;
    }
    return workers
      .map((w) => {
        const subHtml =
          w.subagents && w.subagents.length
            ? `<div class="subagent-tree">${w.subagents
                .map(
                  (s) => `
                <div class="subagent-item">
                  <div class="sub-top">
                    <span class="sub-role">${esc(s.role)}</span>
                    <div class="sub-actions">
                      <span class="state-pill" data-status="${esc(s.status)}">${esc(STATUS_LABELS[s.status] || s.status)}</span>
                      ${s.conversationId ? `<button type="button" class="mini-btn" data-open-conv="${esc(s.conversationId)}">Open</button>` : ''}
                    </div>
                  </div>
                  <div class="sub-act">${esc(s.activity || '')}${s.steps ? ` (${s.steps} steps)` : ''}</div>
                  ${renderFileChips(s.files)}
                </div>`
                )
                .join('')}</div>`
            : '';

        return `
          <div class="worker-block">
            <div class="worker-row">
              <div class="worker-ident">
                <div class="worker-name-line">
                  <span class="worker-name">@${esc(w.name)}</span>
                  <span class="model-chip">${esc(w.model)}</span>
                  <span class="state-pill" data-status="${esc(w.status)}">${esc(STATUS_LABELS[w.status] || w.status)}</span>
                </div>
                <div class="activity-line">${esc(w.activity || '')}${w.steps ? ` (${w.steps} steps)` : ''}</div>
              </div>
              ${w.conversationId ? `<button type="button" class="mini-btn" data-open-conv="${esc(w.conversationId)}">Chat</button>` : ''}
            </div>
            ${subHtml}
          </div>`;
      })
      .join('');
  }

  function formatPostBody(text) {
    return esc(text).replace(/@([a-zA-Z0-9][a-zA-Z0-9_-]*)/g, '<span class="mention-tok">@$1</span>');
  }

  function renderSessionBar(snap) {
    const bar = $('session-bar');
    const list = snap.availableSwarms || [];
    if (!list.length || state.demoMode) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');

    const select = $('swarm-select');
    const optionsKey = list
      .map((s) => `${s.id}:${s.title}:${s.isCurrent ? 1 : 0}:${s.isLive ? 1 : 0}:${s.messageCount}`)
      .join('|');

    if (optionsKey !== state.lastOptionsKey) {
      state.lastOptionsKey = optionsKey;
      select.innerHTML = list
        .map((s) => {
          const tags = [];
          if (s.isCurrent) tags.push('This chat');
          else if (s.isLive) tags.push('Live');
          const prefix = tags.length ? `[${tags.join(' · ')}] ` : '';
          return `<option value="${esc(s.id)}">${esc(prefix + s.title)} (${s.messageCount} posts)</option>`;
        })
        .join('');
    }
    if (snap.swarm && select.value !== snap.swarm) {
      select.value = snap.swarm;
    }

    const activeMeta = list.find((s) => s.id === snap.swarm);
    const scopeTag = $('session-scope-tag');
    if (activeMeta?.isCurrent) {
      scopeTag.textContent = 'This chat';
      scopeTag.dataset.scope = 'current';
    } else if (activeMeta?.isLive) {
      scopeTag.textContent = 'Active session';
      scopeTag.dataset.scope = 'live';
    } else {
      scopeTag.textContent = 'Saved session';
      scopeTag.dataset.scope = 'saved';
    }

    const coordBtn = $('btn-open-coord');
    if (snap.swarm) {
      coordBtn.dataset.openConv = snap.swarm;
      coordBtn.classList.remove('hidden');
    } else {
      coordBtn.classList.add('hidden');
    }
  }

  function renderSnapshot(snap) {
    $('standby-view').classList.add('hidden');
    $('dashboard-view').classList.remove('hidden');

    renderSessionBar(snap);

    $('duet-title').textContent = snap.title || 'Duet Session';
    const phase = snap.phase || 'idle';
    $('phase-badge').dataset.phase = phase;
    $('phase-label').textContent = PHASE_LABELS[phase] || phase;

    const st = snap.stats || {};
    const openIssues = (st.blockers || 0) + (st.majors || 0) + (st.nits || 0);
    $('kpi-subagents').textContent = String(st.totalSubagents || 0);
    $('kpi-files').textContent = String(st.filesTouched || 0);
    $('kpi-issues').textContent = String(openIssues);
    $('kpi-slices').textContent = String(st.slicesSent || 0);

    $('metric-slices').textContent = String(st.slicesSent || 0);
    $('metric-loops').textContent = String(st.feedbackRounds || 0);

    $('coders-list').innerHTML = renderWorkerList(snap.coders, 'No coder worker registered yet.');
    $('reviewers-list').innerHTML = renderWorkerList(snap.reviewers, 'No reviewer worker registered yet.');

    if (snap.files && snap.files.length) {
      $('files-footer').classList.remove('hidden');
      $('all-files-list').innerHTML = snap.files
        .slice(0, 36)
        .map((f) => {
          const attrs = f.uri ? `data-file-uri="${esc(f.uri)}" title="Open ${esc(f.path || f.name)}"` : '';
          return `<button type="button" class="file-chip" ${attrs}>${esc(f.name)}</button>`;
        })
        .join('');
    } else {
      $('files-footer').classList.add('hidden');
    }

    $('gate-blocker').textContent = String(st.blockers || 0);
    $('gate-major').textContent = String(st.majors || 0);
    $('gate-nit').textContent = String(st.nits || 0);
    $('gate-approved').textContent = String(st.approvedCount || 0);

    const findings = snap.findings || [];
    $('cnt-findings').textContent = String(findings.length);
    const filtered = state.sevFilter === 'ALL' ? findings : findings.filter((f) => f.severity === state.sevFilter);
    $('findings-list').innerHTML = filtered.length
      ? filtered
          .slice()
          .reverse()
          .map(
            (f) => `
          <article class="finding-card">
            <div class="finding-head">
              <div class="finding-meta">
                <span class="sev-badge" data-sev="${esc(f.severity)}">${esc(f.severity)}</span>
                <span class="meta-muted">@${esc(f.reviewer)}</span>
                ${f.resolved ? '<span class="resolved-tag">Resolved</span>' : ''}
              </div>
              <button type="button" class="seq-btn" data-jump-seq="${esc(f.seq)}">#${esc(f.seq)}</button>
            </div>
            <p class="finding-body">${esc(f.summary)}</p>
          </article>`
          )
          .join('')
      : '<p class="empty-note">No review findings matching this filter yet.</p>';

    const messages = snap.messages || [];
    $('cnt-board').textContent = String(messages.length);
    $('board-list').innerHTML = messages.length
      ? messages
          .slice()
          .reverse()
          .map(
            (m) => `
          <article class="post-card" data-post-seq="${esc(m.seq)}">
            <div class="post-head">
              <span class="worker-name">@${esc(m.agent)}</span>
              <span class="meta-muted">#${esc(m.seq)}${m.time ? ` · ${esc(m.time)}` : ''}</span>
            </div>
            <p class="post-body">${formatPostBody(m.text)}</p>
          </article>`
          )
          .join('')
      : '<p class="empty-note">No board messages posted yet.</p>';
  }

  function renderDemo() {
    const cur = DEMO_STAGES[state.demoStage];
    $('demo-bar').classList.remove('hidden');
    $('demo-step-label').textContent = cur.label;
    renderSnapshot(cur.snap);
  }

  // Event Delegation
  document.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.tab-btn[data-tab]');
    if (tabBtn) {
      switchTab(tabBtn.dataset.tab);
      return;
    }
    const sevBtn = e.target.closest('[data-sev-filter]');
    if (sevBtn) {
      state.sevFilter = sevBtn.dataset.sevFilter;
      document.querySelectorAll('[data-sev-filter]').forEach((b) => b.classList.toggle('active', b === sevBtn));
      if (state.demoMode) renderDemo();
      else if (state.snap) renderSnapshot(state.snap);
      return;
    }
    const convBtn = e.target.closest('[data-open-conv]');
    if (convBtn) {
      openConv(convBtn.dataset.openConv);
      return;
    }
    const fileBtn = e.target.closest('[data-file-uri]');
    if (fileBtn) {
      openFile(fileBtn.dataset.fileUri);
      return;
    }
    const seqBtn = e.target.closest('[data-jump-seq]');
    if (seqBtn) {
      jumpToBoardSeq(seqBtn.dataset.jumpSeq);
    }
  });

  $('swarm-select').addEventListener('change', (e) => {
    state.selectedSwarmId = e.target.value || '';
    state.etag = '';
    triggerPollImmediate();
  });

  $('btn-start-demo').addEventListener('click', () => {
    state.demoMode = true;
    state.demoStage = 0;
    renderDemo();
  });

  $('btn-demo-next').addEventListener('click', () => {
    state.demoStage = (state.demoStage + 1) % DEMO_STAGES.length;
    renderDemo();
  });

  $('btn-demo-exit').addEventListener('click', () => {
    state.demoMode = false;
    $('demo-bar').classList.add('hidden');
    if (state.snap) {
      renderSnapshot(state.snap);
    } else {
      $('dashboard-view').classList.add('hidden');
      $('standby-view').classList.remove('hidden');
    }
  });

  // Live Polling Loop
  const currentConv = () => window.sidecar?.conversationId || params.get('conversationId') || '';

  function triggerPollImmediate() {
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
    poll();
  }

  async function poll() {
    const conv = currentConv();
    if (conv && conv !== state.lastHostConv) {
      if (state.lastHostConv) {
        // User switched chat tabs — allow auto-following if the new tab owns a swarm
        state.selectedSwarmId = '';
        state.etag = '';
      }
      state.lastHostConv = conv;
    }

    let nextDelay = POLL_IDLE_MS;
    try {
      const f = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
      const qs = new URLSearchParams();
      if (conv) qs.set('conversationId', conv);
      if (state.selectedSwarmId) qs.set('swarmId', state.selectedSwarmId);
      if (state.etag) qs.set('etag', state.etag);

      const res = await f(`/api/duet?${qs.toString()}`, { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        if (!data.swarm) {
          state.etag = '';
          state.snap = null;
          if (!state.demoMode) {
            $('dashboard-view').classList.add('hidden');
            $('standby-view').classList.remove('hidden');
          }
        } else {
          nextDelay = POLL_LIVE_MS;
          if (state.demoMode) {
            state.demoMode = false;
            $('demo-bar').classList.add('hidden');
          }
          if (!data.unchanged) {
            state.etag = data.etag || '';
            state.snap = data;
            renderSnapshot(data);
          } else if (state.snap && data.availableSwarms) {
            state.snap.availableSwarms = data.availableSwarms;
            renderSessionBar(state.snap);
          }
        }
      }
    } catch {
      // Keep current state quietly during transient restarts
    }
    state.pollTimer = setTimeout(poll, nextDelay);
  }

  poll();
})();
