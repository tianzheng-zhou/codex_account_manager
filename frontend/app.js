/* ============================================================
   Codex Account Manager — Frontend Logic
   ============================================================ */

const API = '/api';
let debounceTimer = null;
let currentView = 'dashboard';
let currentShop = null;
let currentUser = null;

const SELF_SHOP = 'self';
const SHOP_VIEW_MAP = {
  'shop:gpt-cw': {
    shop: 'gpt-cw',
    elId: 'viewShopGptCw',
    title: 'GPT专卖-cw',
    subtitle: 'chongzhi.art 密钥兑换 · 自动接码',
    actionHref: 'https://caowo.store/',
    actionLabel: '商店',
    showRedeem: true,
  },
  'shop:self': {
    shop: SELF_SHOP,
    elId: 'viewShopGptCw',
    title: '自有账号',
    subtitle: '手动录入 Plus、Team 母号和 Team 子号',
    actionHref: null,
    actionLabel: '',
    showRedeem: false,
  },
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
  const accountCfg = SHOP_VIEW_MAP[view] || null;

  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  document.getElementById('viewDashboard').style.display = view === 'dashboard' ? 'block' : 'none';
  document.getElementById('viewShopGptCw').style.display = accountCfg ? 'block' : 'none';
  document.getElementById('viewUsers').style.display = view === 'users' ? 'block' : 'none';
  document.getElementById('viewInvites').style.display = view === 'invites' ? 'block' : 'none';

  if (view === 'dashboard') {
    currentShop = null;
    loadStats();
  } else if (accountCfg) {
    currentShop = accountCfg.shop;
    configureAccountSourceView(accountCfg);
    loadShopStats();
    loadAccounts();
  } else if (view === 'users') {
    currentShop = null;
    loadUsers();
  } else if (view === 'invites') {
    currentShop = null;
    loadInviteCodes();
  }
}

function isSelfAccountView() {
  return currentShop === SELF_SHOP;
}

