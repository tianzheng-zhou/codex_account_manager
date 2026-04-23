/* ============================================================
   Codex Account Manager — Frontend Logic
   ============================================================ */

const API = '/api';
let debounceTimer = null;
let currentView = 'dashboard';
let currentShop = null;
let currentUser = null;

const SHOP_VIEW_MAP = {
  'shop:gpt-cw': { shop: 'gpt-cw', elId: 'viewShopGptCw' },
};

// ---- Auth helpers ----
function getToken() { return localStorage.getItem('token'); }
function setToken(t) { localStorage.setItem('token', t); }
function clearToken() { localStorage.removeItem('token'); }

function authHeaders() {
  const t = getToken();
  const h = {};
  if (t) h['Authorization'] = 'Bearer ' + t;
  // Admin privacy toggle — send only when explicitly in "user" view mode.
  if (currentUser && currentUser.role === 'admin' && localStorage.getItem('adminViewMode') === 'user') {
    h['X-Admin-View'] = 'user';
  }
  return h;
}

async function authFetch(url, opts = {}) {
  opts.headers = { ...authHeaders(), ...(opts.headers || {}) };
  const resp = await fetch(url, opts);
  if (resp.status === 401) {
    clearToken();
    currentUser = null;
    showAuthScreen();
  }
  return resp;
}

// ---- Auth Screen ----
function showAuthScreen() {
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('appLayout').style.display = 'none';
}

function showAppScreen() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appLayout').style.display = '';
}

function showAuthTab(tab) {
  document.getElementById('authLogin').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('authRegister').style.display = tab === 'register' ? '' : 'none';
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const msg = document.getElementById('loginMsg');
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  btn.disabled = true;
  msg.style.display = 'none';

  try {
    const resp = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json();
    if (resp.ok) {
      setToken(data.access_token);
      await initApp();
    } else {
      msg.textContent = data.detail || '登录失败';
      msg.className = 'auth-msg error';
      msg.style.display = 'block';
    }
  } catch {
    msg.textContent = '网络错误';
    msg.className = 'auth-msg error';
    msg.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('regBtn');
  const msg = document.getElementById('regMsg');
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const password2 = document.getElementById('regPassword2').value;
  const invite_code = document.getElementById('regInviteCode').value.trim() || null;

  if (password !== password2) {
    msg.textContent = '两次密码不一致';
    msg.className = 'auth-msg error';
    msg.style.display = 'block';
    return;
  }

  btn.disabled = true;
  msg.style.display = 'none';

  try {
    const resp = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, invite_code }),
    });
    const data = await resp.json();
    if (resp.ok) {
      if (data.is_approved) {
        msg.textContent = '注册成功，请登录';
        msg.className = 'auth-msg success';
      } else {
        msg.textContent = '注册成功，请等待管理员审核后登录';
        msg.className = 'auth-msg success';
      }
      msg.style.display = 'block';
    } else {
      msg.textContent = data.detail || '注册失败';
      msg.className = 'auth-msg error';
      msg.style.display = 'block';
    }
  } catch {
    msg.textContent = '网络错误';
    msg.className = 'auth-msg error';
    msg.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}

function handleLogout() {
  clearToken();
  currentUser = null;
  showAuthScreen();
}

async function initApp() {
  try {
    const resp = await authFetch(`${API}/auth/me`);
    if (!resp.ok) { showAuthScreen(); return; }
    currentUser = await resp.json();
  } catch {
    showAuthScreen();
    return;
  }

  showAppScreen();

  // sidebar
  const saved = localStorage.getItem('sidebarCollapsed');
  if (saved === 'true') {
    document.getElementById('sidebar').classList.add('collapsed');
    updateToggleIcon();
  }

  document.getElementById('sidebarUsername').textContent = currentUser.username;
  document.getElementById('adminNav').style.display = currentUser.role === 'admin' ? '' : 'none';
  updateAdminViewToggleUI();

  applyRoleUI();
  bindDelegatedHandlers();
  switchView('dashboard');
  lucide.createIcons();
}

// ---- Delegated click handlers (safer than inline onclick) ----
let _delegationBound = false;
function bindDelegatedHandlers() {
  if (_delegationBound) return;
  _delegationBound = true;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id ? Number(btn.dataset.id) : null;

    switch (action) {
      case 'copy': {
        const v = btn.dataset.value || '';
        copyText(v, btn);
        break;
      }
      case 'edit': {
        const a = window.__accountCache && window.__accountCache[id];
        if (a) openEditModal(a);
        break;
      }
      case 'archive': {
        toggleArchive(id, btn.dataset.status);
        break;
      }
      case 'delete': {
        confirmDelete(id);
        break;
      }
      case 'share': {
        openShareModal(id);
        break;
      }
      case 'fetch-code': {
        fetchCode(id);
        break;
      }
      case 'claim': {
        openClaimModal(id);
        break;
      }
      case 'approve-user': {
        approveUser(id);
        break;
      }
      case 'delete-user': {
        deleteUser(id, btn.dataset.username || '');
        break;
      }
      case 'delete-invite': {
        deleteInviteCode(id);
        break;
      }
      case 'remove-share': {
        const accId = Number(btn.dataset.accountId);
        removeShare(accId, id);
        break;
      }
      default:
        break;
    }
  });
}

