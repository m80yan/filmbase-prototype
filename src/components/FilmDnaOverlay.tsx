import { motion } from 'motion/react';
import type { FilmDnaNode, FilmDnaTree } from '../types/filmDna';

type FilmDnaPanelProps = {
  status: 'loading' | 'ready' | 'error';
  tree: FilmDnaTree | null;
  errorMessage: string;
};

/**
 * 将节点年份格式化为展示文案。
 *
 * @param year 年份或 null
 */
function formatFilmDnaYear(year: number | null): string {
  if (year == null || !Number.isFinite(year)) return '';
  return String(Math.round(year));
}

/**
 * Film DNA 单列节点列表（左/右栏）。
 *
 * @param nodes 影响来源或去向
 * @param align 列内文本对齐
 */
function FilmDnaColumn({
  nodes,
  align,
}: {
  nodes: FilmDnaNode[];
  align: 'left' | 'right';
}) {
  const textAlign = align === 'right' ? 'text-right' : 'text-left';

  if (!nodes.length) {
    return (
      <p className={`text-[13px] font-medium text-white/30 ${textAlign}`}>
        —
      </p>
    );
  }

  return (
    <ul className={`flex flex-col gap-4 ${textAlign}`}>
      {nodes.map((node, idx) => (
        <li key={`${node.title}-${idx}`} className="min-w-0">
          <p className="text-[15px] font-semibold leading-snug text-white">
            {node.title}
            {formatFilmDnaYear(node.year) ? (
              <span className="ml-1.5 font-medium text-white/45 tabular-nums">
                ({formatFilmDnaYear(node.year)})
              </span>
            ) : null}
          </p>
          {node.note?.trim() ? (
            <p className="mt-1 text-[12px] font-medium leading-relaxed text-[#EA9794]/90">
              {node.note.trim()}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * 海报预览 Film DNA 模式内容区（与 Info 模式同层叠层，无独立标题栏/关闭按钮）。
 */
export default function FilmDnaPanel({
  status,
  tree,
  errorMessage,
}: FilmDnaPanelProps) {
  return (
    <motion.div
      className="flex min-h-full w-full flex-col items-center justify-center px-4 py-8 sm:px-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      aria-busy={status === 'loading'}
    >
      {status === 'loading' ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <motion.div
            className="h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-[#EA9794]"
            aria-hidden
          />
          <p className="text-[14px] font-semibold text-white/70">
            Generating Film DNA…
          </p>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="max-w-md text-center">
          <p className="text-[14px] font-semibold text-red-300/95">
            {errorMessage || 'Could not generate Film DNA.'}
          </p>
        </div>
      ) : null}

      {status === 'ready' && tree ? (
        <motion.div
          className="grid w-full max-w-[960px] grid-cols-1 gap-10 md:grid-cols-[1fr_minmax(180px,220px)_1fr] md:items-center md:gap-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
        >
          <section aria-label="Influences" className="min-w-0 md:order-1">
            <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white/35">
              Influences
            </p>
            <FilmDnaColumn nodes={tree.left} align="left" />
          </section>

          <section
            aria-label="Current film"
            className="min-w-0 rounded-2xl border border-[#EA9794]/35 bg-[#EA9794]/10 px-5 py-6 text-center md:order-2"
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#EA9794]">
              This film
            </p>
            <p className="mt-3 text-[18px] font-bold leading-snug text-white">
              {tree.center.title}
              {formatFilmDnaYear(tree.center.year) ? (
                <span className="mt-1 block text-[14px] font-semibold text-white/50 tabular-nums">
                  {formatFilmDnaYear(tree.center.year)}
                </span>
              ) : null}
            </p>
            {tree.center.note?.trim() ? (
              <p className="mt-3 text-[13px] font-medium leading-relaxed text-white/65">
                {tree.center.note.trim()}
              </p>
            ) : null}
          </section>

          <section aria-label="Legacy" className="min-w-0 md:order-3">
            <p className="mb-4 text-right text-[11px] font-bold uppercase tracking-[0.18em] text-white/35">
              Legacy
            </p>
            <FilmDnaColumn nodes={tree.right} align="right" />
          </section>
        </motion.div>
      ) : null}
    </motion.div>
  );
}
