import { authFetch } from './clientAuthFetch';

export interface TimedJsonResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

export async function fetchJsonWithTimeout<T>(
  input: string,
  init: RequestInit = {},
  timeoutMs = 12000
): Promise<TimedJsonResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await authFetch(input, {
      ...init,
      signal: init.signal ?? controller.signal,
    });

    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }

    const parsedError =
      data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : undefined;

    return {
      ok: res.ok,
      status: res.status,
      data,
      error: !res.ok ? parsedError || `Request failed (HTTP ${res.status})` : undefined,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      status: isAbort ? 408 : 0,
      data: null,
      error: isAbort
        ? `Request timed out after ${Math.round(timeoutMs / 1000)}s. Please check connection and retry.`
        : err instanceof Error
          ? err.message
          : 'Network request failed.',
    };
  } finally {
    clearTimeout(timer);
  }
}
