/** Converts a DOM (node, offset) pair into a plain-text char offset relative to `container`, assuming container's rendered text exactly equals the source string (no extra whitespace injected by markup). */
export function getTextOffsetWithinContainer(container: HTMLElement, node: Node, offset: number): number {
  let total = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current === node) return total + offset;
    total += current.textContent?.length ?? 0;
  }
  return total;
}
