/// <reference lib="deno.ns" />
/**
 * Supabase Edge Function：根据影片元数据生成 Film DNA 左—中—右树（OpenAI，仅服务端）。
 *
 * Secrets（Dashboard → Edge Functions → Secrets）：
 * - `OPENAI_API_KEY`：不得暴露给前端
 */

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const LOG_PREFIX = "[generate-film-dna]";

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

type FilmDnaRequestBody = {
  title?: string;
  year?: number;
  director?: string;
  writer?: string;
  genres?: string[];
  plot?: string;
  tagline?: string;
};

type FilmDnaNode = {
  title: string;
  year: number | null;
  note: string;
};

type FilmDnaTree = {
  center: FilmDnaNode;
  left: FilmDnaNode[];
  right: FilmDnaNode[];
};

type OpenAiChatResponse = {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
  error?: { message?: string; type?: string; code?: string };
};

type ErrorJsonBody = {
  error: string;
  message?: string;
  details?: string;
};

/**
 * 截断并去除可能含密钥的片段（仅用于日志/客户端 details）。
 *
 * @param text 原始文本
 * @param maxLen 最大长度
 */
function sanitizeForClient(text: string, maxLen = 500): string {
  const trimmed = text
    .replace(/Bearer\s+\S+/gi, "[redacted]")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]")
    .trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

/**
 * 统一 JSON 错误响应（始终带 CORS）。
 *
 * @param status HTTP 状态码
 * @param body 错误体
 */
function jsonError(status: number, body: ErrorJsonBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

/**
 * 规范化 LLM 返回的单个节点。
 *
 * @param raw 原始对象
 */
function normalizeNode(raw: unknown): FilmDnaNode | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title) return null;
  let year: number | null = null;
  if (typeof o.year === "number" && Number.isFinite(o.year)) {
    year = Math.round(o.year);
  } else if (typeof o.year === "string" && /^\d{4}$/.test(o.year.trim())) {
    year = Number(o.year.trim());
  }
  const note = typeof o.note === "string" ? o.note.trim() : "";
  return { title, year, note };
}

/**
 * 解析并校验 OpenAI JSON 输出为 Film DNA 树。
 *
 * @param parsed 已 `JSON.parse` 的对象
 * @param fallbackTitle 请求中的片名（用于补全 center）
 * @param fallbackYear 请求年份
 */
function parseFilmDnaTree(
  parsed: unknown,
  fallbackTitle: string,
  fallbackYear: number | null,
): FilmDnaTree | null {
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;

  const centerRaw = root.center;
  const center =
    normalizeNode(centerRaw) ??
    ({
      title: fallbackTitle,
      year: fallbackYear,
      note: "",
    } satisfies FilmDnaNode);

  const left: FilmDnaNode[] = [];
  if (Array.isArray(root.left)) {
    for (const item of root.left) {
      const n = normalizeNode(item);
      if (n) left.push(n);
      if (left.length >= 4) break;
    }
  }

  const right: FilmDnaNode[] = [];
  if (Array.isArray(root.right)) {
    for (const item of root.right) {
      const n = normalizeNode(item);
      if (n) right.push(n);
      if (right.length >= 4) break;
    }
  }

  return { center, left, right };
}

/**
 * 构建发给 OpenAI 的用户提示（仅使用客户端已知的库内元数据，无联网检索）。
 */
function buildUserPrompt(body: FilmDnaRequestBody): string {
  const lines: string[] = [
    `Title: ${(body.title ?? "").trim()}`,
  ];
  if (typeof body.year === "number" && Number.isFinite(body.year)) {
    lines.push(`Year: ${Math.round(body.year)}`);
  }
  const director = (body.director ?? "").trim();
  if (director) lines.push(`Director: ${director}`);
  const writer = (body.writer ?? "").trim();
  if (writer) lines.push(`Writer: ${writer}`);
  const genres = (body.genres ?? []).filter((g) => typeof g === "string" && g.trim());
  if (genres.length) lines.push(`Genres: ${genres.join(", ")}`);
  const tagline = (body.tagline ?? "").trim();
  if (tagline) lines.push(`Tagline: ${tagline}`);
  const plot = (body.plot ?? "").trim();
  if (plot) lines.push(`Plot: ${plot.slice(0, 1200)}`);
  return lines.join("\n");
}

