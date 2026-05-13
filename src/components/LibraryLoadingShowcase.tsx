import React, { useEffect, useState } from 'react';

/** 与 `public/loading-library/data/loading-posters.json` 条目结构一致。 */
export type LoadingLibraryPosterItem = {
  id: string;
  image: string;
  title: string;
  year: number;
};

const LOADING_POSTERS_JSON_URL = '/loading-library/data/loading-posters.json';

const SHOWCASE_ITEM_MS = 1500;

/**
 * 片库加载时：从本地 JSON 读取条目，按固定间隔轮换展示海报 +「标题 · 年份」单行文案。
 * 仅展示用，不请求 Supabase；卸载时停止定时器。
 */
export function LibraryLoadingShowcase() {
  const [items, setItems] = useState<LoadingLibraryPosterItem[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(LOADING_POSTERS_JSON_URL);
        if (!res.ok || cancelled) return;
        const data: unknown = await res.json();
        if (!Array.isArray(data) || cancelled) return;
        const parsed: LoadingLibraryPosterItem[] = [];
        for (const row of data) {
          if (!row || typeof row !== 'object') continue;
          const r = row as Record<string, unknown>;
          const id = typeof r.id === 'string' ? r.id : '';
          let image = typeof r.image === 'string' ? r.image : '';
          const title = typeof r.title === 'string' ? r.title : '';
          const year = typeof r.year === 'number' && Number.isFinite(r.year) ? r.year : NaN;
          if (!id || !image || !title || Number.isNaN(year)) continue;
          /** 与磁盘 ASCII 文件名对齐；路径中含 ASCII `'` 或 Unicode `'`（U+2019）时易与真实文件名不一致导致 404。 */
          if (
            id === 'a-travelers-needs-2024' ||
            /a-traveler['\u2019]s-needs-2024\.jpg$/i.test(image)
          ) {
            image = '/loading-library/posters/a-travelers-needs-2024.jpg';
          }
          parsed.push({ id, image, title, year });
        }
        if (!cancelled) setItems(parsed);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!items || items.length === 0) return;

    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % items.length);
    }, SHOWCASE_ITEM_MS);

    return () => window.clearInterval(id);
  }, [items]);

  if (!items || items.length === 0) return null;

  const item = items[index % items.length];

  return (
    <div className="flex w-full flex-col items-center" aria-hidden>
      <div className="w-[120px] max-w-[min(40vw,160px)] shrink-0">
        <img
          draggable={false}
          src={encodeURI(item.image)}
          alt=""
          width={120}
          height={180}
          className="pointer-events-none h-[180px] w-full object-cover object-top shadow-lg select-none"
          decoding="async"
        />
      </div>
      <div className="mt-[16px] w-[120px] max-w-[min(40vw,160px)] overflow-visible text-left">
        <div className="inline-block min-w-full w-max max-w-[min(92vw,28rem)] align-top">
          <p className="break-words text-sm font-medium leading-5 tracking-wide text-white/45">
            {item.title}
          </p>
          <p className="text-sm font-medium leading-5 tracking-wide text-white/45">{item.year}</p>
        </div>
      </div>
    </div>
  );
}
