import React, { useState } from 'react';

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

/** Clear-search control with a code-drawn circular background and shared X asset. */
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

  const xSize = iconSize === 14 ? 6 : 8;
  const backgroundColor = isPressed
    ? '#FFFFFF'
    : isHovered
      ? '#EA9794'
      : 'rgba(255, 255, 255, 0.40)';

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
      style={{ backgroundColor }}
      title={title}
    >
      <img
        draggable={false}
        src="/icons/clear-x.svg"
        alt=""
        width={xSize}
        height={xSize}
        className="pointer-events-none select-none object-contain"
        style={{ width: xSize, height: xSize }}
        decoding="async"
        aria-hidden
      />
    </button>
  );
}
