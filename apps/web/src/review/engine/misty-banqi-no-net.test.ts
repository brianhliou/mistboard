// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('keeps Banqi NNUE weights and EvalFile out of public browser assets', () => {
  const root = fileURLToPath(new URL('../../../public/', import.meta.url));
  const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) =>
    entry.isFile(),
  );
  for (const file of files) {
    const path = resolve(file.parentPath, file.name);
    const banqi = /banqi/i.test(relative(root, path));
    expect(/\.bqnn$/i.test(file.name) || (banqi && /\.nnue$/i.test(file.name)), path).toBe(false);
    if (banqi && /\.(?:js|json|wasm|nnue|bqnn)$/i.test(file.name)) {
      expect(readFileSync(path).includes(Buffer.from('EvalFile')), path).toBe(false);
    }
  }
});