function configureAccountSourceView(cfg) {
  document.getElementById('accountViewTitle').textContent = cfg.title;
  document.getElementById('accountViewSubtitle').textContent = cfg.subtitle;

  const action = document.getElementById('accountSourceAction');
  const actionLabel = document.getElementById('accountSourceActionLabel');
  if (cfg.actionHref) {
    action.href = cfg.actionHref;
    actionLabel.textContent = cfg.actionLabel;
    action.style.display = '';
  } else {
    action.style.display = 'none';
  }

  document.getElementById('redeemSection').style.display = cfg.showRedeem ? '' : 'none';
  document.getElementById('typeFilter').style.display = cfg.shop === SELF_SHOP ? 'none' : '';
  document.getElementById('teamRoleFilter').style.display = cfg.shop === SELF_SHOP ? '' : 'none';
  document.getElementById('quickImportBtn').style.display = cfg.shop === SELF_SHOP ? '' : 'none';
  document.getElementById('addAccountBtnLabel').textContent = cfg.shop === SELF_SHOP ? '添加自有账号' : '手动添加';
  document.getElementById('searchInput').placeholder = cfg.shop === SELF_SHOP
    ? '搜索邮箱、账号标识、备注…'
    : '搜索邮箱、密钥、备注…';
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

  const fallbackCopy = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      doCopy();
    } catch (e) {
      showToast('复制失败，请手动复制', 'error');
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(doCopy).catch(fallbackCopy);
  } else {
    fallbackCopy();
  }
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
  const teamRoleEl = document.getElementById('teamRoleFilter');
  const statusEl = document.getElementById('statusFilter');
  const scopeEl = document.getElementById('scopeFilter');
  if (!searchEl || !typeEl || !statusEl) return;

  const search = searchEl.value.trim();
  const type = typeEl.value;
  const teamRole = teamRoleEl ? teamRoleEl.value : '';
  const status = statusEl.value;
  const scope = scopeEl ? scopeEl.value : '';

  const params = new URLSearchParams();
  if (currentShop) params.set('shop', currentShop);
  if (search) params.set('search', search);
  if (currentShop === SELF_SHOP) {
    if (teamRole) params.set('team_role_filter', teamRole);
  } else if (type) {
    params.set('account_type', type);
  }
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
    const safeType = escapeHtml(accountShapeLabel(a));
    const typeClass = accountShapeClass(a);
    const identifierText = accountIdentifierText(a);
    const statusKey = escapeAttr(a.status);
    const safeUrlForHref = safeUrl(a.code_url);
    const shortUrl = safeUrlForHref ? escapeHtml(truncate(safeUrlForHref, 40)) : '';
    const codeUrlOptional = a.login_method === 'google_oauth' || a.account_provider === 'outlook';
    const showCodeUrlField = safeUrlForHref || a.code_url || !codeUrlOptional;
    const providerLabel = accountProviderLabel(a.account_provider);
    const loginLabel = loginMethodLabel(a.login_method);
    const canFetchCode = safeUrlForHref || a.account_provider === 'outlook' || (a.mail_auth_code && a.mail_token);
    const relLabel = relationLabel(relation);
    const parentInfo = a.shop === SELF_SHOP && a.team_role === 'child'
      ? (a.team_parent_label || '未绑定')
      : null;

    return `
    <div class="account-card" data-id="${a.id}">
      <div class="card-top">
        <div class="card-badges">
          <span class="badge badge-${escapeAttr(typeClass)}">${safeType}</span>
          <span class="badge badge-${statusKey}">${escapeHtml(statusLabel(a.status))}</span>
          ${providerLabel ? `<span class="badge badge-provider">${escapeHtml(providerLabel)}</span>` : ''}
          ${loginLabel ? `<span class="badge badge-login">${escapeHtml(loginLabel)}</span>` : ''}
          ${relLabel ? `<span class="badge badge-rel-${escapeAttr(relation)}">${escapeHtml(relLabel)}</span>` : ''}
          ${a.owner_username && relation !== 'owner' ? `<span class="ds-meta">拥有者：${escapeHtml(a.owner_username)}</span>` : ''}
          ${identifierText ? `<span class="ds-meta" style="margin-left:var(--space-2);">${escapeHtml(identifierText)}</span>` : ''}
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
        ${a.recovery_email ? `
        <div class="field">
          <span class="field-label">辅助邮箱</span>
          <span class="field-value">
            <span>${escapeHtml(a.recovery_email)}</span>
            <button class="copy-btn" data-action="copy" data-value="${escapeAttr(a.recovery_email)}"><i data-lucide="copy"></i></button>
          </span>
        </div>` : ''}
        ${showCodeUrlField ? `
        <div class="field">
          <span class="field-label">收码链接</span>
          <span class="field-value">
            ${safeUrlForHref
              ? `<a href="${escapeAttr(safeUrlForHref)}" target="_blank" rel="noopener noreferrer">${shortUrl}</a>
                 <button class="copy-btn" data-action="copy" data-value="${escapeAttr(safeUrlForHref)}"><i data-lucide="copy"></i></button>`
              : (a.code_url ? `<span style="color:var(--color-danger)">(无效链接)</span>` : '<span style="color:var(--fg-3)">—</span>')
            }
          </span>
        </div>` : ''}
        ${parentInfo !== null ? `
        <div class="field">
          <span class="field-label">所属母号</span>
          <span class="field-value">${escapeHtml(parentInfo)}</span>
        </div>` : ''}
      </div>
      <div class="card-bottom">
        <div>
          <span class="card-meta">${a.redeemed_at ? '兑换于 ' + escapeHtml(a.redeemed_at) : ''}</span>
          ${a.remark ? `<span class="card-remark" style="margin-left:var(--space-3);">${escapeHtml(a.remark)}</span>` : ''}
        </div>
        ${canFetchCode ? `
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

function accountShapeLabel(account) {
  if (account.shop === SELF_SHOP) {
    if (account.account_type === 'Plus') return 'Plus';
    if (account.team_role === 'child') return 'Team 子号';
    return 'Team 母号';
  }
  return account.account_type;
}

function accountShapeClass(account) {
  if (account.shop === SELF_SHOP && account.account_type === 'Team') {
    return account.team_role === 'child' ? 'team-child' : 'team-parent';
  }
  return String(account.account_type || '').toLowerCase();
}

function accountIdentifierText(account) {
  const key = account.redeem_key || '';
  if (account.shop === SELF_SHOP && key.startsWith('SELF-')) return '';
  return key;
}

