// Login screen, per-profile tab visibility and the admin ("Yönetim") tab.
// The panel starts with body.locked; nothing but the login form shows
// until a password opens a profile. The session lives in
// chrome.storage.session, so closing Chrome logs out.

import {
  changePassword,
  CONFIG_KEY,
  FEATURES,
  featuresForRole,
  loadConfig,
  roleForPassword,
  ROLE_LABELS,
  ROLES,
  SESSION_KEY,
} from '../shared/access.js';

const loginForm = document.getElementById('login-form');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const roleBadge = document.getElementById('session-role');
const logoutButton = document.getElementById('logout-button');

const defaultWarning = document.getElementById('admin-default-warning');
const passwordForm = document.getElementById('admin-password-form');
const roleSelect = document.getElementById('admin-role');
const currentLabel = document.getElementById('admin-current-label');
const currentInput = document.getElementById('admin-current');
const newInput = document.getElementById('admin-new');
const repeatInput = document.getElementById('admin-repeat');
const passwordStatus = document.getElementById('admin-password-status');
const featuresEl = document.getElementById('admin-features');

let config = null;
let role = null;

/* ---------- profile ---------- */

function tabButton(name) {
  return document.querySelector(`.tab[data-tab="${name}"]`);
}

function applyRole() {
  document.body.classList.toggle('locked', !role);
  if (!role) {
    loginPassword.value = '';
    loginPassword.focus();
    return;
  }

  roleBadge.textContent = ROLE_LABELS[role];
  roleBadge.classList.toggle('is-admin', role === 'admin');

  const allowed = new Set(featuresForRole(config, role));
  for (const feature of ['report', 'barcode', 'stowmap', 'rozet']) {
    tabButton(feature).hidden = !allowed.has(feature);
  }
  tabButton('admin').hidden = role !== 'admin';

  // Leave a tab the profile can no longer see.
  const active = document.querySelector('.tab.active');
  if (!active || active.hidden) tabButton('lookup').click();
  if (tabButton('lookup').classList.contains('active')) document.getElementById('tote-input').focus();
  if (role === 'admin') renderAdmin();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const found = await roleForPassword(config, loginPassword.value);
  if (!found) {
    loginError.textContent = 'Şifre hatalı.';
    loginError.hidden = false;
    loginPassword.select();
    return;
  }
  loginError.hidden = true;
  await chrome.storage.session.set({ [SESSION_KEY]: { role: found, at: Date.now() } });
  // applyRole runs from storage.onChanged
});

logoutButton.addEventListener('click', () => chrome.storage.session.remove(SESSION_KEY));

/* ---------- admin tab ---------- */

for (const r of ROLES) {
  const option = document.createElement('option');
  option.value = r;
  option.textContent = ROLE_LABELS[r];
  roleSelect.append(option);
}

roleSelect.addEventListener('change', () => {
  currentLabel.hidden = roleSelect.value !== 'admin';
  passwordStatus.textContent = '';
});

function setStatus(text, ok) {
  passwordStatus.textContent = text;
  passwordStatus.className = `admin-status ${ok ? 'is-ok' : 'is-error'}`;
}

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const target = roleSelect.value;
  if (newInput.value !== repeatInput.value) {
    setStatus('Yeni şifreler aynı değil.', false);
    return;
  }
  if (target === 'admin' && (await roleForPassword(config, currentInput.value)) !== 'admin') {
    setStatus('Mevcut admin şifresi hatalı.', false);
    return;
  }
  const result = await changePassword(config, target, newInput.value);
  if (!result.ok) {
    setStatus(result.error, false);
    return;
  }
  await chrome.storage.local.set({ [CONFIG_KEY]: result.config });
  passwordForm.reset();
  roleSelect.value = target;
  currentLabel.hidden = target !== 'admin';
  setStatus(`${ROLE_LABELS[target]} şifresi değiştirildi.`, true);
});

function renderAdmin() {
  const defaults = (config.defaults ?? []).map((r) => ROLE_LABELS[r]);
  defaultWarning.hidden = defaults.length === 0;
  defaultWarning.textContent = `Varsayılan şifre kullanılıyor: ${defaults.join(', ')}. Lütfen değiştirin.`;
  currentLabel.hidden = roleSelect.value !== 'admin';

  const enabled = new Set(config.temelFeatures ?? []);
  featuresEl.replaceChildren(
    ...FEATURES.map((feature) => {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = enabled.has(feature.id);
      box.addEventListener('change', () => {
        const next = FEATURES.map((f) => f.id).filter((id) =>
          id === feature.id ? box.checked : enabled.has(id)
        );
        chrome.storage.local.set({ [CONFIG_KEY]: { ...config, temelFeatures: next } });
      });
      label.append(box, document.createTextNode(feature.label));
      return label;
    })
  );
}

/* ---------- storage ---------- */

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[SESSION_KEY]) {
    role = changes[SESSION_KEY].newValue?.role ?? null;
    applyRole();
  }
  if (area === 'local' && changes[CONFIG_KEY]?.newValue) {
    config = changes[CONFIG_KEY].newValue;
    if (role) applyRole();
  }
});

async function init() {
  config = await loadConfig();
  const data = await chrome.storage.session.get(SESSION_KEY);
  role = data[SESSION_KEY]?.role ?? null;
  applyRole();
}

init();
