// Worker-only bundle replacement for the web runtime's DB/email observability.
// No arbitrary fields or engine diagnostics leave this process through this shim.
export const logger = { warn: () => console.warn('{"kind":"banqi_host_pool_busy"}') };
export const dispatchAlertEmail = () => {};
export const logEnginePoolWait = () => {};
export const recordEnginePoolWait = () => {};
