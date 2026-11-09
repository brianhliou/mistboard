export function crawlerDocument(html: string): Document;
export function crawlerCharCount(text: string): number;
export function crawlerText(html: string): string;
export function crawlerContentText(html: string): string;
export function crawlerFacts(
  html: string,
  options?: { contentOnly?: boolean },
): {
  h1: string;
  description: string;
  canonical: string;
  alternates: { lang: string | null; href: string | null }[];
  text: string;
};
