// Railway Infrastructure as Code for the two services this repo deploys (#980).
// It replaces Config as Code (railway.web.json, railway.engine-worker.json),
// which Railway stops reading on 2026-12-01.
//
// The settings live in the JSON files beside this one, so the scripts that
// need them (prod-smoke-plan, engine-deploy-plan, the railway tests) read the
// same values without a TypeScript loader. Change the JSON, not this file.
//
// Railway does not read .railway/ during a deploy. A change here reaches prod
// only through `railway config plan` and then `railway config apply`, run by
// hand at a ship time, since apply redeploys the services it changes.
//
// Named partial on purpose: this file owns web and engine-worker only.
// Postgres and banqi-provider-canary are not declared, and a whole-project
// file would delete them on apply. `variables: { managed: false }` keeps
// apply away from every environment variable.
import type { BuildConfig, DeployConfig } from 'railway/iac';
import { defineRailway, github, project, service } from 'railway/iac';
import engineWorkerConfig from './engine-worker.json' with { type: 'json' };
import webConfig from './web.json' with { type: 'json' };

export const partial = 'mistboard';

export default defineRailway(() => {
  const web = service('web', {
    source: github('brianhliou/mistboard', { branch: 'main', checkSuites: false }),
    build: webConfig.build as BuildConfig,
    deploy: webConfig.deploy as DeployConfig,
    replicas: { 'us-west2': 1 },
    domains: [
      'bichess.org',
      'mistboard.com',
      'socket.mistboard.com',
      'www.bichess.org',
      'www.mistboard.com',
    ],
    networking: { privateNetworkEndpoint: 'respectful-sparkle' },
  });

  // No branch: engine-worker never auto-deploys on push. It deploys only
  // through scripts/deploy-engine-worker.mjs (`railway up`).
  const engineWorker = service('engine-worker', {
    source: github('brianhliou/mistboard'),
    build: engineWorkerConfig.build as BuildConfig,
    deploy: engineWorkerConfig.deploy as DeployConfig,
    replicas: { 'us-west2': 1 },
  });

  return project('mistboard', {
    variables: { managed: false },
    resources: [web, engineWorker],
  });
});
