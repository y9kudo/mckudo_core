import { resolve } from 'node:path';

/** OAuth tokens stay inside minecraft-protocol/prismarine-auth, never in observations. */
export function authenticationOptions(options, { onCode, isClosed } = {}) {
  if (!['offline', 'microsoft'].includes(options.auth)) throw new Error('auth: offline или microsoft.');
  if (options.auth === 'offline') {
    if (options.realms) throw new Error('Realms требует Microsoft Auth.');
    if (!/^[A-Za-z0-9_]{1,16}$/.test(options.username)) throw new Error('Offline username: 1–16 латинских букв, цифр или _.');
    return { ...options };
  }
  if (typeof options.username !== 'string' || !options.username.trim() || options.username.length > 254) throw new Error('Microsoft username: непустой идентификатор кэша аккаунта.');
  for (const key of ['password', 'session', 'accessToken']) if (options[key] !== undefined) throw new Error('Microsoft Auth использует вход по коду, без password/session/accessToken в настройках.');
  if (options.profilesFolder !== undefined && (typeof options.profilesFolder !== 'string' || !options.profilesFolder)) throw new Error('profilesFolder: путь к отдельному кэшу авторизации.');
  if (options.onMsaCode !== undefined && typeof options.onMsaCode !== 'function') throw new Error('onMsaCode: функция.');
  if (options.realms && (typeof options.realms !== 'object' || Array.isArray(options.realms) || !Number.isSafeInteger(options.realms.realmId) || options.realms.realmId < 1)) throw new Error('realms: { realmId: положительный ID доступного Realm }.');
  const authTimeoutMs = options.authTimeoutMs ?? 180000;
  if (!Number.isInteger(authTimeoutMs) || authTimeoutMs < 1000 || authTimeoutMs > 900000) throw new Error('authTimeoutMs: 1000–900000.');
  return { ...options, authTimeoutMs, profilesFolder: resolve(options.profilesFolder ?? '.cache/kudoconnect/auth'), onMsaCode(data) {
    if (isClosed?.()) return;
    // The provider's device_code is a credential. Only the short user code is public.
    const code = Object.freeze({ user_code: String(data.user_code ?? ''), verification_uri: String(data.verification_uri ?? 'https://www.microsoft.com/link'), expires_in: Number(data.expires_in) || 0 });
    onCode?.(code); options.onMsaCode?.(code);
  } };
}

export function authenticatedProfile(session) {
  const profile = session?.selectedProfile;
  if (!profile || !/^[A-Za-z0-9_]{1,16}$/.test(profile.name) || !/^[a-fA-F0-9-]{32,36}$/.test(profile.id)) throw new Error('Microsoft Auth: сервер авторизации не вернул игровой профиль Java.');
  return Object.freeze({ name: profile.name, uuid: profile.id });
}
