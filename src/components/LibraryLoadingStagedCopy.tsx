import React, { useEffect, useState } from 'react';

/**
 * 片库加载时按顺序展示的 6 条文案（只播放一遍，无循环）。
 */
export const LIBRARY_LOADING_SEQUENCE_MESSAGES = [
  'Preparing your library…',
  'Checking saved data…',
  'Fetching your movies…',
  'Organizing your collection…',
  'Loading posters…',
  'Opening your library…',
] as const;

const LAST_INDEX = LIBRARY_LOADING_SEQUENCE_MESSAGES.length - 1;

/** 每条文案完整停留时长（ms）。 */
const LINE_DWELL_MS = 1500;

/** 行间垂直替换的 transform 过渡时长（ms），短于停留时间以保持克制。 */
const TRANSITION_MS = 280;

/**
 * 片库加载专用：单行向上替换的分阶段提示（与胶片 spinner 同块）。
 * 序列只前进到最后一句后保持；卸载时清除定时器。
 */
export function LibraryLoadingStagedCopy() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index >= LAST_INDEX) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setIndex((i) => Math.min(i + 1, LAST_INDEX));
    }, LINE_DWELL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [index]);

  const currentLabel = LIBRARY_LOADING_SEQUENCE_MESSAGES[index];

  return (
    <div
      className="relative mx-auto h-5 w-full max-w-[min(100%,22rem)] overflow-hidden text-center"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="sr-only">{currentLabel}</span>
      <div
        className="flex flex-col ease-out will-change-transform transition-transform"
        style={{
          transform: `translateY(-${index * 1.25}rem)`,
          transitionDuration: `${TRANSITION_MS}ms`,
        }}
        aria-hidden
      >
        {LIBRARY_LOADING_SEQUENCE_MESSAGES.map((line) => (
          <p
            key={line}
            className="h-5 shrink-0 text-sm font-medium leading-5 tracking-wide text-white/35"
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
