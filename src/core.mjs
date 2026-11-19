import { trainingExamples, trainingMetadata } from './training.mjs';

export const GRADES = Object.freeze(['E1', 'E2', 'E3', 'E4', 'E5']);

/** Latin words and CJK character bigrams keep this classifier dependency-free. */
export function tokenize(value) {
  const text = String(value ?? '').normalize('NFKC').toLowerCase();
  const latin = text.match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  const cjk = [...text.matchAll(/[\u3400-\u9fff]+/g)].flatMap(([run]) => {
    if (run.length === 1) return [run];
    return Array.from({ length: run.length - 1 }, (_, i) => run.slice(i, i + 2));
  });
  return [...latin, ...cjk];
}

function trainNaiveBayes(examples) {
  const vocabulary = new Set();
  const labels = Object.fromEntries(GRADES.map(g => [g, { documents: 0, total: 0, counts: new Map() }]));
  for (const example of examples) {
    const label = labels[example.grade];
    label.documents++;
    for (const token of tokenize(example.text)) {
      vocabulary.add(token);
      label.total++;
      label.counts.set(token, (label.counts.get(token) ?? 0) + 1);
    }
  }
  return { vocabulary, labels, count: examples.length };
}
const model = trainNaiveBayes(trainingExamples);

/**
 * Multinomial Naive Bayes with Laplace smoothing, followed by conservative guards.
 * This suggests a review label. It never verifies source accuracy or revenue.
 */
export function classifyEvidence(value) {
  const text = String(value ?? '').trim().slice(0, 12000);
  const tokens = tokenize(text).filter(token => model.vocabulary.has(token));
  const logScores = Object.fromEntries(GRADES.map(grade => {
    const label = model.labels[grade];
    const score = Math.log(label.documents / model.count) + tokens.reduce((sum, token) =>
      sum + Math.log(((label.counts.get(token) ?? 0) + 1) / (label.total + model.vocabulary.size)), 0);
    return [grade, score];
  }));
  const max = Math.max(...Object.values(logScores));
  const denominator = Object.values(logScores).reduce((sum, score) => sum + Math.exp(score - max), 0);
  const scores = Object.fromEntries(GRADES.map(g => [g, Math.exp(logScores[g] - max) / denominator]));
  let grade = [...GRADES].sort((a, b) => scores[b] - scores[a])[0];
  const reasons = ['朴素贝叶斯基于合成中英训练文本建议标签；相对分数不是事实为真的概率。'];
  const generalNoEvidence = /未找到|未发现|无证据|没有.{0,8}(证据|来源)|缺乏证据|信息不足|无法确认|否认|未开展|不开展|未生产|不生产|不涉及|不存在.{0,8}业务|没有.{0,6}(业务|关联)|no (supporting |business )?evidence|no supporting|denies|unverified|no .{0,12}(business|operations)|not involved|does not.{0,15}(produce|operate|sell)/i.test(text);
  const noRevenue = /未.{0,6}披露.{0,12}收入|收入未披露|没有.{0,8}收入|无.{0,4}收入|未产生.{0,8}收入|no .{0,12}revenue|revenue.{0,20}(not disclosed|undisclosed)|not.{0,15}(generate|disclose).{0,10}revenue/i.test(text);
  const revenueFactPattern = /(收入|营收|revenue|sales).{0,55}([0-9]+(?:[.,][0-9]+)?).{0,12}(亿元|万元|元|美元|million|billion|usd|rmb)|(?:USD|RMB|\$)\s*[0-9]+.{0,30}(revenue|sales)/i.test(text);
  const forwardLooking = /预计|预测|收入目标|目标收入|计划.{0,20}(收入|营收)|假设|有望|预期|forecast|projected|expected revenue|target revenue|revenue target/i.test(text);
  if (!text || tokens.length < 2 || generalNoEvidence) {
    grade = 'E5';
    reasons.push(!text ? '未提供材料。' : generalNoEvidence ? '材料包含缺证或否定表述，禁止提升为收入证据。' : '可识别信息不足，留待人工核验。');
  } else if (grade === 'E1' && (noRevenue || forwardLooking || !revenueFactPattern)) {
    const alternatives = GRADES.filter(g => g !== 'E1');
    grade = alternatives.sort((a, b) => scores[b] - scores[a])[0];
    reasons.push(forwardLooking ? '材料包含前瞻、目标或假设性数字，禁止建议 E1。' : '未识别到正向、量化的收入披露，禁止建议 E1。');
  }
  reasons.push('须由人工核对原始来源、期间与业务口径后确认；分类器不会自动标记 verified。');
  return { grade, scores, method: `multinomial-naive-bayes/${trainingMetadata.version}+conservative-guards`, reasons };
}