function applyRoleUI() {
  const isAdminEff = effectiveIsAdmin();
  const isAdminRaw = currentUser && currentUser.role === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdminRaw ? '' : 'none';
  });
  // Hide option[data-admin-only] when effective role is not admin.
  document.querySelectorAll('option[data-admin-only]').forEach(el => {
    el.hidden = !isAdminEff;
    if (!isAdminEff && el.selected) {
      const select = el.closest('select');
      if (select) { select.value = ''; }
    }
  });
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  if (getToken()) {
    initApp();
  } else {
    showAuthScreen();
  }
  lucide.createIcons();
});

// ---- Sidebar ----
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed');
  localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
  updateToggleIcon();
}

function updateToggleIcon() {
  const sidebar = document.getElementById('sidebar');
  const icon = document.getElementById('toggleIcon');
  const isCollapsed = sidebar.classList.contains('collapsed');
  icon.setAttribute('data-lucide', isCollapsed ? 'panel-left-open' : 'panel-left-close');
  lucide.createIcons({ nodes: [icon] });
  const label = icon.closest('.nav-item')?.querySelector('.nav-label');
  if (label) label.textContent = isCollapsed ? '展开' : '收起';
}

// ---- View Switching ----
function switchView(view) {
  currentView = view;

  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  document.getElementById('viewDashboard').style.display = view === 'dashboard' ? 'block' : 'none';
  Object.entries(SHOP_VIEW_MAP).forEach(([key, cfg]) => {
    document.getElementById(cfg.elId).style.display = view === key ? 'block' : 'none';
  });
  document.getElementById('viewUsers').style.display = view === 'users' ? 'block' : 'none';
  document.getElementById('viewInvites').style.display = view === 'invites' ? 'block' : 'none';

  if (view === 'dashboard') {
    currentShop = null;
    loadStats();
  } else if (SHOP_VIEW_MAP[view]) {
    currentShop = SHOP_VIEW_MAP[view].shop;
    loadShopStats();
    loadAccounts();
  } else if (view === 'users') {
    loadUsers();
  } else if (view === 'invites') {
    loadInviteCodes();
  }
}

// ---- Toast ----
function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ---- Copy to Clipboard ----
function copyText(text, btnEl) {
  const doCopy = () => {
    if (btnEl) {
      const origHTML = btnEl.innerHTML;
      btnEl.innerHTML = '<i data-lucide="check"></i>';
      btnEl.style.color = 'var(--color-success)';
      lucide.createIcons({ nodes: btnEl.querySelectorAll('[data-lucide]') });
      setTimeout(() => {
        btnEl.innerHTML = origHTML;
        btnEl.style.color = '';
        lucide.createIcons({ nodes: btnEl.querySelectorAll('[data-lucide]') });
      }, 1500);
    }
    showToast('已复制', 'success');
  };

  navigator.clipboard.writeText(text).then(doCopy).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    doCopy();
  });
}

// ---- Stats ----
function renderStatsHTML(data) {
  return `
    <div class="stat-card">
      <p class="stat-label">总数</p>
      <p class="stat-value">${data.total}</p>
    </div>
    <div class="stat-card accent">
      <p class="stat-label">Team</p>
      <p class="stat-value">${data.team}</p>
    </div>
    <div class="stat-card">
      <p class="stat-label">Plus</p>
      <p class="stat-value">${data.plus}</p>
    </div>
    <div class="stat-card success">
      <p class="stat-label">可用</p>
      <p class="stat-value">${data.available}</p>
    </div>
    <div class="stat-card warning">
      <p class="stat-label">已归档</p>
      <p class="stat-value">${data.archived}</p>
    </div>
  `;
}

async function loadStats() {
  try {
    const resp = await authFetch(`${API}/stats`);
    const data = await resp.json();
    document.getElementById('statsRow').innerHTML = renderStatsHTML(data);
  } catch (e) {
    console.error('Failed to load stats:', e);
  }
}

async function loadShopStats() {
  if (!currentShop) return;
  try {
    const resp = await authFetch(`${API}/stats?shop=${currentShop}`);
    const data = await resp.json();
    document.getElementById('shopStatsRow').innerHTML = renderStatsHTML(data);
  } catch (e) {
    console.error('Failed to load shop stats:', e);
  }
}

// ---- Account List ----
function debounceLoad() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadAccounts, 300);
}

async function loadAccounts() {
  const searchEl = document.getElementById('searchInput');
  const typeEl = document.getElementById('typeFilter');
  const statusEl = document.getElementById('statusFilter');
  const scopeEl = document.getElementById('scopeFilter');
  if (!searchEl || !typeEl || !statusEl) return;

  const search = searchEl.value.trim();
  const type = typeEl.value;
  const status = statusEl.value;
  const scope = scopeEl ? scopeEl.value : '';

  const params = new URLSearchParams();
  if (currentShop) params.set('shop', currentShop);
  if (search) params.set('search', search);
  if (type) params.set('account_type', type);
  if (status) params.set('status', status);
  if (scope) params.set('scope', scope);

  try {
    const resp = await authFetch(`${API}/accounts?${params}`);
    const accounts = await resp.json();
    renderAccounts(accounts);
  } catch (e) {
    console.error('Failed to load accounts:', e);
  }
}

