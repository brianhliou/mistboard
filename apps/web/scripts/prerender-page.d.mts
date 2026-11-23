type PrerenderWindow = {
  happyDOM: { close(): Promise<void> | void };
  localStorage: Storage;
  sessionStorage: Storage;
};

export function createPageRenderer<W extends PrerenderWindow>(options: {
  Window: new (options: { url: string }) => W;
  bootstrap: W;
  install: (window: W) => void;
}): <T>(url: string, render: (page: W) => T | Promise<T>) => Promise<T>;
