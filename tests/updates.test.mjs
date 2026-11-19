import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSources, validateSourceUrl, MAX_SOURCE_BYTES, createUpdatesHandler } from '../src/updates.mjs';

const source = (id = 'S1') => ({ id, title: 'Official report', url: `https://global.roborock.com/pages/${id}` });

test('only exact HTTPS official hosts, no userinfo or arbitrary ports', () => {
  assert.equal(validateSourceUrl(source().url), true);
  for (const url of ['http://global.roborock.com/a', 'https://global.roborock.com.evil.test/a',
    'https://127.0.0.1/a', 'https://global.roborock.com:8080/a',
    'https://name:secret@global.roborock.com/a', 'javascript:alert(1)', 'bad url']) {
    assert.equal(validateSourceUrl(url), false, url);
  }
});

test('successful HTML is hashed, only retrieval is claimed', async () => {
  let options;
  const results = await checkSources([source()], { fetchImpl: async (_url, opts) => {
    options = opts;
    return new Response('<html>report</html>', { headers: { 'content-type': 'text/html' } });
  } });
  assert.equal(options.redirect, 'manual');
  assert.equal(options.method, 'GET');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(results[0].status, 'checked');
  assert.match(results[0].fingerprint, /^[a-f0-9]{64}$/);
  assert.match(results[0].message, /不代表/);
  assert.equal(results[0].httpStatus, 200);
});

test('PDF bytes are hashed without extraction and stable across checks', async () => {
  const fetchImpl = async () => new Response('%PDF-1.4 sample', { headers: { 'content-type': 'application/pdf' } });
  const [a, b] = await Promise.all([
    checkSources([source()], { fetchImpl }), checkSources([source()], { fetchImpl }),
  ]);
  assert.equal(a[0].fingerprint, b[0].fingerprint);
});

test('invalid source URL is rejected before any request', async () => {
  let called = 0;
  const [result] = await checkSources([{ ...source(), url: 'https://evil.test/' }], {
    fetchImpl: async () => { called++; return new Response('oops'); },
  });
  assert.equal(called, 0);
  assert.equal(result.status, 'error');
  assert.match(result.message, /白名单/);
});

test('redirect failure is independent and no retry is attempted', async () => {
  let called = 0;
  const [result] = await checkSources([source()], { fetchImpl: async (_url, options) => {
    called++; assert.equal(options.redirect, 'manual'); throw new TypeError('fetch failed: redirect');
  } });
  assert.equal(called, 1);
  assert.equal(result.status, 'error');
  assert.match(result.message, /重定向/);
});

test('500 preserves other source results in input order', async () => {
  const results = await checkSources([source('bad'), source('good')], { fetchImpl: async (url) =>
    url.endsWith('bad') ? new Response('error', { status: 500 }) : new Response('valid report'),
  });
  assert.deepEqual(results.map((x) => x.id), ['bad', 'good']);
  assert.deepEqual(results.map((x) => x.status), ['error', 'checked']);
  assert.equal(results[0].httpStatus, 500);
});

test('429 exposes valid Retry-After and does not replay request', async () => {
  let called = 0;
  const [result] = await checkSources([source()], { fetchImpl: async () => {
    called++; return new Response('busy', { status: 429, headers: { 'retry-after': '120' } });
  } });
  assert.equal(called, 1);
  assert.equal(result.status, 'rate_limited');
  assert.equal(result.retryAfter, '120');
});

test('empty successful body is an error', async () => {
  const [result] = await checkSources([source()], { fetchImpl: async () => new Response('') });
  assert.equal(result.status, 'error'); assert.match(result.message, /空内容/);
});

test('size limit checks both content-length and streamed bytes', async () => {
  for (const fetchImpl of [
    async () => new Response('small', { headers: { 'content-length': String(MAX_SOURCE_BYTES + 1) } }),
    async () => new Response(new Uint8Array(MAX_SOURCE_BYTES + 1)),
  ]) {
    const [result] = await checkSources([source()], { fetchImpl });
    assert.equal(result.status, 'error'); assert.match(result.message, /4 MiB/);
  }
});

