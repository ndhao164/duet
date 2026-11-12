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
    demoMode: false,
    demoStage: 0,
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

  // Realistic 4-stage interactive demo so users can test-drive every tab immediately
  const DEMO_STAGES = [
    {
      label: 'Stage 1/4 — Carbon Lead Coder locks shared contracts & spawns 3 parallel subagents',
      snap: {
        title: 'Duet: JWT Auth & Session Store (Demo)',
        phase: 'building',
        coders: [
          {
            name: 'coder',
            model: 'Gemini 4 Carbon (High)',
            status: 'working',
            steps: 9,
            activity: 'Coordinating 3 parallel subagents across auth slices',
            conversationId: null,
            files: [
              { name: 'auth.types.ts', path: 'src/auth/auth.types.ts', uri: null },
              { name: 'jwt.service.ts', path: 'src/auth/jwt.service.ts', uri: null },
              { name: 'session.store.ts', path: 'src/auth/session.store.ts', uri: null },
            ],
            subagents: [
              {
                index: 1,
                role: 'JWT Token Signer Author',
                status: 'done',
                steps: 6,
                activity: 'Write jwt.service.ts',
                files: [{ name: 'jwt.service.ts', uri: null }],
              },
              {
                index: 2,
                role: 'Redis Session Store Author',
                status: 'working',
                steps: 4,
                activity: 'Edit session.store.ts',
                files: [{ name: 'session.store.ts', uri: null }],
              },
              {
                index: 3,
                role: 'Express Auth Middleware Author',
                status: 'working',
                steps: 3,
                activity: 'Write auth.middleware.ts',
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
          { name: 'auth.types.ts', uri: null },
          { name: 'jwt.service.ts', uri: null },
          { name: 'session.store.ts', uri: null },
        ],
        findings: [],
        messages: [
          { seq: 1, agent: 'coordinator', time: '12:01', text: '@coder Build JWT service, session store, and middleware using shared contracts.\n@reviewer Audit each completed slice for security and edge cases.' },
          { seq: 2, agent: 'coder', time: '12:02', text: 'Phase 1 complete: locked shared interfaces in src/auth/auth.types.ts. Spawning 3 parallel Carbon subagents for disjoint modules.' },
        ],
        stats: { totalSubagents: 3, activeSubagents: 2, filesTouched: 3, slicesSent: 0, feedbackRounds: 0, blockers: 0, majors: 0, nits: 0, approvedCount: 0 },
      },
    },
    {
      label: 'Stage 2/4 — Slice 1 streamed to Argon Reviewer while Carbon starts integration tests',
      snap: {
        title: 'Duet: JWT Auth & Session Store (Demo)',
        phase: 'reviewing',
        coders: [
          {
            name: 'coder',
            model: 'Gemini 4 Carbon (High)',
            status: 'working',
            steps: 15,
            activity: 'Write auth.integration.test.ts (Milestone 2)',
            conversationId: null,
            files: [
              { name: 'auth.types.ts', uri: null },
              { name: 'jwt.service.ts', uri: null },
              { name: 'session.store.ts', uri: null },
              { name: 'auth.middleware.ts', uri: null },
              { name: 'auth.integration.test.ts', uri: null },
            ],
            subagents: [
              { index: 1, role: 'JWT Token Signer Author', status: 'done', steps: 6, activity: 'Completed slice', files: [{ name: 'jwt.service.ts', uri: null }] },
              { index: 2, role: 'Redis Session Store Author', status: 'done', steps: 7, activity: 'Completed slice', files: [{ name: 'session.store.ts', uri: null }] },
              { index: 3, role: 'Express Auth Middleware Author', status: 'done', steps: 5, activity: 'Completed slice', files: [{ name: 'auth.middleware.ts', uri: null }] },
            ],
          },
        ],
        reviewers: [
          {
            name: 'reviewer',
            model: 'Gemini 4 Argon (High)',
            status: 'working',
            steps: 6,
            activity: 'Auditing jwt.service.ts & session.store.ts + running typecheck',
            conversationId: null,
            subagents: [
              { index: 1, role: 'Crypto & Token Claims Auditor', status: 'working', steps: 3, activity: 'Read jwt.service.ts', files: [] },
            ],
          },
        ],
        files: [
          { name: 'auth.types.ts', uri: null },
          { name: 'jwt.service.ts', uri: null },
          { name: 'session.store.ts', uri: null },
          { name: 'auth.middleware.ts', uri: null },
          { name: 'auth.integration.test.ts', uri: null },
        ],
        findings: [],
        messages: [
          { seq: 1, agent: 'coordinator', time: '12:01', text: '@coder Build JWT service, session store, and middleware.\n@reviewer Audit each completed slice.' },
          { seq: 3, agent: 'coder', time: '12:03', text: '@reviewer Milestone 1 ready (auth.types.ts, jwt.service.ts, session.store.ts, auth.middleware.ts). tsc --noEmit passed. Continuing to Milestone 2 tests in parallel.' },
        ],
        stats: { totalSubagents: 3, activeSubagents: 0, filesTouched: 5, slicesSent: 1, feedbackRounds: 0, blockers: 0, majors: 0, nits: 0, approvedCount: 0 },
      },
    },
    {
      label: 'Stage 3/4 — Argon flags 1 [MAJOR] security issue & 1 [NIT]; Carbon fixes immediately',
      snap: {
        title: 'Duet: JWT Auth & Session Store (Demo)',
        phase: 'fixing',
        coders: [
          {
            name: 'coder',
            model: 'Gemini 4 Carbon (High)',
            status: 'working',
            steps: 19,
            activity: 'Edit jwt.service.ts (pinning algorithms: ["HS256"] & clockTolerance)',
            conversationId: null,
            files: [
              { name: 'auth.types.ts', uri: null },
              { name: 'jwt.service.ts', uri: null },
              { name: 'session.store.ts', uri: null },
              { name: 'auth.middleware.ts', uri: null },
              { name: 'auth.integration.test.ts', uri: null },
            ],
            subagents: [
              { index: 1, role: 'JWT Token Signer Author', status: 'done', steps: 6, activity: 'Completed slice', files: [{ name: 'jwt.service.ts', uri: null }] },
              { index: 2, role: 'Redis Session Store Author', status: 'done', steps: 7, activity: 'Completed slice', files: [{ name: 'session.store.ts', uri: null }] },
              { index: 3, role: 'Express Auth Middleware Author', status: 'done', steps: 5, activity: 'Completed slice', files: [{ name: 'auth.middleware.ts', uri: null }] },
            ],
          },
        ],
        reviewers: [
          {
            name: 'reviewer',
            model: 'Gemini 4 Argon (High)',
            status: 'waiting',
            steps: 9,
            activity: 'Posted findings in #4; waiting for @coder fix',
            conversationId: null,
            subagents: [],
          },
        ],
        files: [
          { name: 'auth.types.ts', uri: null },
          { name: 'jwt.service.ts', uri: null },
          { name: 'session.store.ts', uri: null },
          { name: 'auth.middleware.ts', uri: null },
          { name: 'auth.integration.test.ts', uri: null },
        ],
        findings: [
          { id: '4-0', seq: 4, reviewer: 'reviewer', severity: 'MAJOR', summary: 'jwt.verify() in jwt.service.ts omits explicit algorithms allowlist — pin algorithms: ["HS256"] to block alg confusion.', resolved: false, time: '12:04' },
          { id: '4-1', seq: 4, reviewer: 'reviewer', severity: 'NIT', summary: 'Unref cleanup timer in InMemorySessionStore so test runner exits without --forceExit.', resolved: false, time: '12:04' },
        ],
        messages: [
          { seq: 3, agent: 'coder', time: '12:03', text: '@reviewer Milestone 1 & 2 ready. All 14 unit + integration tests pass.' },
          { seq: 4, agent: 'reviewer', time: '12:04', text: '@coder Reviewed #3:\n- [MAJOR] jwt.verify() in jwt.service.ts omits explicit algorithms allowlist — pin algorithms: ["HS256"] to block alg confusion.\n- [NIT] Unref cleanup timer in InMemorySessionStore so test runner exits cleanly.' },
        ],
        stats: { totalSubagents: 3, activeSubagents: 0, filesTouched: 5, slicesSent: 1, feedbackRounds: 1, blockers: 0, majors: 1, nits: 1, approvedCount: 0 },
      },
    },
    {
      label: 'Stage 4/4 — Argon re-verifies diff & test suite -> [APPROVED] sent to Coordinator',
      snap: {
        title: 'Duet: JWT Auth & Session Store (Demo)',
        phase: 'approved',
        coders: [
          {
            name: 'coder',
            model: 'Gemini 4 Carbon (High)',
            status: 'waiting',
            steps: 22,
            activity: 'All feedback resolved & tests green',
            conversationId: null,
            files: [
              { name: 'auth.types.ts', uri: null },
              { name: 'jwt.service.ts', uri: null },
              { name: 'session.store.ts', uri: null },
              { name: 'auth.middleware.ts', uri: null },
              { name: 'auth.integration.test.ts', uri: null },
            ],
            subagents: [
              { index: 1, role: 'JWT Token Signer Author', status: 'done', steps: 6, activity: 'Completed slice', files: [{ name: 'jwt.service.ts', uri: null }] },
              { index: 2, role: 'Redis Session Store Author', status: 'done', steps: 7, activity: 'Completed slice', files: [{ name: 'session.store.ts', uri: null }] },
              { index: 3, role: 'Express Auth Middleware Author', status: 'done', steps: 5, activity: 'Completed slice', files: [{ name: 'auth.middleware.ts', uri: null }] },
            ],
          },
        ],
        reviewers: [
          {
            name: 'reviewer',
            model: 'Gemini 4 Argon (High)',
            status: 'waiting',
            steps: 12,
            activity: 'Signed off [APPROVED] in #6',
            conversationId: null,
            subagents: [],
          },
        ],
        files: [
          { name: 'auth.types.ts', uri: null },
          { name: 'jwt.service.ts', uri: null },
          { name: 'session.store.ts', uri: null },
          { name: 'auth.middleware.ts', uri: null },
          { name: 'auth.integration.test.ts', uri: null },
        ],
        findings: [
          { id: '4-0', seq: 4, reviewer: 'reviewer', severity: 'MAJOR', summary: 'jwt.verify() in jwt.service.ts omits explicit algorithms allowlist — pin algorithms: ["HS256"].', resolved: true, time: '12:04' },
          { id: '4-1', seq: 4, reviewer: 'reviewer', severity: 'NIT', summary: 'Unref cleanup timer in InMemorySessionStore so test runner exits cleanly.', resolved: true, time: '12:04' },
          { id: '6-2', seq: 6, reviewer: 'reviewer', severity: 'APPROVED', summary: 'Verified #5: HS256 algorithm allowlist enforced, timer unref added, 16/16 tests pass.', resolved: false, time: '12:05' },
        ],
        messages: [
          { seq: 4, agent: 'reviewer', time: '12:04', text: '@coder Reviewed #3:\n- [MAJOR] Pin algorithms: ["HS256"] in jwt.verify().\n- [NIT] Unref cleanup timer in InMemorySessionStore.' },
          { seq: 5, agent: 'coder', time: '12:05', text: '@reviewer Fixed both items from #4 and added regression test for alg mismatch (16/16 passing).' },
          { seq: 6, agent: 'reviewer', time: '12:05', text: '@coordinator [APPROVED] Verified #5: HS256 algorithm allowlist enforced, timer unref added, 16/16 tests pass.' },
        ],
        stats: { totalSubagents: 3, activeSubagents: 0, filesTouched: 5, slicesSent: 2, feedbackRounds: 1, blockers: 0, majors: 0, nits: 0, approvedCount: 1 },
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
                    <div style="display:flex;align-items:center;gap:5px">
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

  function renderSnapshot(snap) {
    $('standby-view').classList.add('hidden');
    $('dashboard-view').classList.remove('hidden');

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
              <div style="display:flex;align-items:center;gap:6px">
                <span class="sev-badge" data-sev="${esc(f.severity)}">${esc(f.severity)}</span>
                <span style="font-size:11.5px;color:var(--du-fg-muted)">@${esc(f.reviewer)}</span>
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
              <span style="font-size:11px;color:var(--du-fg-muted)">#${esc(m.seq)}${m.time ? ` · ${esc(m.time)}` : ''}</span>
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

  async function poll() {
    const conv = currentConv();
    let nextDelay = POLL_IDLE_MS;
    try {
      const f = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
      const qs = new URLSearchParams();
      if (conv) qs.set('conversationId', conv);
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
          // Auto-switch out of demo the instant a real swarm starts in this conversation!
          if (state.demoMode) {
            state.demoMode = false;
            $('demo-bar').classList.add('hidden');
          }
          if (!data.unchanged) {
            state.etag = data.etag || '';
            state.snap = data;
            renderSnapshot(data);
          }
        }
      }
    } catch {
      // Keep current state quietly during transient restarts
    }
    setTimeout(poll, nextDelay);
  }

  poll();
})();
