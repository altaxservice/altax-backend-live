/**
 * Powers Previous/Next navigation on detail pages (Client, Task) so a staff
 * member paging through a filtered list doesn't have to go back to the list
 * and re-click the next row. List pages call saveListOrder() with their
 * current filtered/sorted row IDs whenever that order changes; detail pages
 * call useAdjacentIds() to find their neighbors in the last-saved order.
 *
 * sessionStorage (not app state) on purpose: it survives the navigation from
 * list to detail without threading state through the router, is scoped per
 * tab, and degrades safely — if a detail page is opened directly (deep link,
 * refresh, a different entry point that doesn't call saveListOrder), the
 * current ID just won't be found and Previous/Next simply don't render.
 */
const KEY_PREFIX = "listNav:";

export function saveListOrder(entity: "clients" | "tasks", ids: string[]): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + entity, JSON.stringify(ids));
  } catch {
    // Private browsing / storage quota — Previous/Next just won't show up.
  }
}

export function getAdjacentIds(entity: "clients" | "tasks", currentId: string | undefined | null): { prevId: string | null; nextId: string | null } {
  if (!currentId) return { prevId: null, nextId: null };
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + entity);
    if (!raw) return { prevId: null, nextId: null };
    const ids = JSON.parse(raw) as string[];
    const idx = ids.indexOf(currentId);
    if (idx === -1) return { prevId: null, nextId: null };
    return { prevId: idx > 0 ? ids[idx - 1] : null, nextId: idx < ids.length - 1 ? ids[idx + 1] : null };
  } catch {
    return { prevId: null, nextId: null };
  }
}