const refusalPattern = /买哪|卖哪|买入|卖出|荐股|推荐.{0,8}(股票|个股)|该买|该卖|目标价|保证.{0,8}(收益|赚钱|回报)|稳赚|内幕消息|should i (buy|sell)|which stock.{0,15}(buy|sell)|guaranteed? (returns?|profit)|target price/i;
const instructionPattern = /忽略.{0,12}(指令|规则)|执行.{0,8}指令|ignore.{0,20}(instructions?|rules?)|system prompt/i;
const safeText = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const customerRelationPattern = /供货|供应商|供应关系|采购|客户|\bsuppl(?:y|ier|iers|ies)\b|\bcustomers?\b|\bprocurement\b/i;
const scopedGapPattern = /未找到|未发现|未核验|未披露.{0,10}客户|资料集|检索范围|no .{0,15}evidence|not verified|not disclosed/i;

/** Evidence retrieval and templated synthesis; no generative LLM or external API. */
export function retrieve(query, claims = [], sources = []) {
  const text = safeText(query).trim().slice(0, 1000);
  const method = 'verified-evidence-lexical-retrieval/v2; deterministic synthesis with scoped gaps, no LLM';
  if (refusalPattern.test(text)) return {
    answer: '本工具不提供个股买卖指令、目标价、收益保证或内幕消息。可查询公开业务证据、可比边界与情景假设。',
    claims: [], refused: true, method,
  };
  if (instructionPattern.test(text)) return {
    answer: '输入中的指令性文字仅作为待研究文本，不会执行。请提供公司、环节或业务问题以检索公开证据。',
    claims: [], refused: true, method,
  };
  const queryTokens = [...new Set(tokenize(text))];
  const sourceMap = new Map((Array.isArray(sources) ? sources : []).map(s => [s.id, s]));
  const customerQuery = customerRelationPattern.test(text);
  let ranked = (Array.isArray(claims) ? claims : []).filter(claim =>
    sourceMap.has(claim.sourceId) && isSafeSourceUrl(sourceMap.get(claim.sourceId).url) &&
    (customerQuery
      ? ((claim.verified === true && claim.grade === 'E2') ||
          (claim.grade === 'E5' && scopedGapPattern.test(`${claim.text} ${claim.boundary ?? ''}`)))
      : claim.verified === true)
  ).map(claim => {
    const source = sourceMap.get(claim.sourceId);
    const document = `${claim.text} ${claim.boundary ?? ''} ${claim.companyId} ${source.title}`.normalize('NFKC').toLowerCase();
    const docTokens = new Set(tokenize(document));
    const matches = queryTokens.filter(t => docTokens.has(t));
    const score = matches.length / Math.sqrt(Math.max(1, docTokens.size));
    return { claim, score, matches: matches.length };
  }).filter(item => item.matches >= (customerQuery ? 1 : queryTokens.length >= 4 ? 2 : 1) && item.score > 0)
    .sort((a, b) => b.score - a.score || a.claim.id.localeCompare(b.claim.id));
  if (customerQuery) {
    // A scoped E5 entry is a gap record, never a positive supply relationship.
    // Prefer its company and that company's product evidence; group revenue
    // cannot answer a named-customer question.
    const gaps = ranked.filter(item => item.claim.grade === 'E5');
    const gapCompanies = new Set(gaps.map(item => item.claim.companyId));
    const products = ranked.filter(item => item.claim.grade === 'E2' &&
      (!gapCompanies.size || gapCompanies.has(item.claim.companyId)));
    ranked = [...gaps, ...products].slice(0, 4);
  } else ranked = ranked.slice(0, 4);
  const customerNotice = '本库未核验该问题涉及的命名客户供货关系；产品适配不能确认订单。以下仅列相关产品证据与范围内待证记录，不作供货关系确认。';
  if (!text || !ranked.length) return {
    answer: (customerQuery ? `${customerNotice}\n` : '') + '当前已核验证据库中未找到足够匹配的资料。这只反映本库的检索范围，不代表该业务不存在；请补充官方来源后人工核验。',
    claims: [], refused: false, method,
  };
  const matches = ranked.map(({ claim }) => claim);
  const answer = (customerQuery ? `${customerNotice}\n` : '基于当前已核验证据：\n') + matches.map(claim =>
    `• ${claim.grade === 'E5' ? '【待证记录；非正向业务事实】' : ''}${safeText(claim.text).slice(0, 420)} [${claim.id}]（${claim.grade}；${safeText(claim.period)}；${safeText(claim.locator)}）\n  边界：${safeText(claim.boundary || '该条未提供细分业务边界；仅按所引来源和期间理解，不外推客户、订单或收入。').slice(0, 600)}`
  ).join('\n') + '\n以上为检索摘要；业务证据等级不代表投资价值，缺失口径不能由模型补全。';
  return { answer, claims: matches, refused: false, method };
}

