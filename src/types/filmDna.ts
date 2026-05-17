/** Film DNA 树中单部影片节点（与 Edge `generate-film-dna` 响应一致）。 */
export type FilmDnaNode = {
  title: string;
  year: number | null;
  note: string;
  /** TMDb 海报 URL（Edge 按 title+year 搜索后附加；无则 UI 仅文本）。 */
  posterUrl?: string;
  /** 与中心节点的关系文案；缺省时由 UI 使用侧栏默认标签。 */
  relation?: string;
};

/** 左（影响来源）— 中（当前片）— 右（影响去向）树结构。 */
export type FilmDnaTree = {
  center: FilmDnaNode;
  left: FilmDnaNode[];
  right: FilmDnaNode[];
  seriesPrevious?: FilmDnaNode[];
  seriesNext?: FilmDnaNode[];
};

/** 调用 `generate-film-dna` 时传入的影片上下文（不含 API 密钥）。 */
export type FilmDnaRequestPayload = {
  title: string;
  year: number;
  director?: string;
  writer?: string;
  genres?: string[];
  plot?: string;
  tagline?: string;
};
