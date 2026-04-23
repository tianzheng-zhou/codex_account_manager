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
  return t ? { 'Authorization': 'Bearer ' + t } : {};
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

  applyRoleUI();
  switchView('dashboard');
  lucide.createIcons();
}

function applyRoleUI() {
  const isAdmin = currentUser && currentUser.role === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
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
  if (!searchEl || !typeEl || !statusEl) return;

  const search = searchEl.value.trim();
  const type = typeEl.value;
  const status = statusEl.value;

  const params = new URLSearchParams();
  if (currentShop) params.set('shop', currentShop);
  if (search) params.set('search', search);
  if (type) params.set('account_type', type);
  if (status) params.set('status', status);

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

  list.innerHTML = accounts.map(a => `
    <div class="account-card" data-id="${a.id}">
      <div class="card-top">
        <div class="card-badges">
          <span class="badge badge-${a.account_type.toLowerCase()}">${a.account_type}</span>
          <span class="badge badge-${a.status}">${statusLabel(a.status)}</span>
          <span class="ds-meta" style="margin-left:var(--space-2);">${a.redeem_key}</span>
        </div>
        <div class="card-actions">
          <button class="btn-icon" title="编辑" onclick='openEditModal(${JSON.stringify(a)})'>
            <i data-lucide="pencil"></i>
          </button>
          <button class="btn-icon" title="${a.status === 'archived' ? '取消归档' : '归档'}" onclick="toggleArchive(${a.id}, '${a.status}')">
            <i data-lucide="${a.status === 'archived' ? 'archive-restore' : 'archive'}"></i>
          </button>
          ${currentUser && currentUser.role === 'admin' ? `<button class="btn-icon" title="删除" onclick="confirmDelete(${a.id})">
            <i data-lucide="trash-2"></i>
          </button>` : ''}
        </div>
      </div>
      <div class="card-fields">
        <div class="field">
          <span class="field-label">邮箱</span>
          <span class="field-value">
            <span>${a.email}</span>
            <button class="copy-btn" onclick="copyText('${escapeJs(a.email)}', this)"><i data-lucide="copy"></i></button>
          </span>
        </div>
        <div class="field">
          <span class="field-label">密码</span>
          <span class="field-value">
            <span>${a.password}</span>
            <button class="copy-btn" onclick="copyText('${escapeJs(a.password)}', this)"><i data-lucide="copy"></i></button>
          </span>
        </div>
        <div class="field">
          <span class="field-label">收码链接</span>
          <span class="field-value">
            ${a.code_url
              ? `<a href="${a.code_url}" target="_blank" rel="noopener">${truncate(a.code_url, 40)}</a>
                 <button class="copy-btn" onclick="copyText('${escapeJs(a.code_url)}', this)"><i data-lucide="copy"></i></button>`
              : '<span style="color:var(--fg-3)">—</span>'
            }
          </span>
        </div>
      </div>
      <div class="card-bottom">
        <div>
          <span class="card-meta">${a.redeemed_at ? '兑换于 ' + a.redeemed_at : ''}</span>
          ${a.remark ? `<span class="card-remark" style="margin-left:var(--space-3);">${escapeHtml(a.remark)}</span>` : ''}
        </div>
        ${a.code_url ? `
          <button class="btn btn-ghost btn-sm fetch-code-btn" onclick="fetchCode(${a.id})">
            <i data-lucide="mail-check"></i>
            获取验证码
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');

  lucide.createIcons({ nodes: list.querySelectorAll('[data-lucide]') });
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
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeJs(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function truncate(str, len) {
  return str.length > len ? str.substring(0, len) + '…' : str;
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
          <p class="code-number">${data.code}</p>
          <p class="code-time">${data.received_at || ''}</p>
          <button class="btn btn-primary" style="margin-top:var(--space-4);" onclick="copyText('${data.code}')">
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
          <span><span class="badge badge-${u.role}">${u.role === 'admin' ? '管理员' : '用户'}</span></span>
          <span><span class="badge badge-${u.is_approved ? 'available' : 'pending'}">${u.is_approved ? '已激活' : '待审核'}</span></span>
          <span class="ds-meta">${u.created_at ? new Date(u.created_at).toLocaleString('zh-CN') : '—'}</span>
          <span class="cell-actions">
            ${!u.is_approved ? `<button class="btn btn-sm btn-primary" onclick="approveUser(${u.id})">审核通过</button>` : ''}
            ${u.role !== 'admin' ? `<button class="btn btn-sm btn-outline btn-danger-text" onclick="deleteUser(${u.id}, '${escapeJs(u.username)}')">删除</button>` : ''}
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
            <code>${c.code}</code>
            <button class="copy-btn" onclick="copyText('${escapeJs(c.code)}', this)"><i data-lucide="copy"></i></button>
          </span>
          <span><span class="badge badge-${c.used_by ? 'archived' : 'available'}">${c.used_by ? '已使用' : '未使用'}</span></span>
          <span>${c.used_by || '—'}</span>
          <span class="ds-meta">${c.created_at ? new Date(c.created_at).toLocaleString('zh-CN') : '—'}</span>
          <span class="cell-actions">
            <button class="btn btn-sm btn-outline btn-danger-text" onclick="deleteInviteCode(${c.id})">删除</button>
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
