import { describe, expect, it } from 'vitest';
import {
  ALL_FEATURES,
  changePassword,
  createDefaultConfig,
  DEFAULT_PASSWORDS,
  featuresForRole,
  roleForPassword,
} from '../shared/access.js';

describe('access profiles', () => {
  it('opens each profile with its own default password', async () => {
    const config = await createDefaultConfig();
    expect(await roleForPassword(config, DEFAULT_PASSWORDS.temel)).toBe('temel');
    expect(await roleForPassword(config, DEFAULT_PASSWORDS.tam)).toBe('tam');
    expect(await roleForPassword(config, DEFAULT_PASSWORDS.admin)).toBe('admin');
    expect(await roleForPassword(config, 'yanlis')).toBeNull();
    expect(config.defaults).toEqual(['temel', 'tam', 'admin']);
  });

  it('stores hashes, not passwords', async () => {
    const config = await createDefaultConfig();
    expect(JSON.stringify(config)).not.toContain(DEFAULT_PASSWORDS.temel);
  });

  it('limits temel to its chosen features; tam and admin get all', async () => {
    const config = { ...(await createDefaultConfig()), temelFeatures: ['barcode', 'stowmap', 'unknown'] };
    expect(featuresForRole(config, 'temel')).toEqual(['barcode', 'stowmap']);
    expect(featuresForRole(config, 'tam')).toEqual(ALL_FEATURES);
    expect(featuresForRole(config, 'admin')).toEqual(ALL_FEATURES);
    expect(featuresForRole(config, null)).toEqual([]);
  });

  it('changes a password and drops it from the defaults warning', async () => {
    const config = await createDefaultConfig();
    const result = await changePassword(config, 'temel', '4321');
    expect(result.ok).toBe(true);
    expect(await roleForPassword(result.config, '4321')).toBe('temel');
    expect(await roleForPassword(result.config, DEFAULT_PASSWORDS.temel)).toBeNull();
    expect(result.config.defaults).toEqual(['tam', 'admin']);
  });

  it('rejects short passwords and one already used by another profile', async () => {
    const config = await createDefaultConfig();
    expect((await changePassword(config, 'temel', '12')).ok).toBe(false);
    const clash = await changePassword(config, 'temel', DEFAULT_PASSWORDS.admin);
    expect(clash).toEqual({ ok: false, error: 'Bu şifre Admin profilinde kullanılıyor.' });
  });
});
