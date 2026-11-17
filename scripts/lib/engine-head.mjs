import { spawnSync } from 'node:child_process';

const ENGINE_REMOTE = 'git@github.com:brianhliou/mistboard-engine.git';

// Both callers need the same remote read, but only an engine deploy treats a
// failed lookup as fatal. Bound SSH and disable prompts for release preflight.
export function readEngineHead({ ref = 'main', run = spawnSync } = {}) {
  try {
    const result = run('git', ['ls-remote', ENGINE_REMOTE, ref], {
      encoding: 'utf8',
      timeout: 5_000,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=3',
      },
    });
    if (result.error) {
      return { error: `git ls-remote failed (${result.error.code ?? 'spawn error'})` };
    }
    if (result.status !== 0) {
      return {
        error: `could not read ${ENGINE_REMOTE} ${ref}: git ls-remote exited ${result.status}`,
      };
    }
    const sha = (result.stdout ?? '').trim().split(/\s+/)[0];
    if (!/^[0-9a-f]{40}$/.test(sha ?? '')) {
      return { error: 'unexpected ls-remote output' };
    }
    return { sha };
  } catch {
    return { error: 'git ls-remote could not start' };
  }
}

export function formatEnginePin(pin, { sha, error } = {}) {
  if (error) return `engine_pin: unknown (${error})`;
  if (!/^[0-9a-f]{7,40}$/.test(pin ?? '')) return 'engine_pin: unknown (invalid engine.ref)';
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) return 'engine_pin: unknown (invalid engine main HEAD)';
  if (sha.startsWith(pin)) return `engine_pin: current (${pin})`;
  return (
    `engine_pin: behind (engine.ref ${pin}, mistboard-engine main ${sha.slice(0, 7)}): ` +
    'run node scripts/deploy-engine-worker.mjs --bump and commit it into this batch, ' +
    'or the next engine-worker deploy refuses'
  );
}
