export const SLIDESHOW_LOOKAHEAD = 4;

export type SlideshowLayerRole = "upcoming" | "outgoing" | "current";

const ROLE_RANK: Record<SlideshowLayerRole, number> = {
  upcoming: 0,
  outgoing: 1,
  current: 2,
};

export function nextSlideshowIndex(index: number, length: number): number {
  if (length <= 1) {
    return 0;
  }
  return (index + 1) % length;
}

export function slideshowLayers<T extends { url: string }>(
  slides: readonly T[],
  index: number,
  previousIndex: number | null,
  fade: boolean,
  lookahead = SLIDESHOW_LOOKAHEAD,
): Array<{ item: T; role: SlideshowLayerRole; index: number }> {
  const length = slides.length;
  if (length === 0) {
    return [];
  }
  const safeIndex = ((index % length) + length) % length;
  const roles = new Map<
    string,
    { item: T; role: SlideshowLayerRole; index: number }
  >();
  const assign = (slideIndex: number, role: SlideshowLayerRole) => {
    const item = slides[slideIndex];
    if (!item) {
      return;
    }
    const existing = roles.get(item.url);
    if (existing && ROLE_RANK[existing.role] >= ROLE_RANK[role]) {
      return;
    }
    roles.set(item.url, { item, role, index: slideIndex });
  };

  const ahead = Math.min(lookahead, Math.max(0, length - 1));
  for (let hop = 1; hop <= ahead; hop += 1) {
    assign((safeIndex + hop) % length, "upcoming");
  }
  if (fade && previousIndex != null) {
    const previous = ((previousIndex % length) + length) % length;
    if (previous !== safeIndex) {
      assign(previous, "outgoing");
    }
  }
  assign(safeIndex, "current");

  return [...roles.values()].sort(
    (left, right) => ROLE_RANK[left.role] - ROLE_RANK[right.role],
  );
}
