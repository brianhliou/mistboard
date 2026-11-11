// Native Rapfi inputs extracted from the exact Emscripten data package used by
// the browser. Offsets come from the vendored loader's files table, never from
// executing downloaded JS. Every extracted file has its own repository pin.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = resolve(root, 'apps/web/public/engine/rapfi');
export const BUNDLE = {
  url: 'https://github.com/brianhliou/rapfi-wasm/releases/download/v0.1.0/rapfi-single-simd128.data',
  sha256: 'f61d31b4d98fc53fb43a31a4f0b4357a8b64053bb5762a0967250b873cc9a57e',
  bytes: 40382079,
  networksCommit: '7eeb19b55219a48138756293f92211a1539bab4d',
};

// CC0-1.0 networks and upstream config from config-example/gomocalc-mix9svq.
// Keep all files: the unchanged config names freestyle, standard and renju
// weights plus the classical model. A freestyle-only search loads the first net.
export const FILES = [
  [
    'classical210901.toml',
    0,
    5735,
    '255af22fca7e81f9bf7e212c690705974235b23ec8c8bf033fed97ad74d188fd',
  ],
  [
    'classical220723.toml',
    5735,
    11470,
    '87e46558cfe89760d90a012983e6d4d1e1b48c34c042e7746e64b12649fc434f',
  ],
  [
    'classical260809.toml',
    11470,
    17736,
    '97104e1413472c0d5e0224e729515344bdb5e4a71383117234180bef7781cc6c',
  ],
  ['config.toml', 17736, 24449, '9aee63268cc6be2d8c951304725b7a14a708aa24f0f95eeb5372676e813c3685'],
  [
    'mix9svqfreestyle_bsmix.bin.lz4',
    24449,
    10054847,
    '6bc0d1b0ff8e1d857f7f412923cd458f38f1a435087c91ae71fec3676c23ef62',
  ],
  [
    'mix9svqrenju_bs15_black.bin.lz4',
    10054847,
    20039019,
    '7ab8c974c30da07717ce6a504616a62ac8c981500503f0ced0fadefd3f46c5ec',
  ],
  [
    'mix9svqrenju_bs15_white.bin.lz4',
    20039019,
    29883963,
    'a31f318518d3b5630489054d9eb013fd5353c553999640c2bcfd8d95e6fe4e4e',
  ],
  [
    'mix9svqstandard_bs15.bin.lz4',
    29883963,
    40229738,
    '84334f5db96f45b3e36ebdde06d2259d878ae1eb347b7cf74574ac908b8d9e7d',
  ],
  [
    'model210901.bin',
    40229738,
    40255634,
    'b3425ab5dbb73b25aad6f1c816e4700438c1fca265bf7a9c42aa3c2c006444af',
  ],
  [
    'model220723.bin',
    40255634,
    40324455,
    '63e09d76174d510674480e92349487e5ee72e989caa918733083a60e8090a013',
  ],
  [
    'model260809.bin',
    40324455,
    40382079,
    '8d4f518c58f9c7abe017de383a87d2d7506c62936ea5188004b7eb1780b99393',
  ],
].map(([name, start, end, sha256]) => ({ name, start, end, sha256 }));

export const LICENSES = [
  {
    name: 'rapfi-GPL-3.0.txt',
    source: 'GPL-3.0.txt',
    sha256: '6bab265559d5ebe9f259f2f54e9640bb4c8c8535bacd37c18125231f6fa9acf7',
  },
  {
    name: 'rapfi-NETWORKS-CC0.txt',
    source: 'NETWORKS-CC0.txt',
    sha256: '5537d4d10b76b81b6e8dfd8b644480a4b1efa332fbb0cdb61126c5be781ef7b4',
  },
];

function checked(bytes, pin, label) {
  if (pin.bytes !== undefined && bytes.length !== pin.bytes)
    throw new Error(`${label}: size mismatch`);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== pin.sha256) throw new Error(`${label}: SHA256 ${sha}, expected ${pin.sha256}`);
  return bytes;
}

