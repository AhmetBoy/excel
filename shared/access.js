// Password-based profiles: "temel" (a chosen subset of features), "tam"
// (everything) and "admin" (everything + the Yönetim tab for passwords and
// the temel feature list). The extension is installed unpacked, so this
// keeps casual users out - it is not real security.

export const CONFIG_KEY = 'accessConfig'; // chrome.storage.local
export const SESSION_KEY = 'accessSession'; // chrome.storage.session, cleared when Chrome closes

export const ROLES = ['temel', 'tam', 'admin'];
export const ROLE_LABELS = { temel: 'Temel', tam: 'Tam', admin: 'Admin' };

// Tote Lookup (tote / bin / product scans) is always available.
export const FEATURES = [
  { id: 'userLookup', label: 'Kullanıcı araması (login ile tote/csX)' },
  { id: 'report', label: 'Rapor' },
  { id: 'barcode', label: 'Barkod' },
  { id: 'stowmap', label: 'StowMap' },
  { id: 'rozet', label: 'Rozet (hatalı stow takibi)' },
];
export const ALL_FEATURES = FEATURES.map((f) => f.id);
export const DEFAULT_TEMEL_FEATURES = ['barcode'];

// First-run passwords; the Yönetim tab warns until they are changed.
export const DEFAULT_PASSWORDS = { temel: '1234', tam: '5678', admin: '9999' };
export const MIN_PASSWORD_LENGTH = 4;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

function randomSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

/** A fresh config with the default passwords. */
export async function createDefaultConfig() {
  const salt = randomSalt();
  const hashes = {};
  for (const role of ROLES) hashes[role] = await hashPassword(DEFAULT_PASSWORDS[role], salt);
  return { salt, hashes, temelFeatures: [...DEFAULT_TEMEL_FEATURES], defaults: [...ROLES] };
}

/** Which profile a password opens, or null. */
export async function roleForPassword(config, password) {
  const hash = await hashPassword(password ?? '', config.salt);
  return ROLES.find((role) => config.hashes[role] === hash) ?? null;
}

/** Feature ids a role may use. */
export function featuresForRole(config, role) {
  if (role === 'tam' || role === 'admin') return [...ALL_FEATURES];
  if (role === 'temel') return (config?.temelFeatures ?? DEFAULT_TEMEL_FEATURES).filter((f) => ALL_FEATURES.includes(f));
  return [];
}

/**
 * Sets a new password for `role`. Every profile needs its own password,
 * otherwise a login could not tell them apart.
 *
 * @returns {Promise<{ ok: true, config: object } | { ok: false, error: string }>}
 */
export async function changePassword(config, role, newPassword) {
  if (!ROLES.includes(role)) return { ok: false, error: 'Bilinmeyen profil.' };
  if ((newPassword ?? '').length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı.` };
  }
  const hash = await hashPassword(newPassword, config.salt);
  const clash = ROLES.find((other) => other !== role && config.hashes[other] === hash);
  if (clash) return { ok: false, error: `Bu şifre ${ROLE_LABELS[clash]} profilinde kullanılıyor.` };
  return {
    ok: true,
    config: {
      ...config,
      hashes: { ...config.hashes, [role]: hash },
      defaults: (config.defaults ?? []).filter((r) => r !== role),
    },
  };
}

/* ---------- chrome.storage helpers (side panel and background) ---------- */

export async function loadConfig() {
  const data = await chrome.storage.local.get(CONFIG_KEY);
  if (data[CONFIG_KEY]) return data[CONFIG_KEY];
  const config = await createDefaultConfig();
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
  return config;
}

export async function currentRole() {
  const data = await chrome.storage.session.get(SESSION_KEY);
  return data[SESSION_KEY]?.role ?? null;
}

/** True when the logged-in profile may use `feature`. */
export async function isFeatureAllowed(feature) {
  const role = await currentRole();
  if (!role) return false;
  const data = await chrome.storage.local.get(CONFIG_KEY);
  return featuresForRole(data[CONFIG_KEY], role).includes(feature);
}
