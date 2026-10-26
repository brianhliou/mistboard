export type PhoneLayoutTargets = { board: string; controls: string[] };

/**
 * Self-contained so Page.evaluate can run it in the browser. Visibility alone
 * does not mean a control fits the screen or receives a real finger tap.
 * Disabled replay arrows still have to be visible; they need not be enabled.
 */
export function phoneLayoutProblems({ board, controls }: PhoneLayoutTargets): string[] {
  const problems: string[] = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) {
    problems.push(
      `horizontal overflow: ${document.documentElement.scrollWidth}px > ${innerWidth}px`,
    );
  }
  for (const selector of [board, ...controls]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) {
      problems.push(`${selector}: missing`);
      continue;
    }
    const box = element.getBoundingClientRect();
    let hidden =
      box.width <= 0 || box.height <= 0 || getComputedStyle(element).visibility === 'hidden';
    // Opacity is not inherited in computed styles; an invisible toolbar still
    // wins elementFromPoint, so check its ancestors as well as the control.
    for (
      let ancestor: HTMLElement | null = element;
      ancestor && !hidden;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      hidden = style.display === 'none' || style.opacity === '0';
    }
    if (hidden) {
      problems.push(`${selector}: hidden`);
      continue;
    }
    if (
      box.left < -1 ||
      box.top < -1 ||
      box.right > innerWidth + 1 ||
      box.bottom > innerHeight + 1
    ) {
      problems.push(`${selector}: outside viewport`);
      continue;
    }
    if (selector !== board) {
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (!hit || !element.contains(hit)) problems.push(`${selector}: covered`);
    }
  }
  return problems;
}
