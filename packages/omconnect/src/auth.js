import { resolve } from 'node:path';

/** OAuth tokens stay inside minecraft-protocol/prismarine-auth, never in observations. */
export function authenticationOptions(options, { onCode, isClosed } = {}) {
  if (!['offline', 'microsoft'].includes(options.auth)) throw new Error("auth: offline or microsoft.");
  if (options.auth === 'offline') {
    if (options.realms) throw new Error("Realms requires Microsoft Auth.");
    if (!/^[A-Za-z0-9_]{1,16}$/.test(options.username)) throw new Error("Offline username: 1–16 Latin letters, numbers or _.");
    return { ...options };
  }
  if (typeof options.username !== 'string' || !options.username.trim() || options.username.length > 254) throw new Error("Microsoft username: Inemption of account cache identifier.");
  for (const key of ['password', 'session', 'accessToken']) if (options[key] !== undefined) throw new Error("Microsoft Auth uses the code entry, without password/session/accessToken in settings.");
  if (options.profilesFolder !== undefined && (typeof options.profilesFolder !== 'string' || !options.profilesFolder)) throw new Error("profilesFolder: A path to separate cache of authorization.");
  if (options.onMsaCode !== undefined && typeof options.onMsaCode !== 'function') throw new Error("onMsaCode: function.");
  if (options.realms && (typeof options.realms !== 'object' || Array.isArray(options.realms) || !Number.isSafeInteger(options.realms.realmId) || options.realms.realmId < 1)) throw new Error("realms: { realmId: positive ID available Realm }.");
  const authTimeoutMs = options.authTimeoutMs ?? 180000;
  if (!Number.isInteger(authTimeoutMs) || authTimeoutMs < 1000 || authTimeoutMs > 900000) throw new Error('authTimeoutMs: 1000–900000.');
  return { ...options, authTimeoutMs, profilesFolder: resolve(options.profilesFolder ?? '.cache/omconnect/auth'), onMsaCode(data) {
    if (isClosed?.()) return;
    // The provider's device_code is a credential. Only the short user code is public.
    const code = Object.freeze({ user_code: String(data.user_code ?? ''), verification_uri: String(data.verification_uri ?? 'https://www.microsoft.com/link'), expires_in: Number(data.expires_in) || 0 });
    onCode?.(code); options.onMsaCode?.(code);
  } };
}

export function authenticatedProfile(session) {
  const profile = session?.selectedProfile;
  if (!profile || !/^[A-Za-z0-9_]{1,16}$/.test(profile.name) || !/^[a-fA-F0-9-]{32,36}$/.test(profile.id)) throw new Error("Microsoft Auth: The authorisation server did not return the game profile Java.");
  return Object.freeze({ name: profile.name, uuid: profile.id });
}
