import React, { useState } from 'react';

/** 与 GENRE 标题行 `ChevronRight size={16}` 同宽，保证拖拽把手与 chevron 同一竖列。 */
const GENRE_SIDEBAR_TRAILING_COL_PX = 16;
/** 侧栏滚动区为 scrollbar gutter 预留的空间；继承 `.filmbase-scrollbar` 的 8px 配置。 */
const GENRE_SIDEBAR_SCROLLBAR_GUTTER = 'var(--filmbase-scrollbar-gutter, 8px)';

export type GenreSidebarItemProps = {
  label: string;
  active: boolean;
  iconSlug: string;
  onClick: () => void;
  onHandlePointerDown: (e: React.PointerEvent<HTMLSpanElement>) => void;
  isDragging: boolean;
  isDropTarget: boolean;
};

/**
 * 侧栏 Genre 行：左列图标+筛选；右列 16px 与标题 chevron 对齐的拖拽把手。
 */
export default function GenreSidebarItem({
  label,
  active,
  iconSlug,
  onClick,
  onHandlePointerDown,
  isDragging,
  isDropTarget,
}: GenreSidebarItemProps) {
  const [handleHovered, setHandleHovered] = useState(false);

  return (
    <div
      className={`group/genreitem grid h-9 w-[200px] min-w-0 items-center rounded-md transition-colors ${
        isDragging ? 'opacity-50' : ''
      } ${isDropTarget ? 'ring-1 ring-inset ring-white/20' : ''} ${
        active ? 'bg-[#EB9692]/20' : 'hover:bg-white/5'
      }`}
      style={{
        gridTemplateColumns: `minmax(0, 1fr) ${GENRE_SIDEBAR_TRAILING_COL_PX}px ${GENRE_SIDEBAR_SCROLLBAR_GUTTER}`,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        className={`col-start-1 flex min-w-0 items-center pl-3 pr-0 py-0 text-left text-[13px] transition-colors ${
          active ? 'font-bold text-white' : 'font-medium text-white/70 group-hover/genreitem:text-white'
        }`}
      >
        <span className="relative mr-[10px] h-[20px] w-[20px] shrink-0">
          <img
            draggable={false}
            src={`/icons/${iconSlug}.svg`}
            alt=""
            width={20}
            height={20}
            className={`pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] transition-opacity ${
              active ? 'opacity-0' : 'opacity-100 group-hover/genreitem:opacity-0'
            }`}
            decoding="async"
            aria-hidden
          />
          <img
            draggable={false}
            src={`/icons/${iconSlug}-hover.svg`}
            alt=""
            width={20}
            height={20}
            className={`pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] transition-opacity ${
              active ? 'opacity-100' : 'opacity-0 group-hover/genreitem:opacity-100'
            }`}
            decoding="async"
            aria-hidden
          />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>

      <span
        role="button"
        tabIndex={-1}
        aria-label={`Reorder ${label}`}
        className={`col-start-2 flex h-4 w-4 shrink-0 -translate-x-[3px] touch-none select-none items-center justify-center justify-self-end opacity-0 transition-opacity group-hover/genreitem:opacity-100 ${
          handleHovered || isDragging ? 'opacity-100' : ''
        } ${handleHovered || isDragging ? 'cursor-grab' : 'cursor-default'} active:cursor-grabbing`}
        onPointerDown={onHandlePointerDown}
        onMouseEnter={() => setHandleHovered(true)}
        onMouseLeave={() => setHandleHovered(false)}
      >
        <img
          draggable={false}
          src={handleHovered || isDragging ? '/icons/drag-handel-hover.svg' : '/icons/drag-handel.svg'}
          alt=""
          width={16}
          height={16}
          className="pointer-events-none h-4 w-4 object-contain"
          decoding="async"
          aria-hidden
        />
      </span>
    </div>
  );
}
