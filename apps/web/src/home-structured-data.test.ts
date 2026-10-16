import { describe, expect, it } from 'vitest';
import { homeStructuredData, homeStructuredDataScripts } from './home-structured-data.js';

function parseScripts(html: string): Record<string, unknown>[] {
  const docs = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1] ?? '') as Record<string, unknown>,
  );
  return docs;
}

describe('homepage structured data', () => {
  for (const [inLanguage, url, description] of [
    ['en', 'https://mistboard.com/', 'Play Chinese chess (xiangqi) online, free and in English.'],
    [
      'zh-Hans',
      'https://mistboard.com/zh-hans',
      '免费在线下中国象棋：与人对弈或挑战电脑。不用注册。',
    ],
    ['zh-Hant', 'https://mistboard.com/zh-hant', '免費線上下象棋（中國象棋）。免註冊。'],
  ] as const) {
    it(`parses and carries the ${inLanguage} locale`, () => {
      const docs = parseScripts(homeStructuredDataScripts({ inLanguage, url, description }));
      expect(docs.map((d) => d['@type'])).toEqual(['WebSite', 'WebApplication']);
      for (const doc of docs) {
        expect(doc['@context']).toBe('https://schema.org');
        expect(doc.name).toBe('Mistboard');
        expect(doc.url).toBe(url);
        expect(doc.inLanguage).toBe(inLanguage);
      }
      const app = docs[1];
      expect(app?.description).toBe(description);
      expect(app?.applicationCategory).toBe('GameApplication');
      expect(app?.operatingSystem).toBe('Any');
      expect(app?.offers).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
    });
  }

  it('cannot close its own script tag', () => {
    const html = homeStructuredDataScripts({
      inLanguage: 'en',
      url: 'https://mistboard.com/',
      description: 'a </script><script>alert(1)</script> b',
    });
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(parseScripts(html)[1]?.description).toBe('a </script><script>alert(1)</script> b');
  });

  it('returns plain objects for callers that build their own tags', () => {
    const docs = homeStructuredData({ inLanguage: 'en', url: 'https://x/', description: 'd' });
    expect(docs).toHaveLength(2);
  });
});
