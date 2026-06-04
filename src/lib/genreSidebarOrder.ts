/** localStorage key：侧栏 Genre 列表自定义顺序（仅本地，不写 Supabase）。 */
export const GENRE_SIDEBAR_ORDER_STORAGE_KEY = 'filmbase_genre_sidebar_order_v1';

/**
 * 读取侧栏 Genre 顺序；损坏或缺失时返回 `null`。
 */
export function loadGenreSidebarOrder(): string[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(GENRE_SIDEBAR_ORDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((item) => typeof item === 'string' && item.length > 0)
    ) {
      return null;
    }
    return parsed as string[];
  } catch {
    return null;
  }
}

/**
 * 将当前顺序写入 localStorage。
 *
 * @param order 展示用 genre 标签序列
 */
export function saveGenreSidebarOrder(order: string[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(GENRE_SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* quota / private mode */
  }
}

/**
 * 将已保存顺序与片库当前 genre 集合合并：保留仍存在的项顺序，新 genre 按字母追加在末尾。
 *
 * @param saved 来自 localStorage 的顺序；`null` 时视为无自定义顺序
 * @param available 当前片库去重后的 genre 标签
 */
export function mergeGenreSidebarOrder(saved: string[] | null, available: string[]): string[] {
  const availSet = new Set(available);
  const result: string[] = [];
  if (saved) {
    for (const g of saved) {
      if (availSet.has(g) && !result.includes(g)) result.push(g);
    }
  }
  const rest = available.filter((g) => !result.includes(g)).sort((a, b) => a.localeCompare(b));
  return [...result, ...rest];
}
