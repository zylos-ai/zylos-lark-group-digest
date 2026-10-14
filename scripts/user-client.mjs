import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const REQUIRED_SCOPES = ['im:chat:read', 'im:message.group_msg:get_as_user', 'im:message:readonly'];
const CHAT_SCOPES = ['im:chat:read', 'im:chat:readonly', 'im:chat', 'im:chat.group_info:readonly'];

export class AuthorizationRequired extends Error {
  constructor(scopes = REQUIRED_SCOPES) {
    super('Lark user authorization is missing or expired. Ask the digest owner to authorize the required read permissions.');
    this.code = 'user_authorization_required';
    this.scopes = scopes;
    this.command = `lark-cli auth login --scope "${scopes.join(' ')}" --no-wait --json`;
  }
}

export function checkAuthorization(status) {
  const user = status.identities?.user;
  if (!user || ['missing', 'expired', 'revoked'].includes(user.status) || ['expired', 'revoked'].includes(user.tokenStatus)) {
    throw new AuthorizationRequired();
  }
  if (!user.available || user.status !== 'ready' || user.verified !== true) {
    throw new Error('Could not verify the Lark user session; retry after checking connectivity.');
  }
  const granted = new Set(Array.isArray(user.scope) ? user.scope : (user.scope || '').split(/[\s,]+/));
  const missing = REQUIRED_SCOPES.filter(scope => scope === 'im:chat:read'
    ? !CHAT_SCOPES.some(s => granted.has(s)) : !granted.has(scope));
  if (missing.length) throw new AuthorizationRequired(missing);
  return user;
}

function apiError(envelope) {
  const error = envelope.error || {};
  if (error.type === 'authorization' || [99991679].includes(Number(error.code))) {
    return new AuthorizationRequired(error.missing_scopes?.length ? error.missing_scopes : REQUIRED_SCOPES);
  }
  const failure = new Error(error.message || 'Lark CLI request failed');
  failure.code = error.code || error.subtype;
  return failure;
}

export function createUserClient({ run = exec } = {}) {
  async function cli(args) {
    let stdout;
    try {
      ({ stdout } = await run('lark-cli', args, {
        encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
      }));
    } catch (err) {
      // Do not print execFile's command/stderr wholesale: auth output may be sensitive.
      for (const raw of [err.stderr, err.stdout]) {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { continue; }
        if (args[0] === 'auth' && parsed.identities) return parsed;
        if (parsed.ok === false) throw apiError(parsed);
      }
      throw new Error(err.code === 'ENOENT'
        ? 'lark-cli is not installed; install/configure the Lark component first.'
        : 'Lark CLI failed or timed out; retry the digest after checking connectivity.');
    }
    let result;
    try { result = JSON.parse(stdout); } catch { throw new Error('Lark CLI returned invalid JSON'); }
    if (result.ok === false) throw apiError(result);
    return result;
  }
  return {
    async authorize() { return checkAuthorization(await cli(['auth', 'status', '--json', '--verify'])); },
    async get(endpoint, params) {
      // Raw GET avoids CLI shortcuts requiring unrelated P2P scopes for group reads.
      const result = await cli(['api', 'GET', endpoint, '--as', 'user', '--params', JSON.stringify(params)]);
      if (result.ok !== true || result.identity !== 'user' || !result.data) {
        throw new Error('Expected a successful user-identity Lark response');
      }
      return result.data;
    },
  };
}
