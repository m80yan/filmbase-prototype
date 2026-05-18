import React, { useState } from 'react';

const CLEAR_SEARCH_ICON = {
  default: '/icons/clear-search.svg',
  hover: '/icons/clear-search-hover.svg',
  pressed: '/icons/clear-search-pressed.svg',
} as const;

/**
 * Resolves the clear-search icon asset from pointer interaction state.
 *
 * @param pressed - Primary pointer is down on the button
 * @param hovered - Pointer is over the button
 */
export function getClearSearchIconSrc(pressed: boolean, hovered: boolean): string {
  if (pressed) return CLEAR_SEARCH_ICON.pressed;
  if (hovered) return CLEAR_SEARCH_ICON.hover;
  return CLEAR_SEARCH_ICON.default;
}

type ClearSearchButtonProps = {
  /** Icon dimensions in px (sidebar 14, add-movie 16). */
  iconSize: 14 | 16;
  className?: string;
  disabled?: boolean;
  title?: string;
  /** Called on primary pointer up when not disabled. */
  onClear: (e: React.PointerEvent<HTMLButtonElement>) => void;
  /** Optional extra guard on pointer down (e.g. skip when `isAdding`). */
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
};

/**
 * Clear-search control with default, hover, and pressed icon states.
 */
export function ClearSearchButton({
  iconSize,
  className,
  disabled,
  title = 'Clear search',
  onClear,
  onPointerDown,
}: ClearSearchButtonProps) {
  const [isPressed, setIsPressed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const iconClassName = iconSize === 14 ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => {
        setIsHovered(false);
        setIsPressed(false);
      }}
      onPointerDown={(e) => {
        if (!e.isPrimary) return;
        if (disabled) return;
        onPointerDown?.(e);
        setIsPressed(true);
      }}
      onPointerUp={(e) => {
        if (!e.isPrimary) return;
        if (disabled) return;
        onClear(e);
        setIsPressed(false);
      }}
      onPointerCancel={() => setIsPressed(false)}
      className={className}
      title={title}
    >
      <img
        draggable={false}
        src={getClearSearchIconSrc(isPressed, isHovered)}
        alt=""
        width={iconSize}
        height={iconSize}
        className={`pointer-events-none select-none object-contain ${iconClassName}`}
        decoding="async"
        aria-hidden
      />
    </button>
  );
}
