// The preloaded networks are deliberately untracked. Use the staged build
// until net.json has an immutable release URL; verify before writing anything.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'engine', 'rapfi');
const pin = JSON.parse(await readFile(join(dir, 'net.json'), 'utf8'));
const target = join(dir, pin.file);
const staged = join('/Users/brianliou/projects/tools/rapfi-wasm', pin.engineCommit, pin.file);

function verified(bytes) {
  return (
    bytes.byteLength === pin.bytes &&
    createHash('sha256').update(bytes).digest('hex') === pin.sha256
  );
}

async function optionalRead(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

try {
  const present = await optionalRead(target);
  if (present && verified(present)) {
    console.log(`rapfi net: ${pin.file} present (${pin.bytes} bytes, sha256 ok)`);
  } else {
    let bytes = await optionalRead(staged);
    if (!bytes) {
      if (!pin.url) {
        throw new Error(`No Rapfi release URL yet. Stage the pinned data file at ${staged}.`);
      }
      const response = await fetch(pin.url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`Rapfi net download returned HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (!verified(bytes)) {
      throw new Error(
        `Rapfi data does not match net.json (${pin.bytes} bytes, sha256 ${pin.sha256}). Not written.`,
      );
    }
    await writeFile(target, bytes);
    console.log(`rapfi net: wrote ${pin.file} (${pin.bytes} bytes, sha256 ok)`);
  }
} catch (error) {
  console.error(`rapfi net: ${error.message}`);
  process.exitCode = 1;
}
