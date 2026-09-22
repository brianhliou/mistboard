// Fetch the Pikafish NNUE net into public/engine/pikafish/ if it is missing or
// does not match the pin in net.json (url, sha256, bytes). The 51 MB net is
// not tracked in git; upstream publishes it as a rolling `master-net` asset
// with no version, so the pin is what ties the net to the engine commit the
// wasm was built from. Runs before `dev` and `build`; a present, matching file
// costs one hash. Exits non-zero on a hash mismatch rather than serving a net
// the engine will refuse.
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'engine', 'pikafish');
const pin = JSON.parse(await readFile(join(dir, 'net.json'), 'utf8'));
const target = join(dir, pin.file);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function present() {
  try {
    const info = await stat(target);
    if (info.size !== pin.bytes) return false;
    return sha256(await readFile(target)) === pin.sha256;
  } catch {
    return false;
  }
}

if (await present()) {
  console.log(`pikafish net: ${pin.file} present (${pin.bytes} bytes, sha256 ok)`);
} else {
  console.log(`pikafish net: fetching ${pin.url}`);
  const response = await fetch(pin.url, { redirect: 'follow' });
  if (!response.ok) {
    console.error(`pikafish net: ${pin.url} returned HTTP ${response.status}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (bytes.byteLength !== pin.bytes || digest !== pin.sha256) {
    console.error(
      `pikafish net: downloaded ${bytes.byteLength} bytes sha256 ${digest}, ` +
        `net.json pins ${pin.bytes} bytes sha256 ${pin.sha256}. Not written.`,
    );
    process.exit(1);
  }
  await writeFile(target, bytes);
  console.log(`pikafish net: wrote ${target} (${bytes.byteLength} bytes)`);
}
