import assert from 'node:assert/strict';
import { test } from 'node:test';
import { banqiTenant } from './banqi-tenant.js';
import { darkChessTenant } from './dark-chess-tenant.js';
import { darkMiniXiangqiTenant } from './dark-mini-xiangqi-tenant.js';
import { darkXiangqiTenant } from './dark-xiangqi-tenant.js';
import { fortressXiangqiTenant } from './fortress-xiangqi-tenant.js';
import { jieqiTenant } from './jieqi-tenant.js';
import { jungleFlipTenant } from './jungle-flip-tenant.js';
import { jungleTenant } from './jungle-tenant.js';
import { miniXiangqiTenant } from './mini-xiangqi-tenant.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

test('every engine tenant declares its terminal-context transport', () => {
  assert.deepEqual(
    {
      banqi: banqiTenant.engine?.terminalContext,
      darkChess: darkChessTenant.engine?.terminalContext,
      darkMiniXiangqi: darkMiniXiangqiTenant.engine?.terminalContext,
      darkXiangqi: darkXiangqiTenant.engine?.terminalContext,
      fortressXiangqi: fortressXiangqiTenant.engine?.terminalContext,
      jieqi: jieqiTenant.engine?.terminalContext,
      jungleFlip: jungleFlipTenant.engine?.terminalContext,
      jungle: jungleTenant.engine?.terminalContext,
      miniXiangqi: miniXiangqiTenant.engine?.terminalContext,
      xiangqi: xiangqiTenant.engine?.terminalContext,
    },
    {
      banqi: 'repetition-window',
      darkChess: 'fog-observation',
      darkMiniXiangqi: 'fog-observation',
      darkXiangqi: 'fog-observation',
      fortressXiangqi: 'full-history',
      jieqi: 'repetition-window',
      jungleFlip: 'repetition-seed',
      jungle: 'repetition-seed',
      miniXiangqi: 'full-history',
      xiangqi: 'full-history',
    },
  );
});
