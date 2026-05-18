/** Film DNA 树中单部影片节点（与 Edge `generate-film-dna` 响应一致）。 */
export type FilmDnaNode = {
  title: string;
  year: number | null;
  note: string;
  /** TMDb 海报 URL（Edge 按 title+year 搜索后附加；无则 UI 仅文本）。 */
  posterUrl?: string;
  /** TMDb movie id（系列 enrichment 用；collection 合并时写入）。 */
  tmdbMovieId?: number;
  /** 与中心节点的关系文案；缺省时由 UI 使用侧栏默认标签。 */
  relation?: string;
  /**
   * Influence/Legacy hover 摘要标题（影研语气，一句）。
   * 例：`Blade Runner influenced Gattaca through:`
   */
  relationshipSummaryTitle?: string;
  /** 摘要要点，最多 4 条；短句，无段落。 */
  relationshipBullets?: string[];
  /**
   * 系列垂直链：是否与正上方节点绘制规范续集/前传连线。
   * `false` = 同轴对齐但不连线（重拍、跨时代改编、同源素材等）。
   */
  lineageConnectedAbove?: boolean;
  /**
   * 垂直轴同源/重拍/改编节点；为 true 时方可携带并展示 significanceBullets。
   */
  sameSourceVertical?: boolean;
  /**
   * 悬停 significance 摘要（奖项、文化影响、历史地位），最多 4 条；仅 sameSourceVertical。
   */
  significanceBullets?: string[];
  /**
   * 系列垂直轴悬停摘要：简短剧情（一句）；仅 seriesPrevious / seriesNext。
   */
  plotSummary?: string;
  /**
   * 系列垂直轴悬停摘要：票房原始值（UI 格式化为 `Box office $…`）；仅 seriesPrevious / seriesNext。
   */
  boxOffice?: string;
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
