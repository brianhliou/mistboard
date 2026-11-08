// A git hook runs its children with GIT_DIR (and often GIT_INDEX_FILE,
// GIT_WORK_TREE) pointing at the repo being pushed or committed. A test
// fixture that spawns git for a scratch repo inherits them, so its `git init`
// and commits land in the real repo instead: on 2026-11-07 the pre-push gate
// ran deploy-engine-worker.test.mjs and left six commits on local main, a
// worktree HEAD repointed at main and core.bare=true. Every fixture that runs
// git, or a script that runs git, for a scratch repo spawns with this env.

/** The given env without any GIT_* variable. */
export function gitFreeEnv(base = process.env) {
  const env = { ...base };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return env;
}