function accountProviderLabel(provider) {
  const map = { google: 'Google', outlook: 'Outlook' };
  return map[provider] || '';
}

function loginMethodLabel(method) {
  const map = { google_oauth: 'Google OAuth', password: '密码登录' };
  return map[method] || '';
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
    <p>${isSelfAccountView() ? '暂无自有账号。点击上方按钮添加。' : '暂无账号。输入密钥兑换或手动添加。'}</p>
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
function placeAccountIdentifierRow(isSelf) {
  const form = document.getElementById('accountForm');
  const row = document.getElementById('redeemKeyRow');
  if (isSelf) {
    form.insertBefore(row, form.querySelector('.modal-actions'));
  } else {
    form.insertBefore(row, document.getElementById('accountTypeRow'));
  }
}

function configureAccountModalForSource(sourceShop, account = null) {
  const isSelf = sourceShop === SELF_SHOP;
  const redeemInput = document.getElementById('fRedeemKey');

  document.getElementById('accountForm').dataset.sourceShop = sourceShop;
  placeAccountIdentifierRow(isSelf);
  document.getElementById('redeemKeyLabelText').textContent = isSelf ? '账号标识（可选）' : '兑换密钥';
  redeemInput.placeholder = isSelf ? '留空则自动生成内部标识' : 'TEAM-XXXXXXXX';
  redeemInput.required = !isSelf;
  document.getElementById('accountTypeRow').style.display = isSelf ? 'none' : '';
  document.getElementById('accountShapeRow').style.display = isSelf ? '' : 'none';
  document.getElementById('accountProviderRow').style.display = isSelf ? '' : 'none';
  document.getElementById('loginMethodRow').style.display = isSelf ? '' : 'none';

  if (isSelf) {
    if (account) {
      if (account.account_type === 'Plus') {
        document.getElementById('fAccountShape').value = 'plus';
      } else {
        document.getElementById('fAccountShape').value = account.team_role === 'child' ? 'team_child' : 'team_parent';
      }
    } else {
      document.getElementById('fAccountShape').value = 'team_parent';
    }
  } else {
    document.getElementById('fAccountType').value = account ? account.account_type : 'Team';
  }

  updateAccountShapeFields();
  updateAccountProviderFields(false);
}

function updateAccountProviderFields(applyDefaults = false) {
  const isSelf = document.getElementById('accountForm').dataset.sourceShop === SELF_SHOP;
  const provider = document.getElementById('fAccountProvider').value;
  const loginMethodEl = document.getElementById('fLoginMethod');
  const showGoogle = isSelf && provider === 'google';
  const showOutlook = isSelf && provider === 'outlook';

  document.getElementById('recoveryEmailRow').style.display = showGoogle ? '' : 'none';
  document.getElementById('mailAuthCodeRow').style.display = showOutlook ? '' : 'none';
  document.getElementById('mailTokenRow').style.display = showOutlook ? '' : 'none';

  if (!isSelf) {
    loginMethodEl.value = '';
    return;
  }
  if (applyDefaults) {
    if (provider === 'google') loginMethodEl.value = 'google_oauth';
    else if (provider === 'outlook') loginMethodEl.value = 'password';
    else loginMethodEl.value = '';
  }
}

function updateAccountShapeFields() {
  const isSelf = isSelfAccountView() || document.getElementById('accountShapeRow').style.display !== 'none';
  const shape = document.getElementById('fAccountShape').value;
  document.getElementById('teamParentRow').style.display = isSelf && shape === 'team_child' ? '' : 'none';
}

async function loadTeamParentOptions(selectedId = null, excludeId = null, selectedLabel = '', selectId = 'fTeamParentId') {
  const select = document.getElementById(selectId);
  select.innerHTML = '<option value="">暂不绑定</option>';

  const params = new URLSearchParams();
  if (excludeId) params.set('exclude_id', String(excludeId));

  try {
    const resp = await authFetch(`${API}/accounts/team-parents?${params}`);
    if (!resp.ok) return;
    const parents = await resp.json();
    const hasSelected = selectedId && parents.some(p => p.id === selectedId);

    select.innerHTML += parents.map(p => {
      const owner = p.owner_username ? ` · ${p.owner_username}` : '';
      const remark = p.remark ? ` · ${p.remark}` : '';
      return `<option value="${p.id}">${escapeHtml(p.email + owner + remark)}</option>`;
    }).join('');

    if (selectedId && !hasSelected) {
      const label = selectedLabel || `当前母号 #${selectedId}`;
      select.innerHTML += `<option value="${selectedId}">${escapeHtml(label)}</option>`;
    }
    select.value = selectedId ? String(selectedId) : '';
  } catch {
    showToast('母号列表加载失败', 'error');
  }
}

async function openAddModal() {
  document.getElementById('modalTitle').textContent = '添加账号';
  document.getElementById('editId').value = '';
  document.getElementById('fRedeemKey').value = '';
  document.getElementById('fRedeemKey').disabled = false;
  document.getElementById('fEmail').value = '';
  document.getElementById('fPassword').value = '';
  document.getElementById('fAccountProvider').value = '';
  document.getElementById('fRecoveryEmail').value = '';
  document.getElementById('fLoginMethod').value = '';
  document.getElementById('fMailAuthCode').value = '';
  document.getElementById('fMailToken').value = '';
  document.getElementById('fCodeUrl').value = '';
  document.getElementById('fStatus').value = 'available';
  document.getElementById('fRemark').value = '';
  configureAccountModalForSource(currentShop || 'gpt-cw');
  if (isSelfAccountView()) await loadTeamParentOptions();
  document.getElementById('formSubmitBtn').textContent = '保存';
  document.getElementById('modalOverlay').style.display = 'flex';
}

async function openEditModal(account) {
  document.getElementById('modalTitle').textContent = '编辑账号';
  document.getElementById('editId').value = account.id;
  document.getElementById('fRedeemKey').value = accountIdentifierText(account);
  document.getElementById('fRedeemKey').disabled = true;
  document.getElementById('fEmail').value = account.email;
  document.getElementById('fPassword').value = account.password;
  document.getElementById('fAccountProvider').value = account.account_provider
    || (account.login_method === 'google_oauth' ? 'google' : '')
    || ((account.mail_auth_code || account.mail_token) ? 'outlook' : '');
  document.getElementById('fRecoveryEmail').value = account.recovery_email || '';
  document.getElementById('fLoginMethod').value = account.login_method || '';
  document.getElementById('fMailAuthCode').value = account.mail_auth_code || '';
  document.getElementById('fMailToken').value = account.mail_token || '';
  document.getElementById('fCodeUrl').value = account.code_url || '';
  document.getElementById('fStatus').value = account.status;
  document.getElementById('fRemark').value = account.remark || '';
  configureAccountModalForSource(account.shop, account);
  if (account.shop === SELF_SHOP) {
    await loadTeamParentOptions(account.team_parent_id, account.id, account.team_parent_label || '');
  }
  updateAccountShapeFields();
  document.getElementById('formSubmitBtn').textContent = '更新';
  document.getElementById('modalOverlay').style.display = 'flex';
}

function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modalOverlay').style.display = 'none';
}