function renderAccounts(accounts) {
  const list = document.getElementById('accountList');
  const empty = document.getElementById('emptyState');

  if (accounts.length === 0) {
    list.innerHTML = '';
    list.appendChild(createEmptyState());
    lucide.createIcons({ nodes: list.querySelectorAll('[data-lucide]') });
    return;
  }

  const isAdmin = effectiveIsAdmin();
  const accountCache = {};
  accounts.forEach(a => { accountCache[a.id] = a; });
  window.__accountCache = accountCache;

  list.innerHTML = accounts.map(a => {
    const relation = a.relation || 'owner';
    const canEdit = relation === 'owner' || relation === 'admin' || relation === 'orphan';
    const canShare = canEdit; // owner or admin
    const canDelete = isAdmin;
    const safeType = escapeHtml(a.account_type);
    const statusKey = escapeAttr(a.status);
    const safeUrlForHref = safeUrl(a.code_url);
    const shortUrl = safeUrlForHref ? escapeHtml(truncate(safeUrlForHref, 40)) : '';
    const relLabel = relationLabel(relation);

    return `
    <div class="account-card" data-id="${a.id}">
      <div class="card-top">
        <div class="card-badges">
          <span class="badge badge-${escapeAttr(a.account_type.toLowerCase())}">${safeType}</span>
          <span class="badge badge-${statusKey}">${escapeHtml(statusLabel(a.status))}</span>
          ${relLabel ? `<span class="badge badge-rel-${escapeAttr(relation)}">${escapeHtml(relLabel)}</span>` : ''}
          ${a.owner_username && relation !== 'owner' ? `<span class="ds-meta">拥有者：${escapeHtml(a.owner_username)}</span>` : ''}
          <span class="ds-meta" style="margin-left:var(--space-2);">${escapeHtml(a.redeem_key)}</span>
        </div>
        <div class="card-actions">
          ${canEdit ? `<button class="btn-icon" title="编辑" data-action="edit" data-id="${a.id}">
            <i data-lucide="pencil"></i>
          </button>` : ''}
          ${canEdit ? `<button class="btn-icon" title="${a.status === 'archived' ? '取消归档' : '归档'}" data-action="archive" data-id="${a.id}" data-status="${statusKey}">
            <i data-lucide="${a.status === 'archived' ? 'archive-restore' : 'archive'}"></i>
          </button>` : ''}
          ${canShare ? `<button class="btn-icon" title="共享/转让" data-action="share" data-id="${a.id}">
            <i data-lucide="share-2"></i>
          </button>` : ''}
          ${canDelete ? `<button class="btn-icon" title="删除" data-action="delete" data-id="${a.id}">
            <i data-lucide="trash-2"></i>
          </button>` : ''}
        </div>
      </div>
      <div class="card-fields">
        <div class="field">
          <span class="field-label">邮箱</span>
          <span class="field-value">
            <span>${escapeHtml(a.email)}</span>
            <button class="copy-btn" data-action="copy" data-value="${escapeAttr(a.email)}"><i data-lucide="copy"></i></button>
          </span>
        </div>
        <div class="field">
          <span class="field-label">密码</span>
          <span class="field-value">
            <span>${escapeHtml(a.password)}</span>
            <button class="copy-btn" data-action="copy" data-value="${escapeAttr(a.password)}"><i data-lucide="copy"></i></button>
          </span>
        </div>
        <div class="field">
          <span class="field-label">收码链接</span>
          <span class="field-value">
            ${safeUrlForHref
              ? `<a href="${escapeAttr(safeUrlForHref)}" target="_blank" rel="noopener noreferrer">${shortUrl}</a>
                 <button class="copy-btn" data-action="copy" data-value="${escapeAttr(safeUrlForHref)}"><i data-lucide="copy"></i></button>`
              : (a.code_url ? `<span style="color:var(--color-danger)">(无效链接)</span>` : '<span style="color:var(--fg-3)">—</span>')
            }
          </span>
        </div>
      </div>
      <div class="card-bottom">
        <div>
          <span class="card-meta">${a.redeemed_at ? '兑换于 ' + escapeHtml(a.redeemed_at) : ''}</span>
          ${a.remark ? `<span class="card-remark" style="margin-left:var(--space-3);">${escapeHtml(a.remark)}</span>` : ''}
        </div>
        ${safeUrlForHref ? `
          <button class="btn btn-ghost btn-sm fetch-code-btn" data-action="fetch-code" data-id="${a.id}">
            <i data-lucide="mail-check"></i>
            获取验证码
          </button>
        ` : ''}
      </div>
    </div>
  `;
  }).join('');

  lucide.createIcons({ nodes: list.querySelectorAll('[data-lucide]') });
}

function relationLabel(rel) {
  const map = { owner: '我的', shared: '共享给我', admin: '他人的', orphan: '无主' };
  return map[rel] || '';
}

function effectiveIsAdmin() {
  // Admin unless privacy toggle is on
  return currentUser && currentUser.role === 'admin' && !isAdminPrivacyMode();
}

function isAdminPrivacyMode() {
  return localStorage.getItem('adminViewMode') === 'user';
}

function createEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `
    <i data-lucide="inbox" class="empty-icon"></i>
    <p>暂无账号。输入密钥兑换或手动添加。</p>
  `;
  return div;
}

