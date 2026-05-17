import type { SupabaseClient } from '@supabase/supabase-js';
import type { FilmDnaRequestPayload, FilmDnaTree } from '../types/filmDna';

type InvokeErrorBody = {
  error?: string;
  message?: string;
  details?: string;
};

/**
 * 从 Edge Function 非 2xx 或 invoke 错误中提取可展示文案。
 *
 * @param error Supabase `functions.invoke` 的 error
 * @param data  invoke 返回的 data（部分版本在失败时仍带 JSON body）
 */
async function formatFilmDnaInvokeFailure(
  error: unknown,
  data: unknown,
): Promise<string> {
  const parts: string[] = [];

  if (data && typeof data === 'object') {
    const body = data as InvokeErrorBody;
    if (typeof body.details === 'string' && body.details.trim()) {
      parts.push(body.details.trim());
    } else if (typeof body.message === 'string' && body.message.trim()) {
      parts.push(body.message.trim());
    } else if (typeof body.error === 'string' && body.error.trim()) {
      parts.push(body.error.trim());
    }
  }

  if (error && typeof error === 'object') {
    const errObj = error as { message?: string; context?: Response };
    if (errObj.context && typeof errObj.context.json === 'function') {
      try {
        const body = (await errObj.context.json()) as InvokeErrorBody;
        if (typeof body.details === 'string' && body.details.trim()) {
          parts.unshift(body.details.trim());
        } else if (typeof body.message === 'string' && body.message.trim()) {
          parts.unshift(body.message.trim());
        } else if (typeof body.error === 'string' && body.error.trim()) {
          parts.unshift(body.error.trim());
        }
      } catch {
        /* ignore parse failure */
      }
    }
    if (typeof errObj.message === 'string' && errObj.message.trim()) {
      const msg = errObj.message.trim();
      if (!parts.some((p) => p.includes(msg))) {
        parts.push(msg);
      }
    }
  }

  if (parts.length > 0) {
    return parts.join(' — ');
  }

  return 'Film DNA request failed';
}

/**
 * 调用 Supabase Edge Function `generate-film-dna`（OpenAI 仅在服务端）。
 *
 * @param supabase 已鉴权客户端
 * @param payload 当前影片元数据
 * @param signal 可选中止信号（关闭叠层时取消进行中的请求）
 */
export async function invokeGenerateFilmDna(
  supabase: SupabaseClient,
  payload: FilmDnaRequestPayload,
  signal?: AbortSignal,
): Promise<FilmDnaTree> {
  const { data, error } = await supabase.functions.invoke('generate-film-dna', {
    body: payload,
  });

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  if (error) {
    const detail = await formatFilmDnaInvokeFailure(error, data);
    throw new Error(detail);
  }

  const body = data as FilmDnaTree & InvokeErrorBody | null;
  if (!body || typeof body !== 'object') {
    throw new Error('Empty Film DNA response');
  }
  if (body.error) {
    const detail =
      typeof body.details === 'string' && body.details.trim()
        ? body.details.trim()
        : typeof body.message === 'string' && body.message.trim()
          ? body.message.trim()
          : body.error;
    throw new Error(detail);
  }

  if (!body.center || typeof body.center.title !== 'string') {
    throw new Error('Invalid Film DNA response');
  }

  return {
    center: body.center,
    left: Array.isArray(body.left) ? body.left : [],
    right: Array.isArray(body.right) ? body.right : [],
    seriesPrevious: Array.isArray(body.seriesPrevious)
      ? body.seriesPrevious
      : undefined,
    seriesNext: Array.isArray(body.seriesNext) ? body.seriesNext : undefined,
  };
}
