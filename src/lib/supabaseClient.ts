import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

/**
 * 从 Vite 环境变量创建（并缓存）Supabase 客户端。
 *
 * @returns Supabase 客户端实例
 * @throws 如果缺少 `VITE_SUPABASE_URL` 或 `VITE_SUPABASE_ANON_KEY`
 */
export function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment variables.'
    );
  }

  if (!cachedClient) {
    cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // 确保客户端在本地持久化 session，避免因会话尚未就绪导致的 RLS/Storage 鉴权失败
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }

  return cachedClient;
}

/**
 * 等待直到 `supabase.auth.getUser()` 返回 `user.id`。
 * 用于避免在匿名登录会话尚未就绪时就发起表/Storage 请求。
 *
 * @param supabase Supabase 客户端
 * @param timeoutMs 最长等待时长
 */
async function waitForAuthUid(
  supabase: SupabaseClient,
  timeoutMs: number
): Promise<string> {
  const start = Date.now();
  let lastError: unknown = null;

  while (Date.now() - start < timeoutMs) {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      lastError = error;
    } else if (data.user?.id) {
      return data.user.id;
    }

    // 小延迟避免忙等
    await new Promise((r) => setTimeout(r, 200));
  }

  const errorMsg =
    lastError instanceof Error ? lastError.message : 'Auth uid was not available in time.';
  throw new Error(errorMsg);
}

/**
 * 使用 Supabase 匿名登录，确保 `auth.uid()` 可用（无登录 UI）。
 *
 * @param supabase Supabase 客户端
 * @returns 当前会话对应的用户 uid
 */
export async function signInAnonymously(supabase: SupabaseClient): Promise<string> {
  // 若已有用户会话，直接复用。
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (!userError && userData.user?.id) {
      return userData.user.id;
    }
  } catch {
    // 这里吞掉 AuthSessionMissingError 等“尚未就绪”类错误，
    // 统一走后续匿名登录与等待机制。
  }

  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;

  // 等待 session 写入完成，确保后续任何表/Storage 请求都能拿到 auth.uid()
  return waitForAuthUid(supabase, 10_000);
}

