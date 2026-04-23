/* ============================================================
   Codex Account Manager — Frontend Logic
   ============================================================ */

const API = '/api';
let debounceTimer = null;

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadAccounts();
  lucide.createIcons();
});

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
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('已复制', 'success');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('已复制', 'success');
  });
}

// ---- Stats ----
async function loadStats() {
  try {
    const resp = await fetch(`${API}/stats`);
    const data = await resp.json();
    const row = document.getElementById('statsRow');
    row.innerHTML = `
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
        <p class="stat-label">已分配</p>
        <p class="stat-value">${data.assigned}</p>
      </div>
      <div class="stat-card danger">
        <p class="stat-label">已过期</p>
        <p class="stat-value">${data.expired}</p>
      </div>
    `;
  } catch (e) {
    console.error('Failed to load stats:', e);
  }
}

// ---- Account List ----
function debounceLoad() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadAccounts, 300);
}

async function loadAccounts() {
  const search = document.getElementById('searchInput').value.trim();
  const type = document.getElementById('typeFilter').value;
  const status = document.getElementById('statusFilter').value;

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (type) params.set('account_type', type);
  if (status) params.set('status', status);

  try {
    const resp = await fetch(`${API}/accounts?${params}`);
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
          <button class="btn-icon" title="删除" onclick="confirmDelete(${a.id})">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
      <div class="card-fields">
        <div class="field">
          <span class="field-label">邮箱</span>
          <span class="field-value">
            <span>${a.email}</span>
            <button class="copy-btn" onclick="copyText('${escapeJs(a.email)}')"><i data-lucide="copy"></i></button>
          </span>
        </div>
        <div class="field">
          <span class="field-label">密码</span>
          <span class="field-value">
            <span>${a.password}</span>
            <button class="copy-btn" onclick="copyText('${escapeJs(a.password)}')"><i data-lucide="copy"></i></button>
          </span>
        </div>
        <div class="field" style="grid-column: 1 / -1;">
          <span class="field-label">收码链接</span>
          <span class="field-value">
            ${a.code_url
              ? `<a href="${a.code_url}" target="_blank" rel="noopener">${truncate(a.code_url, 60)}</a>
                 <button class="copy-btn" onclick="copyText('${escapeJs(a.code_url)}')"><i data-lucide="copy"></i></button>`
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
  const map = { available: '可用', assigned: '已分配', expired: '已过期' };
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
    const resp = await fetch(`${API}/accounts/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    const data = await resp.json();

    if (resp.ok) {
      msg.className = 'redeem-msg success';
      msg.textContent = `兑换成功！邮箱：${data.email}`;
      msg.style.display = 'block';
      input.value = '';
      loadStats();
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
      const resp = await fetch(`${API}/accounts/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        closeModal();
        loadStats();
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
      account_type: document.getElementById('fAccountType').value,
      email: document.getElementById('fEmail').value,
      password: document.getElementById('fPassword').value,
      code_url: document.getElementById('fCodeUrl').value || null,
      status: document.getElementById('fStatus').value,
      remark: document.getElementById('fRemark').value || null,
    };

    try {
      const resp = await fetch(`${API}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        closeModal();
        loadStats();
        loadAccounts();
        showToast('已添加', 'success');
      } else {
        const data = await resp.json();
        showToast(data.detail || '添加失败', 'error');
      }
    } catch { showToast('网络错误', 'error'); }
  }
}

// ---- Delete ----
let deleteTargetId = null;

function confirmDelete(id) {
  deleteTargetId = id;
  document.getElementById('deleteOverlay').style.display = 'flex';
  document.getElementById('confirmDeleteBtn').onclick = async () => {
    try {
      const resp = await fetch(`${API}/accounts/${id}`, { method: 'DELETE' });
      if (resp.ok) {
        closeDeleteModal();
        loadStats();
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
    const resp = await fetch(`${API}/accounts/${accountId}/fetch-code`, { method: 'POST' });
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
