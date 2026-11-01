// Downloads the preloaded Rapfi networks when the local copy is missing or
// does not match the pin in net.json (url, sha256, bytes). The 40 MB file is
// untracked; the release is built by github.com/brianhliou/rapfi-wasm.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'engine', 'rapfi');
const pin = JSON.parse(await readFile(join(dir, 'net.json'), 'utf8'));
const target = join(dir, pin.file);

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
    const response = await fetch(pin.url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`Rapfi net download returned HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
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
