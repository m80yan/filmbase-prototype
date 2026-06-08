import React, { useState } from 'react';

/** 拖拽手柄 32px 命中区；图标仍通过内部对齐与 GENRE 标题 chevron 保持同列。 */
const GENRE_SIDEBAR_HANDLE_HIT_AREA_PX = 32;
/** 侧栏滚动区为 scrollbar gutter 预留的空间；继承 `.filmbase-scrollbar` 的 8px 配置。 */
const GENRE_SIDEBAR_SCROLLBAR_GUTTER = 'var(--filmbase-scrollbar-gutter, 8px)';

export type GenreSidebarItemProps = {
  label: string;
  count?: number;
  active: boolean;
  iconSlug: string;
  onClick: () => void;
  onHandlePointerDown: (e: React.PointerEvent<HTMLSpanElement>) => void;
  isDragging: boolean;
};

/**
 * 侧栏 Genre 行：左列图标+筛选；右列 16px 与标题 chevron 对齐的拖拽图标。
 */
export default function GenreSidebarItem({
  label,
  count,
  active,
  iconSlug,
  onClick,
  onHandlePointerDown,
  isDragging,
}: GenreSidebarItemProps) {
  const [handleHovered, setHandleHovered] = useState(false);

  return (
    <div
      className={`group/genreitem grid h-9 w-[200px] min-w-0 items-center rounded-md transition-colors ${
        isDragging ? 'opacity-50' : ''
      } ${active ? 'bg-[#EB9692]/20' : 'hover:bg-white/5'}`}
      style={{
        gridTemplateColumns: `minmax(0, 1fr) ${GENRE_SIDEBAR_HANDLE_HIT_AREA_PX}px ${GENRE_SIDEBAR_SCROLLBAR_GUTTER}`,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        className={`col-start-1 flex h-full min-w-0 items-center pl-3 pr-0 py-0 text-left text-[13px] transition-colors ${
          active ? 'font-bold text-white' : 'font-medium text-white/70 group-hover/genreitem:text-white'
        }`}
      >
        <span className="mr-[10px] h-[20px] w-[20px] shrink-0">
          <img
            draggable={false}
            src={`/icons/${iconSlug}.svg`}
            alt=""
            width={20}
            height={20}
            className={`pointer-events-none h-[20px] w-[20px] transition-opacity ${
              active ? 'opacity-100' : 'opacity-40 group-hover/genreitem:opacity-100'
            }`}
            decoding="async"
            aria-hidden
          />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {active && count !== undefined ? <span className="ml-1.5 mr-[-5px] shrink-0">{count}</span> : null}
      </button>

      <span
        role="button"
        tabIndex={-1}
        aria-label={`Reorder ${label}`}
        className={`col-start-2 flex h-8 w-8 shrink-0 -translate-x-[3px] touch-none select-none items-center justify-end justify-self-end opacity-0 transition-opacity group-hover/genreitem:opacity-100 ${
          handleHovered || isDragging ? 'opacity-100' : ''
        } ${handleHovered || isDragging ? 'cursor-grab' : 'cursor-default'} active:cursor-grabbing`}
        onPointerDown={onHandlePointerDown}
        onMouseEnter={() => setHandleHovered(true)}
        onMouseLeave={() => setHandleHovered(false)}
      >
        <img
          draggable={false}
          src="/icons/drag-handel.svg"
          alt=""
          width={16}
          height={16}
          className={`pointer-events-none h-4 w-4 object-contain transition-opacity ${
            handleHovered || isDragging ? 'opacity-100' : 'opacity-40'
          }`}
          decoding="async"
          aria-hidden
        />
      </span>
    </div>
  );
}
