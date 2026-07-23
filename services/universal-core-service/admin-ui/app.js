(function () {
  const login = document.getElementById('login-screen');
  const app = document.getElementById('app');
  const title = document.getElementById('view-title');
  const loginMessage = document.getElementById('login-message');
  let csrfToken = null;
  const labels = { overview: 'Panoramica operativa', map: 'Mappa del sistema', agents: 'Agenti & provider', branches: 'Rami & flussi', keys: 'Chiavi & accessi', decisions: 'Decision ledger', audit: 'Audit trail' };
  async function request(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options && options.headers ? options.headers : {}), ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'request_failed');
    return body;
  }
  function reveal() { login.classList.add('hidden'); app.classList.remove('hidden'); }
  function hide() { app.classList.add('hidden'); login.classList.remove('hidden'); }
  function number(id, value) { const node = document.getElementById(id); if (node) node.textContent = String(value == null ? '—' : value); }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
  function renderAudit(events) {
    const root = document.getElementById('audit-list');
    if (!root) return;
    root.innerHTML = events.length ? events.map((event) => `<div><time>${escapeHtml(event.created_at || '—')}</time><span class="badge neutral">${escapeHtml(event.event_type || 'event')}</span><b>${escapeHtml(event.actor || event.tenant_id || 'system')}</b><p>${escapeHtml(event.key_id || event.path || event.error || 'evento registrato')}</p></div>`).join('') : '<div><p>Nessun evento disponibile per il perimetro selezionato.</p></div>';
  }
  async function loadOverview() {
    const data = await request('/admin/api/overview');
    const overview = data.overview || {};
    number('metric-agents', Array.isArray(overview.agents && overview.agents.agents) ? overview.agents.agents.length : '—');
    number('metric-branches', overview.nyra && overview.nyra.branches);
    number('metric-keys', overview.keys && overview.keys.active);
    number('metric-tenants', overview.tenants && overview.tenants.active);
    renderAudit(data.audit || []);
  }
  function showView(id) {
    document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === id));
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === id));
    title.textContent = labels[id];
    document.querySelector('.sidebar').classList.remove('open');
  }
  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    loginMessage.textContent = 'Verifica accesso…';
    try {
      const data = await request('/admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) });
      csrfToken = data.csrf_token;
      reveal();
      await loadOverview();
    } catch (error) {
      loginMessage.textContent = error.message === 'admin_bootstrap_required' ? 'Configurazione owner iniziale non disponibile.' : 'Accesso non riuscito. Riprova.';
    }
  });
  document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', () => showView(item.dataset.view)));
  document.querySelectorAll('[data-go]').forEach((item) => item.addEventListener('click', () => showView(item.dataset.go)));
  document.getElementById('menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
  document.getElementById('sign-out').addEventListener('click', async () => { try { await request('/admin/api/logout', { method: 'POST' }); } catch (_) {} csrfToken = null; hide(); });
  (async () => { try { const data = await request('/admin/api/bootstrap'); if (data.authenticated) { csrfToken = data.csrf_token; reveal(); await loadOverview(); } else if (!data.configured) loginMessage.textContent = 'Owner iniziale da configurare sul server.'; } catch (_) { loginMessage.textContent = 'Control Room non disponibile.'; } }());
}());