function getSelfShapePayload() {
  const shape = document.getElementById('fAccountShape').value;
  if (shape === 'plus') {
    return { account_type: 'Plus', team_role: null, team_parent_id: null };
  }
  if (shape === 'team_child') {
    const parentId = document.getElementById('fTeamParentId').value;
    return {
      account_type: 'Team',
      team_role: 'child',
      team_parent_id: parentId ? Number(parentId) : null,
    };
  }
  return { account_type: 'Team', team_role: 'parent', team_parent_id: null };
}

function getSelfMetadataPayload() {
  const provider = document.getElementById('fAccountProvider').value || null;
  let loginMethod = document.getElementById('fLoginMethod').value || null;
  if (provider === 'google') loginMethod = 'google_oauth';
  if (provider === 'outlook') loginMethod = 'password';

  return {
    recovery_email: provider === 'google'
      ? (document.getElementById('fRecoveryEmail').value.trim() || null)
      : null,
    mail_auth_code: provider === 'outlook'
      ? (document.getElementById('fMailAuthCode').value.trim() || null)
      : null,
    mail_token: provider === 'outlook'
      ? (document.getElementById('fMailToken').value.trim() || null)
      : null,
    login_method: loginMethod,
    account_provider: provider,
  };
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById('editId').value;
  const isEdit = !!editId;
  const sourceShop = document.getElementById('accountForm').dataset.sourceShop || currentShop || 'gpt-cw';
  const isSelf = sourceShop === SELF_SHOP;

  if (isEdit) {
    const body = {
      email: document.getElementById('fEmail').value,
      password: document.getElementById('fPassword').value,
      code_url: document.getElementById('fCodeUrl').value || null,
      status: document.getElementById('fStatus').value,
      remark: document.getElementById('fRemark').value || null,
    };
    Object.assign(body, isSelf ? getSelfShapePayload() : {
      account_type: document.getElementById('fAccountType').value,
    });
    if (isSelf) Object.assign(body, getSelfMetadataPayload());

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
      redeem_key: document.getElementById('fRedeemKey').value.trim() || null,
      shop: sourceShop,
      email: document.getElementById('fEmail').value,
      password: document.getElementById('fPassword').value,
      code_url: document.getElementById('fCodeUrl').value || null,
      status: document.getElementById('fStatus').value,
      remark: document.getElementById('fRemark').value || null,
    };
    Object.assign(body, isSelf ? getSelfShapePayload() : {
      account_type: document.getElementById('fAccountType').value,
    });
    if (isSelf) Object.assign(body, getSelfMetadataPayload());

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

// ---- Quick Import ----
async function openImportModal() {
  if (!isSelfAccountView()) return;
  document.getElementById('importRaw').value = '';
  document.getElementById('importAccountShape').value = 'plus';
  document.getElementById('importResult').style.display = 'none';
  document.getElementById('importResult').innerHTML = '';
  updateImportShapeFields();
  await loadTeamParentOptions(null, null, '', 'importTeamParentId');
  document.getElementById('importOverlay').style.display = 'flex';
}

function closeImportModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('importOverlay').style.display = 'none';
}

