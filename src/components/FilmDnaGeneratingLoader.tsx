import { useEffect, useRef } from "react";

type Props = {
  size?: number;
  className?: string;
};

export function FilmDnaGeneratingLoader({
  size = 96,
  className = "",
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const SVG_NS = "http://www.w3.org/2000/svg";

    const config = {
      particleCount: 75,
      trailSpan: 0.68,
      durationMs: 2400,
      pulseDurationMs: 5900,
      strokeWidth: 7.5,
      lemniscateA: 16,
      lemniscateBoost: 6.8,
    };

    const group = svg.querySelector("#film-dna-loader-group") as SVGGElement;
    const path = svg.querySelector("#film-dna-loader-path") as SVGPathElement;

    path.setAttribute("stroke-width", String(config.strokeWidth));

    const particles = Array.from({ length: config.particleCount }, () => {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("fill", "currentColor");
      group.appendChild(circle);
      return circle;
    });

    const normalizeProgress = (progress: number) =>
      ((progress % 1) + 1) % 1;

    const getDetailScale = (time: number) => {
      const pulseProgress = (time % config.pulseDurationMs) / config.pulseDurationMs;
      const pulseAngle = pulseProgress * Math.PI * 2;
      return 0.52 + ((Math.sin(pulseAngle + 0.55) + 1) / 2) * 0.48;
    };

    const point = (progress: number, detailScale: number) => {
      const t = progress * Math.PI * 2;
      const scale = config.lemniscateA + detailScale * config.lemniscateBoost;
      const denom = 1 + Math.sin(t) ** 2;

      return {
        x: 50 + (scale * Math.cos(t)) / denom,
        y: 50 + (scale * Math.sin(t) * Math.cos(t)) / denom,
      };
    };

    const buildPath = (detailScale: number, steps = 480) =>
      Array.from({ length: steps + 1 }, (_, index) => {
        const p = point(index / steps, detailScale);
        return `${index === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
      }).join(" ");

    const getParticle = (index: number, progress: number, detailScale: number) => {
      const tailOffset = index / (config.particleCount - 1);
      const p = point(normalizeProgress(progress - tailOffset * config.trailSpan), detailScale);
      const fade = Math.pow(1 - tailOffset, 0.56);

      return {
        x: p.x,
        y: p.y,
        radius: 0.9 + fade * 2.7,
        opacity: 0.04 + fade * 0.96,
      };
    };

    const startedAt = performance.now();
    let animationFrame = 0;

    const render = (now: number) => {
      const time = now - startedAt;
      const progress = (time % config.durationMs) / config.durationMs;
      const detailScale = getDetailScale(time);

      path.setAttribute("d", buildPath(detailScale));

      particles.forEach((node, index) => {
        const particle = getParticle(index, progress, detailScale);
        node.setAttribute("cx", particle.x.toFixed(2));
        node.setAttribute("cy", particle.y.toFixed(2));
        node.setAttribute("r", particle.radius.toFixed(2));
        node.setAttribute("opacity", particle.opacity.toFixed(3));
      });

      animationFrame = requestAnimationFrame(render);
    };

    animationFrame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrame);
      particles.forEach((node) => node.remove());
    };
  }, []);

  return (
    <div
      className={`flex items-center justify-center text-white/90 ${className}`}
      style={{ width: size, height: size }}
      aria-label="Generating Film DNA"
    >
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        fill="none"
        className="h-full w-full overflow-visible"
        aria-hidden="true"
      >
        <g id="film-dna-loader-group">
          <path
            id="film-dna-loader-path"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.12"
          />
        </g>
      </svg>
    </div>
  );
}