Deno.serve(async (req) => {
  try {
    console.log(`${LOG_PREFIX} request start`, {
      method: req.method,
      hasOpenAiApiKey: Boolean(Deno.env.get("OPENAI_API_KEY")?.trim()),
    });

    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonError(405, { error: "Method not allowed", message: "Use POST" });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey?.trim()) {
      console.error(`${LOG_PREFIX} OPENAI_API_KEY is not set`);
      return jsonError(500, {
        error: "Server misconfiguration",
        message: "OPENAI_API_KEY is not set",
        details: "Set OPENAI_API_KEY in Supabase Edge Function secrets.",
      });
    }

    let body: FilmDnaRequestBody = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text) as FilmDnaRequestBody;
    } catch (parseErr) {
      console.error(`${LOG_PREFIX} invalid JSON body`, parseErr);
      return jsonError(400, {
        error: "Invalid JSON body",
        details: "Request body must be valid JSON.",
      });
    }

    const title = (body.title ?? "").trim();
    const year =
      typeof body.year === "number" && Number.isFinite(body.year)
        ? Math.round(body.year)
        : null;

    console.log(`${LOG_PREFIX} incoming`, { title, year });

    if (!title) {
      return jsonError(400, {
        error: "Bad request",
        message: "Missing title",
        details: "Field `title` is required.",
      });
    }

    const fallbackYear = year;

    const systemPrompt = `You are a concise film historian. Given metadata about one film, output ONLY valid JSON (no markdown) with this exact shape:
{
  "center": { "title": string, "year": number|null, "note": string },
  "left": [{ "title": string, "year": number|null, "note": string }],
  "right": [{ "title": string, "year": number|null, "note": string }]
}
Rules:
- center must be the subject film (use the provided title and year when known).
- left: 2 to 4 real films that clearly influenced this work (style, themes, craft, genre lineage).
- right: 2 to 4 real films this work influenced or is in clear dialogue with (legacy, successors, homages).
- Each note: one short phrase, max 12 words, no URLs, no citations, no footnotes.
- Use English for notes. Real film titles only.`;

    console.log(`${LOG_PREFIX} calling OpenAI`, { model: OPENAI_MODEL });

    const openAiRes = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.45,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildUserPrompt(body) },
        ],
      }),
    });

    console.log(`${LOG_PREFIX} OpenAI response status`, openAiRes.status);

    const openAiText = await openAiRes.text();

    if (!openAiRes.ok) {
      console.error(`${LOG_PREFIX} OpenAI error body`, openAiText);
      let openAiMessage = `HTTP ${openAiRes.status}`;
      try {
        const errJson = JSON.parse(openAiText) as OpenAiChatResponse;
        if (errJson.error?.message) {
          openAiMessage = sanitizeForClient(errJson.error.message, 300);
        }
      } catch {
        openAiMessage = sanitizeForClient(openAiText, 300);
      }
      return jsonError(502, {
        error: "OpenAI request failed",
        message: openAiMessage,
        details: `OpenAI returned status ${openAiRes.status}. ${openAiMessage}`,
      });
    }

    let openAiJson: OpenAiChatResponse;
    try {
      openAiJson = JSON.parse(openAiText) as OpenAiChatResponse;
    } catch (parseErr) {
      console.error(`${LOG_PREFIX} OpenAI envelope parse failed`, parseErr);
      console.error(`${LOG_PREFIX} OpenAI raw text`, openAiText.slice(0, 2000));
      return jsonError(502, {
        error: "OpenAI response parse failed",
        message: "Could not parse OpenAI JSON envelope",
        details: sanitizeForClient(openAiText, 400),
      });
    }

    const content = openAiJson.choices?.[0]?.message?.content;
    if (!content?.trim()) {
      console.error(`${LOG_PREFIX} OpenAI empty content`, openAiText.slice(0, 2000));
      return jsonError(502, {
        error: "OpenAI empty content",
        message: "No completion returned",
        details: "choices[0].message.content was empty.",
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      console.error(`${LOG_PREFIX} model JSON parse failed`, parseErr);
      console.error(`${LOG_PREFIX} raw model output`, content);
      return jsonError(500, {
        error: "Invalid model JSON",
        message: "Model did not return parseable JSON",
        details: sanitizeForClient(content, 600),
      });
    }

    const tree = parseFilmDnaTree(parsed, title, fallbackYear);
    if (!tree) {
      console.error(`${LOG_PREFIX} invalid Film DNA shape`, parsed);
      return jsonError(500, {
        error: "Invalid Film DNA shape",
        message: "Could not normalize tree",
        details: "Parsed JSON did not match expected center/left/right shape.",
      });
    }

    console.log(`${LOG_PREFIX} success`, {
      title,
      leftCount: tree.left.length,
      rightCount: tree.right.length,
    });

    return new Response(JSON.stringify(tree), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "UnknownError";
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`${LOG_PREFIX} unexpected error`, { name, message, stack });
    return jsonError(500, {
      error: "Internal server error",
      message: sanitizeForClient(message, 200),
      details: stack ? sanitizeForClient(stack, 800) : message,
    });
  }
});