function statusLabel(s) {
  const map = { available: '可用', archived: '已归档' };
  return map[s] || s;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// Escape a string for safe inclusion inside a single-quoted HTML attribute (e.g. onclick='...').
// Handles backslash, single quote, double quote, and HTML-entity breakers.
function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only allow http(s) URLs; anything else (javascript:, data:, etc.) returns null.
function safeUrl(url) {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

function truncate(str, len) {
  const s = String(str || '');
  return s.length > len ? s.substring(0, len) + '…' : s;
}

// ---- Redeem ----
async function handleRedeem() {
  const input = document.getElementById('redeemKeyInput');
  const btn = document.getElementById('redeemBtn');
  const msg = document.getElementById('redeemMsg');
  const key = input.value.trim();

  if (!key) {
    input.focus();
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 兑换中…';
  msg.style.display = 'none';

  try {
    const resp = await authFetch(`${API}/accounts/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, shop: currentShop || 'gpt-cw' }),
    });
    const data = await resp.json();

    if (resp.ok) {
      msg.className = 'redeem-msg success';
      msg.textContent = `兑换成功！邮箱：${data.email}`;
      msg.style.display = 'block';
      input.value = '';
      loadShopStats();
      loadAccounts();
      showToast('账号已录入', 'success');
    } else {
      msg.className = 'redeem-msg error';
      msg.textContent = data.detail || '兑换失败';
      msg.style.display = 'block';
    }
  } catch (e) {
    msg.className = 'redeem-msg error';
    msg.textContent = '网络错误，请重试';
    msg.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="key-round"></i> 兑换';
    lucide.createIcons({ nodes: btn.querySelectorAll('[data-lucide]') });
  }
}

// ---- Add / Edit Modal ----
function openAddModal() {
  document.getElementById('modalTitle').textContent = '添加账号';
  document.getElementById('editId').value = '';
  document.getElementById('fRedeemKey').value = '';
  document.getElementById('fRedeemKey').disabled = false;
  document.getElementById('fAccountType').value = 'Team';
  document.getElementById('fEmail').value = '';
  document.getElementById('fPassword').value = '';
  document.getElementById('fCodeUrl').value = '';
  document.getElementById('fStatus').value = 'available';
  document.getElementById('fRemark').value = '';
  document.getElementById('formSubmitBtn').textContent = '保存';
  document.getElementById('modalOverlay').style.display = 'flex';
}

function openEditModal(account) {
  document.getElementById('modalTitle').textContent = '编辑账号';
  document.getElementById('editId').value = account.id;
  document.getElementById('fRedeemKey').value = account.redeem_key;
  document.getElementById('fRedeemKey').disabled = true;
  document.getElementById('fAccountType').value = account.account_type;
  document.getElementById('fEmail').value = account.email;
  document.getElementById('fPassword').value = account.password;
  document.getElementById('fCodeUrl').value = account.code_url || '';
  document.getElementById('fStatus').value = account.status;
  document.getElementById('fRemark').value = account.remark || '';
  document.getElementById('formSubmitBtn').textContent = '更新';
  document.getElementById('modalOverlay').style.display = 'flex';
}

function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modalOverlay').style.display = 'none';
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById('editId').value;
  const isEdit = !!editId;

  if (isEdit) {
    const body = {
      account_type: document.getElementById('fAccountType').value,
      email: document.getElementById('fEmail').value,
      password: document.getElementById('fPassword').value,
      code_url: document.getElementById('fCodeUrl').value || null,
      status: document.getElementById('fStatus').value,
      remark: document.getElementById('fRemark').value || null,
    };

    try {
      const resp = await authFetch(`${API}/accounts/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        closeModal();
        loadShopStats();
        loadAccounts();
        showToast('已更新', 'success');
      } else {
        const data = await resp.json();
        showToast(data.detail || '更新失败', 'error');
      }
    } catch { showToast('网络错误', 'error'); }
  } else {
    const body = {
      redeem_key: document.getElementById('fRedeemKey').value,
      shop: currentShop || 'gpt-cw',
      account_type: document.getElementById('fAccountType').value,
      email: document.getElementById('fEmail').value,
      password: document.getElementById('fPassword').value,
      code_url: document.getElementById('fCodeUrl').value || null,
      status: document.getElementById('fStatus').value,
      remark: document.getElementById('fRemark').value || null,
    };

    try {
      const resp = await authFetch(`${API}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        closeModal();
        loadShopStats();
        loadAccounts();
        showToast('已添加', 'success');
      } else {
        const data = await resp.json();
        showToast(data.detail || '添加失败', 'error');
      }
    } catch { showToast('网络错误', 'error'); }
  }
}

// ---- Archive ----
async function toggleArchive(id, currentStatus) {
  const newStatus = currentStatus === 'archived' ? 'available' : 'archived';
  try {
    const resp = await authFetch(`${API}/accounts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (resp.ok) {
      loadShopStats();
      loadAccounts();
      showToast(newStatus === 'archived' ? '已归档' : '已取消归档', 'success');
    } else {
      showToast('操作失败', 'error');
    }
  } catch { showToast('网络错误', 'error'); }
}

// ---- Delete ----
let deleteTargetId = null;

function confirmDelete(id) {
  deleteTargetId = id;
  document.getElementById('deleteOverlay').style.display = 'flex';
  document.getElementById('confirmDeleteBtn').onclick = async () => {
    try {
      const resp = await authFetch(`${API}/accounts/${id}`, { method: 'DELETE' });
      if (resp.ok) {
        closeDeleteModal();
        loadShopStats();
        loadAccounts();
        showToast('已删除', 'success');
      } else {
        showToast('删除失败', 'error');
      }
    } catch { showToast('网络错误', 'error'); }
  };
}

function closeDeleteModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('deleteOverlay').style.display = 'none';
  deleteTargetId = null;
}

// ---- Fetch Verification Code ----
async function fetchCode(accountId) {
  const overlay = document.getElementById('codeOverlay');
  const content = document.getElementById('codeContent');

  overlay.style.display = 'flex';
  content.innerHTML = '<div class="code-loading"><span class="spinner"></span> 正在获取验证码…</div>';

  try {
    const resp = await authFetch(`${API}/accounts/${accountId}/fetch-code`, { method: 'POST' });
    const data = await resp.json();

    if (data.code) {
      content.innerHTML = `
        <div class="code-display">
          <p class="code-subject">${escapeHtml(data.subject || '')}</p>
          <p class="code-number">${escapeHtml(data.code)}</p>
          <p class="code-time">${escapeHtml(data.received_at || '')}</p>
          <button class="btn btn-primary" style="margin-top:var(--space-4);" data-action="copy" data-value="${escapeAttr(data.code)}">
            <i data-lucide="copy"></i> 复制验证码
          </button>
        </div>
      `;
    } else {
      content.innerHTML = `<div class="code-error">${escapeHtml(data.error || '获取失败')}</div>`;
    }
    lucide.createIcons({ nodes: content.querySelectorAll('[data-lucide]') });
  } catch {
    content.innerHTML = '<div class="code-error">网络错误，请重试</div>';
  }
}

function closeCodeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('codeOverlay').style.display = 'none';
}

// ---- Admin: User Management ----
async function loadUsers() {
  try {
    const resp = await authFetch(`${API}/admin/users`);
    if (!resp.ok) return;
    const users = await resp.json();
    renderUsers(users);
  } catch (e) {
    console.error('Failed to load users:', e);
  }
}

function renderUsers(users) {
  const list = document.getElementById('userList');
  if (users.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>暂无用户</p></div>';
    return;
  }

  list.innerHTML = `
    <div class="admin-table">
      <div class="admin-table-header">
        <span>ID</span>
        <span>用户名</span>
        <span>角色</span>
        <span>状态</span>
        <span>注册时间</span>
        <span>操作</span>
      </div>
      ${users.map(u => `
        <div class="admin-table-row">
          <span>${u.id}</span>
          <span class="user-name-cell">${escapeHtml(u.username)}</span>
          <span><span class="badge badge-${escapeAttr(u.role)}">${u.role === 'admin' ? '管理员' : '用户'}</span></span>
          <span><span class="badge badge-${u.is_approved ? 'available' : 'pending'}">${u.is_approved ? '已激活' : '待审核'}</span></span>
          <span class="ds-meta">${u.created_at ? escapeHtml(new Date(u.created_at).toLocaleString('zh-CN')) : '—'}</span>
          <span class="cell-actions">
            ${!u.is_approved ? `<button class="btn btn-sm btn-primary" data-action="approve-user" data-id="${u.id}">审核通过</button>` : ''}
            ${u.role !== 'admin' ? `<button class="btn btn-sm btn-outline btn-danger-text" data-action="delete-user" data-id="${u.id}" data-username="${escapeAttr(u.username)}">删除</button>` : ''}
          </span>
        </div>
      `).join('')}
    </div>
  `;
  lucide.createIcons({ nodes: list.querySelectorAll('[data-lucide]') });
}

async function approveUser(userId) {
  try {
    const resp = await authFetch(`${API}/admin/users/${userId}/approve`, { method: 'PUT' });
    if (resp.ok) {
      showToast('已审核通过', 'success');
      loadUsers();
    } else {
      const data = await resp.json();
      showToast(data.detail || '操作失败', 'error');
    }
  } catch { showToast('网络错误', 'error'); }
}

async function deleteUser(userId, username) {
  if (!confirm(`确定要删除用户「${username}」吗？该用户录入的账号数据将保留。`)) return;
  try {
    const resp = await authFetch(`${API}/admin/users/${userId}`, { method: 'DELETE' });
    if (resp.ok) {
      showToast('用户已删除', 'success');
      loadUsers();
    } else {
      const data = await resp.json();
      showToast(data.detail || '删除失败', 'error');
    }
  } catch { showToast('网络错误', 'error'); }
}

// ---- Admin: Invite Codes ----
async function loadInviteCodes() {
  try {
    const resp = await authFetch(`${API}/admin/invite-codes`);
    if (!resp.ok) return;
    const codes = await resp.json();
    renderInviteCodes(codes);
  } catch (e) {
    console.error('Failed to load invite codes:', e);
  }
}

function renderInviteCodes(codes) {
  const list = document.getElementById('inviteList');
  if (codes.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>暂无邀请码，点击上方按钮生成。</p></div>';
    return;
  }

  list.innerHTML = `
    <div class="admin-table">
      <div class="admin-table-header invite-cols">
        <span>邀请码</span>
        <span>状态</span>
        <span>使用者 ID</span>
        <span>创建时间</span>
        <span>操作</span>
      </div>
      ${codes.map(c => `
        <div class="admin-table-row invite-cols">
          <span class="invite-code-cell">
            <code>${escapeHtml(c.code)}</code>
            <button class="copy-btn" data-action="copy" data-value="${escapeAttr(c.code)}"><i data-lucide="copy"></i></button>
          </span>
          <span><span class="badge badge-${c.used_by ? 'archived' : 'available'}">${c.used_by ? '已使用' : '未使用'}</span></span>
          <span>${c.used_by || '—'}</span>
          <span class="ds-meta">${c.created_at ? escapeHtml(new Date(c.created_at).toLocaleString('zh-CN')) : '—'}</span>
          <span class="cell-actions">
            <button class="btn btn-sm btn-outline btn-danger-text" data-action="delete-invite" data-id="${c.id}">删除</button>
          </span>
        </div>
      `).join('')}
    </div>
  `;
  lucide.createIcons({ nodes: list.querySelectorAll('[data-lucide]') });
}

async function generateInviteCode() {
  try {
    const resp = await authFetch(`${API}/admin/invite-codes`, { method: 'POST' });
    if (resp.ok) {
      const data = await resp.json();
      showToast('邀请码已生成: ' + data.code, 'success');
      loadInviteCodes();
    } else {
      const data = await resp.json();
      showToast(data.detail || '生成失败', 'error');
    }
  } catch { showToast('网络错误', 'error'); }
}

async function deleteInviteCode(codeId) {
  try {
    const resp = await authFetch(`${API}/admin/invite-codes/${codeId}`, { method: 'DELETE' });
    if (resp.ok) {
      showToast('邀请码已删除', 'success');
      loadInviteCodes();
    } else {
      showToast('删除失败', 'error');
    }
  } catch { showToast('网络错误', 'error'); }
}

// ---- User Picker (combobox with search suggestions) ----
// Usage: createUserPicker({ mountEl, placeholder, allowEmptyQuery, onSelect })
// Returns { getValue, setValue, destroy, focus }.
function createUserPicker(opts) {
  const {
    mountEl,
    placeholder = '输入用户名搜索',
    allowEmptyQuery = false, // true => admin can see full list on focus
  } = opts;

  mountEl.classList.add('user-picker');
  mountEl.innerHTML = `
    <input type="text" class="input user-picker-input" placeholder="${escapeAttr(placeholder)}" autocomplete="off" spellcheck="false">
    <div class="user-picker-dropdown" hidden></div>
  `;
  const input = mountEl.querySelector('.user-picker-input');
  const dropdown = mountEl.querySelector('.user-picker-dropdown');

  let debounceId = null;
  let currentItems = [];
  let activeIndex = -1;
  let destroyed = false;
  let abortCtrl = null;

  async function fetchSuggestions(q) {
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('limit', '20');
    try {
      const resp = await authFetch(`${API}/users/search?${params}`, { signal: abortCtrl.signal });
      if (!resp.ok) return [];
      return await resp.json();
    } catch (e) {
      if (e.name === 'AbortError') return null;
      return [];
    }
  }

  function render(items) {
    currentItems = items;
    activeIndex = items.length ? 0 : -1;
    if (!items.length) {
      const q = input.value.trim();
      const hint = (!allowEmptyQuery && q.length < 2)
        ? '请输入至少 2 个字符进行搜索'
        : '未找到匹配的用户';
      dropdown.innerHTML = `<div class="user-picker-empty">${escapeHtml(hint)}</div>`;
    } else {
      dropdown.innerHTML = items.map((u, i) => `
        <div class="user-picker-item${i === activeIndex ? ' active' : ''}" data-index="${i}">
          <i data-lucide="user"></i>
          <span>${escapeHtml(u.username)}</span>
        </div>
      `).join('');
      lucide.createIcons({ nodes: dropdown.querySelectorAll('[data-lucide]') });
    }
    dropdown.hidden = false;
  }

  function pickItem(idx) {
    const item = currentItems[idx];
    if (!item) return;
    input.value = item.username;
    dropdown.hidden = true;
    if (opts.onSelect) opts.onSelect(item);
  }

  function highlight(newIdx) {
    activeIndex = newIdx;
    dropdown.querySelectorAll('.user-picker-item').forEach((el, i) => {
      el.classList.toggle('active', i === activeIndex);
    });
  }

  async function onInput() {
    const q = input.value.trim();
    clearTimeout(debounceId);
    debounceId = setTimeout(async () => {
      if (destroyed) return;
      if (!allowEmptyQuery && q.length < 2) {
        render([]);
        return;
      }
      const items = await fetchSuggestions(q);
      if (items === null || destroyed) return;
      render(items);
    }, 180);
  }

  async function onFocus() {
    if (destroyed) return;
    if (allowEmptyQuery || input.value.trim().length >= 2) {
      const items = await fetchSuggestions(input.value.trim());
      if (items && !destroyed) render(items);
    } else {
      render([]);
    }
  }

  function onBlur() {
    // Delay hiding so item clicks register
    setTimeout(() => { if (!destroyed) dropdown.hidden = true; }, 150);
  }

  function onKeydown(e) {
    if (dropdown.hidden) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        onFocus();
        e.preventDefault();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        if (currentItems.length) highlight((activeIndex + 1) % currentItems.length);
        e.preventDefault();
        break;
      case 'ArrowUp':
        if (currentItems.length) highlight((activeIndex - 1 + currentItems.length) % currentItems.length);
        e.preventDefault();
        break;
      case 'Enter':
        if (activeIndex >= 0) {
          pickItem(activeIndex);
          e.preventDefault();
        }
        break;
      case 'Escape':
        dropdown.hidden = true;
        break;
    }
  }

  function onDropdownMousedown(e) {
    // mousedown so we fire before input blur.
    const el = e.target.closest('.user-picker-item');
    if (!el) return;
    const idx = Number(el.dataset.index);
    pickItem(idx);
    e.preventDefault();
  }

  input.addEventListener('input', onInput);
  input.addEventListener('focus', onFocus);
  input.addEventListener('blur', onBlur);
  input.addEventListener('keydown', onKeydown);
  dropdown.addEventListener('mousedown', onDropdownMousedown);

  return {
    getValue: () => input.value.trim(),
    setValue: (v) => { input.value = v || ''; },
    focus: () => input.focus(),
    destroy: () => {
      destroyed = true;
      clearTimeout(debounceId);
      if (abortCtrl) abortCtrl.abort();
    },
  };
}

// ---- Share / Transfer / Claim Modal ----
let currentShareAccountId = null;
let _sharePicker = null;
let _transferPicker = null;
let _claimPicker = null;

async function openShareModal(accountId) {
  const account = (window.__accountCache || {})[accountId];
  if (!account) return;
  currentShareAccountId = accountId;

  // If orphan and admin, open claim modal instead.
  if (account.relation === 'orphan') {
    openClaimModal(accountId);
    return;
  }

  const overlay = document.getElementById('shareOverlay');
  const body = document.getElementById('shareBody');
  overlay.style.display = 'flex';
  body.innerHTML = `
    <div class="share-section">
      <div class="share-owner">
        <span class="ds-meta">当前拥有者</span>
        <strong>${escapeHtml(account.owner_username || '（无主）')}</strong>
      </div>
    </div>
    <div class="share-section">
      <h4 class="ds-h4">共享用户</h4>
      <div id="shareList"><div class="code-loading"><span class="spinner"></span> 加载中…</div></div>
      <div class="share-add">
        <div id="sharePickerMount" class="user-picker-mount"></div>
        <button class="btn btn-primary" id="shareAddBtn">添加共享</button>
      </div>
      <p class="ds-small" style="color:var(--fg-3);">被共享用户只能查看和获取验证码，无法编辑/归档/转让。</p>
    </div>
    <div class="share-section">
      <h4 class="ds-h4">转让拥有者</h4>
      <div class="share-add">
        <div id="transferPickerMount" class="user-picker-mount"></div>
        <button class="btn btn-outline btn-danger-text" id="transferBtn">转让</button>
      </div>
      <p class="ds-small" style="color:var(--fg-3);">转让后你将失去对该账号的编辑与共享管理权限。</p>
    </div>
  `;
  lucide.createIcons({ nodes: body.querySelectorAll('[data-lucide]') });

  const allowEmpty = effectiveIsAdmin();
  if (_sharePicker) _sharePicker.destroy();
  if (_transferPicker) _transferPicker.destroy();
  _sharePicker = createUserPicker({
    mountEl: document.getElementById('sharePickerMount'),
    placeholder: allowEmpty ? '搜索或输入用户名' : '输入至少 2 个字符搜索',
    allowEmptyQuery: allowEmpty,
    onSelect: () => {},
  });
  _transferPicker = createUserPicker({
    mountEl: document.getElementById('transferPickerMount'),
    placeholder: allowEmpty ? '搜索或输入用户名' : '输入至少 2 个字符搜索',
    allowEmptyQuery: allowEmpty,
    onSelect: () => {},
  });

  document.getElementById('shareAddBtn').onclick = () => addShareFromModal();
  document.getElementById('transferBtn').onclick = () => transferFromModal();

  await refreshShareList();
}

function closeShareModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('shareOverlay').style.display = 'none';
  currentShareAccountId = null;
  if (_sharePicker) { _sharePicker.destroy(); _sharePicker = null; }
  if (_transferPicker) { _transferPicker.destroy(); _transferPicker = null; }
  if (_claimPicker) { _claimPicker.destroy(); _claimPicker = null; }
}