test('timeout resolves even if provider ignores the abort signal', async () => {
  let signal;
  const [result] = await checkSources([source()], { timeoutMs: 10,
    fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); },
  });
  assert.equal(result.status, 'error'); assert.equal(signal.aborted, true);
  assert.match(result.message, /超时/);
});

test('concurrency is bounded to three; all five results are retained', async () => {
  let active = 0, peak = 0;
  const results = await checkSources(Array.from({ length: 5 }, (_, i) => source(String(i))), {
    fetchImpl: async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5)); active--;
      return new Response('report');
    },
  });
  assert.equal(peak, 3); assert.equal(results.length, 5);
  assert.ok(results.every((x) => x.status === 'checked'));
});

test('invalid collection and timeout bounds reject, empty collection succeeds', async () => {
  await assert.rejects(checkSources(null), TypeError);
  await assert.rejects(checkSources(Array.from({ length: 6 }, () => source())), RangeError);
  await assert.rejects(checkSources([source()], { timeoutMs: 0 }), RangeError);
  assert.deepEqual(await checkSources([]), []);
});

const catalog = ['S1', 'S2', 'S3', 'S5', 'S12', 'S99'].map((id) => source(id));

test('API handler uses only fixed catalog targets, ignoring all request URL input', async () => {
  let targets;
  const handler = createUpdatesHandler(catalog, { now: () => 0, check: async (sources) => {
    targets = sources; return sources.map((item) => ({ id: item.id, status: 'checked' }));
  } });
  const response = await handler(new Request('https://app.test/api/updates?url=https://evil.test/&source=S99'));
  assert.equal(response.status, 200);
  assert.deepEqual(targets.map((item) => item.id), ['S1', 'S3', 'S5', 'S12']);
  assert.ok(targets.every((item) => item.url.startsWith('https://global.roborock.com/')));
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  const body = await response.json();
  assert.equal(body.results.length, 4);
  assert.match(body.notice, /人工核验/);
});

test('API best-effort isolate cooldown rejects repeated calls without another check', async () => {
  let timestamp = 0, checks = 0;
  const handler = createUpdatesHandler(catalog, { now: () => timestamp, check: async () => { checks++; return []; } });
  assert.equal((await handler()).status, 200);
  timestamp = 29999;
  const blocked = await handler();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '30');
  assert.equal(checks, 1);
  assert.equal((await blocked.json()).error, 'rate_limited');
  timestamp = 30000;
  assert.equal((await handler()).status, 200);
  assert.equal(checks, 2);
});

test('API concurrent request is cooled down while the first check is in flight', async () => {
  let resolveCheck;
  const handler = createUpdatesHandler(catalog, {
    now: () => 0, check: () => new Promise((resolve) => { resolveCheck = resolve; }),
  });
  const pending = handler();
  assert.equal((await handler()).status, 429);
  resolveCheck([]);
  assert.equal((await pending).status, 200);
});

test('API check failure returns a non-cacheable 503 without leaking exception details', async () => {
  const handler = createUpdatesHandler(catalog, { check: async () => { throw new Error('secret internal error'); } });
  const response = await handler();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  const body = await response.json();
  assert.equal(body.error, 'check_failed'); assert.deepEqual(body.results, []);
  assert.equal(JSON.stringify(body).includes('secret'), false);
});

test('API source failures remain successful HTTP envelope with explicit individual errors', async () => {
  const results = [{ id: 'S1', status: 'error', httpStatus: 500 }];
  const handler = createUpdatesHandler(catalog, { check: async () => results });
  const response = await handler();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).results, results);
});


test('Workers-compatible manual redirects are rejected without a follow-up request', async () => {
  let calls = 0;
  const results = await checkSources([{id:'S1',title:'Official',url:'https://newsroom.roborock.com/test'}], {fetchImpl: async (_, init) => {calls++; assert.equal(init.redirect, 'manual'); return new Response(null,{status:302,headers:{Location:'https://example.com/untrusted'}});}});
  assert.equal(calls, 1); assert.equal(results[0].status,'error'); assert.equal(results[0].httpStatus,302); assert.match(results[0].message,/未跟随/);
});
