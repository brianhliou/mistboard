// IndexNow (indexnow.org): the push protocol Bing, Yandex, Naver and Seznam
// share. Bing is the only engine that reaches mainland China and the only one
// that has sent mistboard players (cn.bing on the zh jieqi pages, growth plan
// §5 lane 0), and until 2026-09-20 nothing had ever told it a page existed.
//
// The protocol is two parts: the site proves ownership by serving the key at
// /<key>.txt, and a POST to api.indexnow.org lists the URLs to (re)crawl.
// The key is public by design (any reader can fetch the file); the only thing
// a stranger can do with it is ask Bing to crawl our own URLs, so it lives here
// as a constant rather than as a secret. Submission is `npm run indexnow`
// (scripts/indexnow-submit.mjs), run after a release that adds or changes
// prerendered pages.

export const INDEXNOW_KEY = '93bf96723692b8a61e4f096a8d2aa8f7';

export function indexNowKeyPath(): string {
  return `/${INDEXNOW_KEY}.txt`;
}

export function isIndexNowKeyRequest(pathname: string): boolean {
  return pathname === indexNowKeyPath();
}
