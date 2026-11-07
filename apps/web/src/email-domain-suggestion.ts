// Suggestions are limited to one edit (including transposition) and a unique
// best match. They never validate or rewrite an address on submit.
const providers = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.de',
  'yahoo.co.uk',
  'yahoo.fr',
  'yahoo.it',
  'yahoo.es',
  'yahoo.ca',
  'yahoo.com.au',
  'yahoo.co.jp',
  'yahoo.com.tw',
  'yahoo.com.hk',
  'yahoo.com.br',
  'yahoo.com.mx',
  'yahoo.co.nz',
  'yahoo.com.sg',
  'yahoo.com.my',
  'yahoo.co.id',
  'yahoo.com.ph',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'qq.com',
  '163.com',
  '126.com',
  'sina.com',
  'gmx.de',
  'web.de',
  'proton.me',
];

export function suggestEmailDomain(address: string): string | null {
  const parts = address.trim().split('@');
  const [name, rawDomain] = parts;
  if (parts.length !== 2 || !name || !rawDomain || /\s/.test(address.trim())) return null;
  const domain = rawDomain.toLowerCase();
  if (domain.length > 253 || providers.includes(domain)) return null;
  const matches = providers.filter((provider) => oneEditApart(domain, provider));
  return matches.length === 1 ? `${name}@${matches[0]}` : null;
}

function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let first = 0;
  while (first < a.length && a[first] === b[first]) first++;
  if (a.length === b.length) {
    if (a.slice(first + 1) === b.slice(first + 1)) return true;
    return (
      a[first] === b[first + 1] &&
      a[first + 1] === b[first] &&
      a.slice(first + 2) === b.slice(first + 2)
    );
  }
  return a.length > b.length
    ? a.slice(first + 1) === b.slice(first)
    : a.slice(first) === b.slice(first + 1);
}