function inRange(name, value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a finite number between ${min} and ${max}`);
  }
}

/** Fixed-unit-cost import-cost sensitivity for exposed business; not a forecast. */
export function computeScenario({ revenue, exposure, shock, passThrough, elasticity, grossMargin } = {}) {
  inRange('revenue', revenue, 0, 1e15);
  inRange('exposure', exposure, 0, 1);
  inRange('shock', shock, 0, 1);
  inRange('passThrough', passThrough, 0, 1);
  inRange('elasticity', elasticity, 0, 3);
  inRange('grossMargin', grossMargin, 0, 1);
  const priceChange = shock * passThrough;
  const volumeChange = (-priceChange * elasticity) || 0;
  if (volumeChange < -1) throw new RangeError('Assumed volume decline exceeds 100%; reduce shock or elasticity.');
  const originalRevenue = revenue * exposure;
  const newRevenue = originalRevenue * (1 + priceChange) * (1 + volumeChange);
  const absorbedCost = originalRevenue * shock * (1 - passThrough) * (1 + volumeChange);
  const revenueDelta = newRevenue - originalRevenue;
  const baselineGrossProfit = originalRevenue * grossMargin;
  const newCOGS = originalRevenue * (1 - grossMargin) * (1 + volumeChange);
  const extraImportCost = originalRevenue * shock * (1 + volumeChange);
  // Equivalent to newRevenue - newCOGS - extraImportCost - baselineGrossProfit.
  // This form avoids double-counting price pass-through and preserves an exact
  // zero when the entire import-cost shock is passed on with unchanged volume.
  const grossProfitDelta = (baselineGrossProfit * volumeChange - absorbedCost) || 0;
  return {
    originalRevenue, newRevenue, revenueDelta,
    revenueDeltaPct: originalRevenue === 0 ? null : revenueDelta / originalRevenue,
    priceChange, volumeChange, absorbedCost, grossProfitDelta,
    baselineGrossProfit, newCOGS, extraImportCost,
    newGrossProfit: baselineGrossProfit + grossProfitDelta,
    totalCompanyRevenue: revenue - originalRevenue + newRevenue,
    inputs: { revenue, exposure, shock, passThrough, elasticity, grossMargin },
    method: 'fixed-unit-cost-import-cost-sensitivity/v2',
    assumptions: [
      '所有比例以小数输入；金额沿用基准收入单位，只计算暴露业务。',
      '冲击参数是新增进口成本占基准暴露业务收入的代理，并非政策关税税率，也并非实际报关成本；实际关税还需产地和计税价格。',
      '提价幅度 = 进口成本冲击代理 × 转嫁比例；销量变化 = −提价幅度 × 需求弹性。',
      '暴露业务新收入 = 基准收入 × 暴露比例 × (1+提价幅度) × (1+销量变化)。',
      '固定商品单位成本：newCOGS = 暴露业务原收入 × (1−基准毛利率) × (1+销量变化)，不含新增进口成本。',
      '新增进口成本 = 暴露业务原收入 × 冲击代理 × (1+销量变化)；未转嫁成本再乘以(1−转嫁比例)。',
      '新毛利 = 新收入 − newCOGS − 新增进口成本；毛利变化 = 基准暴露毛利 × 销量变化 − 未转嫁成本。',
      '不含汇率、竞争、供应链迁移、费用、税与营运资本；暴露、转嫁和弹性均为假设，非公司预测或投资建议。',
    ],
  };
}

export function isSafeSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host.includes(':')) return false;
    if (/^\d+(?:\.\d+){3}$/.test(host)) {
      const parts = host.split('.').map(Number);
      if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224 ||
          (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
          (parts[0] === 192 && parts[1] === 168) || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)) return false;
    }
    return !url.port || ['80', '443'].includes(url.port);
  } catch { return false; }
}

function validISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value);
const boundedString = (value, max = 4000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/**
 * Imports cannot self-assert verification. Use allowVerified only for the
 * application's reviewed, bundled snapshot; never for a browser import.
 */
export function validateSnapshot(data, { allowVerified = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { valid: false, errors: ['快照必须是 JSON 对象。'], warnings };
  let bytes;
  try { bytes = new TextEncoder().encode(JSON.stringify(data)).length; } catch { return { valid: false, errors: ['快照不可序列化。'], warnings }; }
  if (bytes > 2_000_000) errors.push('快照超过 2 MB 限额。');
  if (!boundedString(data.version, 100)) errors.push('version 必须是非空字符串，最长 100 字符。');
  if (!validISODate(data.asOf)) errors.push('asOf 必须是有效 YYYY-MM-DD。');
  for (const [field, max] of [['sources', 100], ['claims', 500], ['companies', 100]]) {
    if (!Array.isArray(data[field]) || data[field].length > max) errors.push(`${field} 必须是数组且不超过 ${max} 条。`);
  }
  if (Array.isArray(data.sources) && data.sources.length === 0) errors.push('sources 至少包含一个来源。');
  if (Array.isArray(data.companies) && data.companies.length === 0) errors.push('companies 至少包含一家公司。');
  if (errors.length) return { valid: false, errors, warnings };
  const sourceIds = new Set(), companyIds = new Set(), claimIds = new Set();
  const checkId = (value, set, label) => {
    if (!validId(value)) errors.push(`${label} ID 非法。`);
    else if (set.has(value)) errors.push(`${label} ID 重复：${value}`);
    else set.add(value);
  };
  for (const source of data.sources) {
    if (!source || typeof source !== 'object') { errors.push('来源必须是对象。'); continue; }
    checkId(source.id, sourceIds, '来源');
    if (!boundedString(source.title, 500)) errors.push(`来源 ${source.id} 缺少有效标题。`);
    if (!isSafeSourceUrl(source.url)) errors.push(`来源 ${source.id} URL 不安全或格式无效。`);
    if (source.date !== null && !validISODate(source.date)) errors.push(`来源 ${source.id} 日期必须是有效 YYYY-MM-DD 或 null（官网未标注）。`);
    if (source.date === null) warnings.push(`来源 ${source.id} 官网未标注发布日期；不得以核验日期替代。`);
    if (!validISODate(source.retrievedAt)) errors.push(`来源 ${source.id} 必须记录有效 retrievedAt 核验日期。`);
    for (const field of ['retrievedAt', 'publishedAt']) {
      if (source[field] !== undefined && !validISODate(source[field])) errors.push(`来源 ${source.id} 的 ${field} 日期无效。`);
    }
  }
  for (const company of data.companies) {
    if (!company || typeof company !== 'object') { errors.push('公司必须是对象。'); continue; }
    checkId(company.id, companyIds, '公司');
    if (!boundedString(company.name, 200)) errors.push(`公司 ${company.id} 缺少有效名称。`);
    for (const field of ['en', 'ticker', 'market', 'layer', 'role', 'status']) {
      if (!boundedString(company[field], field === 'status' || field === 'role' ? 500 : 200)) errors.push(`公司 ${company.id} 的 ${field} 字段缺失或无效。`);
    }
    if (typeof company.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(company.color)) errors.push(`公司 ${company.id} color 必须是六位十六进制颜色。`);
    if (company.statusSourceId !== undefined && !sourceIds.has(company.statusSourceId)) errors.push(`公司 ${company.id} statusSourceId 引用了不存在的来源。`);
    for (const field of ['revenue', 'cleaningRevenue']) {
      if (field === 'cleaningRevenue' && company[field] === undefined) continue;
      const metric = company[field];
      if (metric === null) continue;
      if (!metric || typeof metric !== 'object' || Array.isArray(metric)) { errors.push(`公司 ${company.id} 的 ${field} 必须是对象或 null。`); continue; }
      if (typeof metric.value !== 'number' || !Number.isFinite(metric.value) || metric.value < 0) errors.push(`公司 ${company.id} 的 ${field}.value 必须是非负有限数字。`);
      for (const key of ['unit', 'period', 'scope']) if (!boundedString(metric[key], key === 'scope' ? 1000 : 200)) errors.push(`公司 ${company.id} 的 ${field}.${key} 缺失或无效。`);
      if (!sourceIds.has(metric.sourceId)) errors.push(`公司 ${company.id} 的 ${field} 引用了不存在的来源。`);
    }
  }
  for (const field of ['policy', 'policy2026']) {
    if (data[field] === undefined) continue;
    const policy = data[field];
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) { errors.push(`${field} 必须是政策对象。`); continue; }
    for (const key of ['title', 'region', 'text']) if (!boundedString(policy[key], key === 'text' ? 4000 : 300)) errors.push(`${field}.${key} 缺失或无效。`);
    if (!sourceIds.has(policy.sourceId)) errors.push(`${field} 引用了不存在的来源。`);
    if (typeof policy.rate !== 'number' || !Number.isFinite(policy.rate) || policy.rate < 0 || policy.rate > 100) errors.push(`${field}.rate 必须是 0–100 的有限百分比数字。`);
    if (typeof policy.maxPerProduct !== 'number' || !Number.isFinite(policy.maxPerProduct) || policy.maxPerProduct < 0) errors.push(`${field}.maxPerProduct 必须是非负有限数字。`);
    if (policy.date !== undefined && !validISODate(policy.date)) errors.push(`${field}.date 必须是有效 YYYY-MM-DD。`);
  }
  for (const claim of data.claims) {
    if (!claim || typeof claim !== 'object') { errors.push('证据必须是对象。'); continue; }
    checkId(claim.id, claimIds, '证据');
    if (!companyIds.has(claim.companyId)) errors.push(`证据 ${claim.id} 引用了不存在的公司。`);
    if (!sourceIds.has(claim.sourceId)) errors.push(`证据 ${claim.id} 引用了不存在的来源。`);
    if (!GRADES.includes(claim.grade)) errors.push(`证据 ${claim.id} 等级无效。`);
    if (!boundedString(claim.text)) errors.push(`证据 ${claim.id} 文本无效或超过 4000 字符。`);
    if (!boundedString(claim.locator, 500)) errors.push(`证据 ${claim.id} 缺少原始资料定位。`);
    if (!boundedString(claim.period, 100)) errors.push(`证据 ${claim.id} 缺少报告期间。`);
    if (typeof claim.verified !== 'boolean') errors.push(`证据 ${claim.id} verified 必须是布尔值。`);
    if (claim.verified === true && !allowVerified) errors.push(`证据 ${claim.id} 不允许导入自证 verified:true；请先进入人工复核。`);
    if (claim.value !== undefined && (!Number.isFinite(claim.value) || typeof claim.value !== 'number')) errors.push(`证据 ${claim.id} 关键数字必须有限。`);
    if (claim.value !== undefined && (!boundedString(claim.unit, 100) || !boundedString(claim.metric, 200))) errors.push(`证据 ${claim.id} 关键数字缺少 metric 或 unit。`);
  }
  const scan = (value, depth = 0) => {
    if (depth > 12) { errors.push('快照嵌套过深。'); return; }
    if (typeof value === 'number' && !Number.isFinite(value)) errors.push('快照包含非有限数字。');
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) errors.push('快照包含禁止的对象属性。');
      scan(child, depth + 1);
    }
  };
  scan(data);
  if (data.claims.some(c => c && c.verified === false)) warnings.push('未核验证据只能进入待审列表，不能自动提升为已核验事实。');
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings };
}

export function diffSnapshots(before = {}, after = {}) {
  const result = {};
  for (const field of ['sources', 'claims', 'companies']) {
    const oldMap = new Map((before[field] ?? []).map(item => [item.id, item]));
    const newMap = new Map((after[field] ?? []).map(item => [item.id, item]));
    result[field] = {
      added: [...newMap.keys()].filter(id => !oldMap.has(id)),
      removed: [...oldMap.keys()].filter(id => !newMap.has(id)),
      changed: [...newMap.keys()].filter(id => oldMap.has(id) && JSON.stringify(oldMap.get(id)) !== JSON.stringify(newMap.get(id))),
    };
  }
  return result;
}

export function isStale(date, asOf, days = 180) {
  if (!validISODate(date) || !validISODate(asOf) || !Number.isFinite(days) || days < 0) return true;
  const elapsed = (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000;
  return elapsed < 0 || elapsed > days;
}