function updateImportShapeFields() {
  const shape = document.getElementById('importAccountShape').value;
  document.getElementById('importTeamParentRow').style.display = shape === 'team_child' ? '' : 'none';
}

function getImportShapePayload() {
  const shape = document.getElementById('importAccountShape').value;
  if (shape === 'team_parent') {
    return { account_type: 'Team', team_role: 'parent', team_parent_id: null };
  }
  if (shape === 'team_child') {
    const parentId = document.getElementById('importTeamParentId').value;
    return {
      account_type: 'Team',
      team_role: 'child',
      team_parent_id: parentId ? Number(parentId) : null,
    };
  }
  return { account_type: 'Plus', team_role: null, team_parent_id: null };
}

function renderImportResult(data) {
  const result = document.getElementById('importResult');
  result.style.display = 'block';
  const errorHtml = (data.errors || []).length
    ? `<div class="import-errors">
        ${(data.errors || []).map(err => `
          <div class="import-error-row">
            <strong>第 ${err.line} 行</strong>
            <span>${escapeHtml(err.error)}</span>
            <code>${escapeHtml(truncate(err.raw || '', 96))}</code>
          </div>
        `).join('')}
      </div>`
    : '';
  result.className = `import-result ${data.failed ? 'has-errors' : 'success'}`;
  result.innerHTML = `
    <div class="import-summary">成功 ${data.created || 0} 条，失败 ${data.failed || 0} 条</div>
    ${errorHtml}
  `;
}

async function handleImportSubmit(e) {
  e.preventDefault();
  const rawText = document.getElementById('importRaw').value;
  const btn = document.getElementById('importSubmitBtn');
  if (!rawText.trim()) {
    document.getElementById('importRaw').focus();
    return;
  }

  const body = {
    raw_text: rawText,
    ...getImportShapePayload(),
  };

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 导入中…';
  try {
    const resp = await authFetch(`${API}/accounts/import-self`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (resp.ok) {
      renderImportResult(data);
      if (data.created) {
        loadShopStats();
        loadAccounts();
        showToast(`已导入 ${data.created} 个账号`, 'success');
      }
    } else {
      showToast(data.detail || '导入失败', 'error');
    }
  } catch {
    showToast('网络错误', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '导入';
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