export async function stage(bin, bundle) {
  const local = resolve(web, 'rapfi-single-simd128.data');
  let bytes;
  if (bundle || existsSync(local)) bytes = await readFile(bundle || local);
  else {
    const response = await fetch(BUNDLE.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Rapfi bundle: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  checked(bytes, BUNDLE, 'Rapfi bundle');
  // Check every slice before writing any of them.
  const extracted = FILES.map((pin) => [
    pin,
    checked(bytes.subarray(pin.start, pin.end), pin, pin.name),
  ]);
  for (const pin of LICENSES)
    extracted.push([pin, checked(await readFile(resolve(web, pin.source)), pin, pin.name)]);
  await mkdir(bin, { recursive: true });
  for (const [pin, content] of extracted) await writeFile(resolve(bin, pin.name), content);
}

export async function check(bin) {
  for (const pin of [...FILES, ...LICENSES])
    checked(await readFile(resolve(bin, pin.name)), pin, pin.name);
}

// Exercise a nonterminal, nonempty position so the engine must search with its
// neural evaluator. A handshake, a classical fallback or a book reply cannot
// pass. Native and browser builds print these same pinned-source messages.
export async function search(bin, { timeoutMs = 15000 } = {}) {
  bin = resolve(bin);
  await check(bin);
  return new Promise((accept, reject) => {
    const child = spawn(resolve(bin, 'rapfi'), [], { cwd: bin, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let failure;
    let move;
    let ending = false;
    const abort = (message) => {
      failure ||= new Error(message);
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => abort('Rapfi search timed out'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdin.on('error', (error) => abort(`Rapfi search stdin: ${error.message}`));
    const receive = (chunk) => {
      output += chunk.toString();
      if (output.length > 1024 * 1024) return abort('Rapfi search output exceeded 1 MB');
      if (/^ERROR\b|failed to load|unable to open|evaluator.*disabled/im.test(output))
        return abort('Rapfi search ERROR loading neural weights/config');
      const reply = /^([0-9]+),([0-9]+)\r?$/m.exec(output);
      if (reply && !ending) {
        ending = true;
        move = { x: Number(reply[1]), y: Number(reply[2]) };
        child.stdin.end('END\n');
      }
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (code !== 0) return reject(new Error(`Rapfi search exited ${code ?? signal}`));
      if (
        !output.includes('MESSAGE Evaluator set to mix9svq.') ||
        !/mix9svq.*weight loaded in/.test(output) ||
        !/mix9svq.*load weight from .*mix9svqfreestyle_bsmix\.bin\.lz4/.test(output)
      ) {
        return reject(new Error('Rapfi neural weight load was not confirmed'));
      }
      if (
        !/^INFO (?:TOTAL)?NODES [1-9][0-9]*\r?$/m.test(output) ||
        !/^INFO EVAL -?[0-9]+\r?$/m.test(output) ||
        !output.includes('INFO PV DONE') ||
        !move ||
        move.x > 14 ||
        move.y > 14 ||
        [
          [7, 7],
          [8, 7],
          [8, 8],
        ].some(([x, y]) => move.x === x && move.y === y)
      ) {
        return reject(new Error('Rapfi search did not return a scored PV and legal move'));
      }
      console.log(`engine-assets: rapfi-search ok (mix9svq loaded, move ${move.x},${move.y})`);
      accept(move);
    });
    child.stdin.write(
      [
        'START 15',
        'INFO rule 0',
        'INFO max_memory 33554432',
        'INFO thread_num 1',
        'INFO show_detail 2',
        'INFO max_node 1000',
        'INFO timeout_turn 1000',
        'YXBOARD',
        '7,7,1',
        '8,7,2',
        '8,8,1',
        'DONE',
        'YXNBEST 1',
        '',
      ].join('\n'),
    );
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, bin, bundle] = process.argv.slice(2);
  try {
    if (command === 'files') console.log([...FILES, ...LICENSES].map((pin) => pin.name).join(' '));
    else if (command === 'manifest') {
      console.log(`rapfi-bundle=sha256:${BUNDLE.sha256}\nrapfi-networks=${BUNDLE.networksCommit}`);
      for (const pin of [...FILES, ...LICENSES]) console.log(`${pin.name}=sha256:${pin.sha256}`);
    } else if (bin && command === 'stage') await stage(resolve(bin), bundle);
    else if (bin && command === 'check') await check(resolve(bin));
    else if (bin && command === 'search') await search(resolve(bin));
    else
      throw new Error(
        'usage: rapfi-assets.mjs files|manifest|stage <bin> [bundle]|check <bin>|search <bin>',
      );
  } catch (error) {
    console.error(`engine-assets: ${error.message}`);
    process.exitCode = 1;
  }
}
