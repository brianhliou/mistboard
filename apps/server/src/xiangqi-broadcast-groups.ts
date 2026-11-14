// Group labels are stripped only at the end of an event name. Removing words
// from the middle would merge distinct series (for example the two leagues).
export function dpxqEventGroup(name: string): { event: string; suffix: string | null } {
  const compact = name.replace(/[\s　]+/g, '');
  const match = compact.match(
    /^(.*?)[（(【:：—_-]*((?:女子|男子|男女混合|混合|公开|其他|其它)(?:团体|个人)?(?:组别|组)?|(?:团体|个人)(?:组别|组)?)[）)】]*$/,
  );
  if (!match?.[1]) return { event: compact, suffix: null };
  // A year alone is not an event identity, even when the dates overlap.
  if (!/\p{L}/u.test(match[1].replace(/\d{4}年?/g, ''))) {
    return { event: compact, suffix: null };
  }
  const group = match[2];
  const suffix = group.startsWith('女子')
    ? 'women'
    : group.startsWith('男子')
      ? 'men'
      : /混合/.test(group)
        ? 'mixed'
        : group.startsWith('公开')
          ? 'open'
          : /^其[他它]/.test(group)
            ? 'other'
            : group.startsWith('团体')
              ? 'team'
              : 'individual';
  return { event: match[1], suffix };
}

/** Generated slugs append one of these group labels to the parent's slug. */
export function xiangqiBroadcastParentSlug(slug: string): string | null {
  const parent = slug.replace(/-(?:women|men|mixed|open|other|team|individual)$/, '');
  return parent === slug ? null : parent;
}
