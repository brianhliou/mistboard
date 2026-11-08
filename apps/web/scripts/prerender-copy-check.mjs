import { Window } from 'happy-dom';

const window = new Window({
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});

// Inspect DOM ownership rather than a class substring: a stray class must not
// make bare text before/after the protected copy pass the build.
export function crawlerCopyProblems(fragment) {
  const document = new window.DOMParser().parseFromString(`<body>${fragment}</body>`, 'text/html');
  const problems = [];
  if (!document.querySelector('.crawler-copy')) problems.push('missing crawler-copy wrapper');
  const walk = (node) => {
    if (
      node.nodeType === 3 &&
      node.textContent.trim() &&
      !node.parentElement?.closest('.crawler-copy,script,style,template,svg')
    ) {
      problems.push('page text outside crawler-copy');
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(document.body);
  return [...new Set(problems)];
}