async function refreshShareList() {
  if (!currentShareAccountId) return;
  const list = document.getElementById('shareList');
  try {
    const resp = await authFetch(`${API}/accounts/${currentShareAccountId}/shares`);
    if (!resp.ok) {
      list.innerHTML = '<p class="ds-small" style="color:var(--color-danger)">加载失败</p>';
      return;
    }
    const users = await resp.json();
    if (users.length === 0) {
      list.innerHTML = '<p class="ds-small" style="color:var(--fg-3);">暂未共享给任何用户</p>';
      return;
    }
    list.innerHTML = `
      <div class="share-users">
        ${users.map(u => `
          <div class="share-user-row">
            <span><i data-lucide="user"></i>&nbsp;${escapeHtml(u.username)}</span>
            <button class="btn btn-sm btn-outline btn-danger-text" data-action="remove-share" data-id="${u.id}" data-account-id="${currentShareAccountId}">移除</button>
          </div>
        `).join('')}
      </div>
    `;
    lucide.createIcons({ nodes: list.querySelectorAll('[data-lucide]') });
  } catch {
    list.innerHTML = '<p class="ds-small" style="color:var(--color-danger)">网络错误</p>';
  }
}

async function addShareFromModal() {
  if (!_sharePicker) return;
  const username = _sharePicker.getValue();
  if (!username) { _sharePicker.focus(); return; }
  try {
    const resp = await authFetch(`${API}/accounts/${currentShareAccountId}/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const data = await resp.json();
    if (resp.ok) {
      showToast('已共享', 'success');
      _sharePicker.setValue('');
      refreshShareList();
      loadAccounts();
    } else {
      showToast(data.detail || '共享失败', 'error');
    }
  } catch { showToast('网络错误', 'error'); }
}

async function removeShare(accountId, userId) {
  try {
    const resp = await authFetch(`${API}/accounts/${accountId}/shares/${userId}`, { method: 'DELETE' });
    if (resp.ok) {
      showToast('已移除', 'success');
      refreshShareList();
      loadAccounts();
    } else {
      const data = await resp.json();
      showToast(data.detail || '移除失败', 'error');
    }
  } catch { showToast('网络错误', 'error'); }
}

async function transferFromModal() {
  if (!_transferPicker) return;
  const username = _transferPicker.getValue();
  if (!username) { _transferPicker.focus(); return; }
  if (!confirm(`确定将该账号的拥有者转让给「${username}」吗？\n转让后你将失去对该账号的编辑与共享管理权限。`)) return;

  try {
    const resp = await authFetch(`${API}/accounts/${currentShareAccountId}/transfer`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const data = await resp.json();
    if (resp.ok) {
      showToast('已转让', 'success');
      closeShareModal();
      loadAccounts();
    } else {
      showToast(data.detail || '转让失败', 'error');
    }
  } catch { showToast('网络错误', 'error'); }
}

// ---- Claim Modal (admin assigns orphan account) ----
async function openClaimModal(accountId) {
  const account = (window.__accountCache || {})[accountId];
  if (!account) return;
  currentShareAccountId = accountId;

  const overlay = document.getElementById('shareOverlay');
  const body = document.getElementById('shareBody');
  overlay.style.display = 'flex';
  body.innerHTML = `
    <div class="share-section">
      <p class="ds-p">该账号当前<strong>无拥有者</strong>。分配给某个用户后，该用户将拥有编辑、共享、转让权限。</p>
      <div class="share-add">
        <div id="claimPickerMount" class="user-picker-mount"></div>
        <button class="btn btn-primary" id="claimBtn">分配</button>
      </div>
      <p class="ds-small" style="color:var(--fg-3);">可直接聚焦输入框查看全部可选用户，或输入关键字筛选。</p>
    </div>
  `;

  if (_claimPicker) _claimPicker.destroy();
  _claimPicker = createUserPicker({
    mountEl: document.getElementById('claimPickerMount'),
    placeholder: '搜索或选择要分配的用户',
    allowEmptyQuery: true, // claim is admin-only, show full list on focus
  });

  document.getElementById('claimBtn').onclick = async () => {
    const username = _claimPicker ? _claimPicker.getValue() : '';
    if (!username) { if (_claimPicker) _claimPicker.focus(); return; }
    try {
      const resp = await authFetch(`${API}/accounts/${accountId}/claim`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await resp.json();
      if (resp.ok) {
        showToast('已分配', 'success');
        closeShareModal();
        loadAccounts();
      } else {
        showToast(data.detail || '分配失败', 'error');
      }
    } catch { showToast('网络错误', 'error'); }
  };

  setTimeout(() => { if (_claimPicker) _claimPicker.focus(); }, 50);
}

// ---- Admin view toggle ----
function toggleAdminView() {
  const current = localStorage.getItem('adminViewMode') || 'admin';
  const next = current === 'user' ? 'admin' : 'user';
  localStorage.setItem('adminViewMode', next);
  updateAdminViewToggleUI();
  applyRoleUI();
  showToast(next === 'user' ? '已切换为普通视角' : '已切换为管理员视角', 'info');
  // Refresh all views
  if (currentView === 'dashboard') loadStats();
  else if (SHOP_VIEW_MAP[currentView]) { loadShopStats(); loadAccounts(); }
}

function updateAdminViewToggleUI() {
  const el = document.getElementById('adminViewToggle');
  if (!el) return;
  if (!currentUser || currentUser.role !== 'admin') {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  const mode = localStorage.getItem('adminViewMode') || 'admin';
  const icon = el.querySelector('[data-lucide]');
  const label = el.querySelector('.nav-label');
  if (mode === 'user') {
    if (icon) icon.setAttribute('data-lucide', 'eye-off');
    if (label) label.textContent = '普通视角';
    el.title = '当前：普通视角（点击切回管理员）';
  } else {
    if (icon) icon.setAttribute('data-lucide', 'eye');
    if (label) label.textContent = '管理员视角';
    el.title = '当前：管理员视角（点击切换到普通视角）';
  }
  if (icon) lucide.createIcons({ nodes: [icon] });
}

// ---- Change Password ----
function openChangePasswordModal() {
  document.getElementById('cpOldPassword').value = '';
  document.getElementById('cpNewPassword').value = '';
  document.getElementById('cpNewPassword2').value = '';
  document.getElementById('changePwMsg').style.display = 'none';
  document.getElementById('changePwOverlay').style.display = 'flex';
}

function closeChangePasswordModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('changePwOverlay').style.display = 'none';
}

async function handleChangePassword(e) {
  e.preventDefault();
  const msg = document.getElementById('changePwMsg');
  const oldPw = document.getElementById('cpOldPassword').value;
  const newPw = document.getElementById('cpNewPassword').value;
  const newPw2 = document.getElementById('cpNewPassword2').value;

  if (newPw !== newPw2) {
    msg.textContent = '两次输入的新密码不一致';
    msg.className = 'auth-msg error';
    msg.style.display = 'block';
    return;
  }
  if (newPw.length < 8) {
    msg.textContent = '新密码至少 8 个字符';
    msg.className = 'auth-msg error';
    msg.style.display = 'block';
    return;
  }

  try {
    const resp = await authFetch(`${API}/auth/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
    });
    const data = await resp.json();
    if (resp.ok) {
      showToast('密码已更新，请重新登录', 'success');
      closeChangePasswordModal();
      handleLogout();
    } else {
      msg.textContent = data.detail || '修改失败';
      msg.className = 'auth-msg error';
      msg.style.display = 'block';
    }
  } catch {
    msg.textContent = '网络错误';
    msg.className = 'auth-msg error';
    msg.style.display = 'block';
  }
}
