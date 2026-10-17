// Banqi tablebase files: one gzip per material, served as static files from
// public/tablebase/banqi/ (written by scripts/banqi-tablebase/endgame-table.ts
// --export). A file is fetched the first time a covered position needs it and
// kept for the life of the page; there is no server API behind it.
//
// The bytes are gzip on disk. A host that serves them with
// `Content-Encoding: gzip` hands the browser's fetch the decoded bytes instead,
// so the gzip magic is checked rather than assumed.

import {
  type BanqiTablebaseTable,
  banqiTablebaseTableFromBytes,
  banqiTablebaseUrl,
} from '@mistboard/game';

export type BanqiTablebaseLoader = (key: string) => Promise<BanqiTablebaseTable | null>;

const cache = new Map<string, Promise<BanqiTablebaseTable | null>>();

/** The table for one material, or null when it cannot be had. A failed load
 *  is forgotten so a later position asks again; a loaded one stays. */
export function loadBanqiTablebase(key: string): Promise<BanqiTablebaseTable | null> {
  const known = cache.get(key);
  if (known) return known;
  const pending = fetchTable(key)
    .catch(() => null)
    .then((table) => {
      if (!table) cache.delete(key);
      return table;
    });
  cache.set(key, pending);
  return pending;
}

async function fetchTable(key: string): Promise<BanqiTablebaseTable | null> {
  const response = await fetch(banqiTablebaseUrl(key));
  if (!response.ok) return null;
  const body = new Uint8Array(await response.arrayBuffer());
  const bytes = isGzip(body) ? await gunzip(body) : body;
  return banqiTablebaseTableFromBytes(key, bytes);
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
