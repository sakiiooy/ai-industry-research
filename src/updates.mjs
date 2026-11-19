/**
 * Bounded, read-only checks for a server-owned list of official sources.
 * A successful check proves retrieval only. It never verifies a financial claim.
 * Pass only the application's fixed source catalog to this function; do not
 * accept arbitrary visitor URLs in an API route.
 */
export const ALLOWED_SOURCE_HOSTS = Object.freeze([
  'global.roborock.com', 'www.ecovacs.com', 'investor.sharkninja.com',
  'media.irobot.com', 'www.nidec.com', 'nvidianews.nvidia.com',
  'www.sec.gov', 'static.sse.com.cn', 'www.mofcom.gov.cn', 'www.gov.cn',
  'newsroom.roborock.com', 'big5.sse.com.cn', 'sw.beijing.gov.cn', 'sww.sh.gov.cn',
]);
export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const allowedHosts = new Set(ALLOWED_SOURCE_HOSTS);

export function validateSourceUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && allowedHosts.has(parsed.hostname) &&
      !parsed.username && !parsed.password && (!parsed.port || parsed.port === '443');
  } catch { return false; }
}

class SourceCheckError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function boundedBytes(response) {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_SOURCE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new SourceCheckError('too_large', '来源文件超过 4 MiB 检查上限；请打开原始资料人工核验。');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SOURCE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new SourceCheckError('too_large', '来源文件超过 4 MiB 检查上限；请打开原始资料人工核验。');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function retryAfterValue(value) {
  if (!value) return null;
  if (/^\d{1,9}$/.test(value.trim())) return value.trim();
  return Number.isFinite(Date.parse(value)) ? new Date(value).toUTCString() : null;
}

async function checkOne(source, fetchImpl, timeoutMs) {
  const result = {
    id: typeof source?.id === 'string' ? source.id.slice(0, 100) : '',
    title: typeof source?.title === 'string' ? source.title.slice(0, 300) : '',
    status: 'error', httpStatus: null, checkedAt: new Date().toISOString(),
    fingerprint: null,
  };
  if (!result.id || !validateSourceUrl(source?.url)) {
    return { ...result, message: '来源地址不在官方 HTTPS 白名单中，未发起请求。' };
  }
  const controller = new AbortController();
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SourceCheckError('timeout', '官方来源检查超时；已保留当前证据库，请稍后手动重试。'));
    }, timeoutMs);
  });
  const operation = (async () => {
    const response = await fetchImpl(source.url, {
      method: 'GET', redirect: 'manual', signal: controller.signal,
      headers: { Accept: 'text/html,application/pdf,text/plain;q=0.8' },
    });
    result.httpStatus = response.status;
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      return { ...result, message: '官方来源返回重定向；未跟随跳转，当前证据库保持不变。' };
    }
    if (response.status === 429) {
      await response.body?.cancel().catch(() => {});
      return {
        ...result, status: 'rate_limited',
        retryAfter: retryAfterValue(response.headers.get('retry-after')),
        message: '官方来源限流；未自动重试，请遵守 Retry-After 后手动检查。',
      };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { ...result, message: `官方来源返回 HTTP ${response.status}；当前证据库保持不变。` };
    }
    const bytes = await boundedBytes(response);
    if (!bytes.byteLength) throw new SourceCheckError('empty', '官方来源返回空内容；未更新当前证据库。');
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const fingerprint = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return {
      ...result, status: 'checked', fingerprint, bytes: bytes.byteLength,
      message: '已获取来源并计算内容指纹。网页变化仅提示待核，不代表财务数字已更新或结论已验证。',
    };
  })();
  try { return await Promise.race([operation, timedOut]); }
  catch (error) {
    return {
      ...result,
      message: error instanceof SourceCheckError ? error.message :
        (controller.signal.aborted ? '官方来源检查超时；当前证据库保持不变。' :
          '官方来源获取失败或发生重定向；未跟随跳转，当前证据库保持不变。'),
    };
  } finally { clearTimeout(timer); }
}

export async function checkSources(sources, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  if (!Array.isArray(sources)) throw new TypeError('sources must be an array');
  if (sources.length > 5) throw new RangeError('At most 5 server-owned sources may be checked');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new RangeError('timeoutMs must be between 1 and 30000');
  }
  const results = new Array(sources.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < sources.length) {
      const index = nextIndex++;
      results[index] = await checkOne(sources[index], fetchImpl, timeoutMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, sources.length) }, worker));
  return results;
}

export const UPDATE_SOURCE_IDS = Object.freeze(['S1', 'S3', 'S5', 'S12']);

/**
 * Create one handler per Worker isolate. The cooldown is best effort within
 * this isolate only: it is not distributed, persistent, per-user rate limiting.
 * Request parameters and visitor-supplied URLs never select outbound targets.
 */
export function createUpdatesHandler(catalog, {
  check = checkSources,
  now = Date.now,
  cooldownMs = 30000,
} = {}) {
  if (!Array.isArray(catalog)) throw new TypeError('A server-owned source catalog is required');
  const fixedSources = UPDATE_SOURCE_IDS.map((id) => catalog.find((source) => source.id === id))
    .filter(Boolean).map((source) => ({ id: source.id, title: source.title, url: source.url }));
  let lastStarted = -Infinity;
  return async function handleUpdates(_request) {
    const timestamp = now();
    const headers = {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    };
    if (timestamp - lastStarted < cooldownMs) {
      return new Response(JSON.stringify({
        results: [], error: 'rate_limited', retryAfter: 30,
        message: '检查过于频繁。请等待 30 秒后手动重试；本限制仅为当前服务实例内的最佳努力保护。',
      }), { status: 429, headers: { ...headers, 'Retry-After': '30' } });
    }
    lastStarted = timestamp;
    try {
      const results = await check(fixedSources);
      return new Response(JSON.stringify({
        results, checkedAt: new Date(timestamp).toISOString(),
        mode: 'source-check',
        notice: '仅检查固定官方来源的可读取状态与内容指纹。变化需人工核验，当前证据库不会被自动覆盖。',
      }), { status: 200, headers });
    } catch {
      return new Response(JSON.stringify({
        results: [], error: 'check_failed',
        message: '来源检查暂时不可用；当前证据库保持不变，请稍后手动重试。',
      }), { status: 503, headers });
    }
  };
}
