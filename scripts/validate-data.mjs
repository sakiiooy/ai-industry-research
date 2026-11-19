/**
 * Consistency checks for this reviewed, bundled research snapshot only.
 * Not a truth oracle, not a network check, and not the browser import policy.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateSnapshot } from '../src/core.mjs';

const data = JSON.parse(await readFile(new URL('../src/data.json', import.meta.url), 'utf8'));
const result = validateSnapshot(data, { allowVerified: true });
assert.equal(result.valid, true, result.errors.join('\n'));
assert.ok(data.sources.length >= 12, 'Bundled snapshot must retain at least 12 sources.');
assert.ok(data.claims.length >= 14, 'Bundled snapshot must retain at least 14 claims.');
assert.ok(data.companies.length >= 7, 'Bundled snapshot must retain at least 7 companies.');
const sources = new Map(data.sources.map(source => [source.id, source]));
const companies = new Map(data.companies.map(company => [company.id, company]));
const claims = new Map(data.claims.map(claim => [claim.id, claim]));
for (const claim of data.claims) {
  assert.ok(sources.has(claim.sourceId), `${claim.id}: missing source`);
  assert.ok(companies.has(claim.companyId), `${claim.id}: missing company`);
}
console.log(`PASS 1/4 schema/references: ${data.companies.length} companies, ${data.claims.length} claims, ${data.sources.length} sources.`);

for (const source of data.sources) {
  if (source.date !== null) assert.ok(source.date <= data.asOf, `${source.id}: publication is after asOf`);
  assert.ok(source.retrievedAt <= data.asOf, `${source.id}: retrieval is after asOf`);
}
for (const id of ['S7', 'S8', 'S11']) {
  assert.equal(sources.get(id)?.date, null, `${id}: unknown publication date must remain null; do not substitute retrieval date.`);
  assert.match(sources.get(id)?.retrievedAt ?? '', /^\d{4}-\d{2}-\d{2}$/, `${id}: keep retrieval date separately.`);
}
for (const field of ['policy', 'policy2026']) if (data[field]?.date) assert.ok(data[field].date <= data.asOf, `${field}: future policy date`);
console.log(`PASS 2/4 dates: all dated sources are on/before ${data.asOf}; S7/S8/S11 publication dates remain unknown.`);

const approximate = (actual, expected, label, tolerance = 1e-8) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} differs from ${expected}`);
};
const rounded2 = value => Number(value.toFixed(2));
const roborock = companies.get('roborock')?.revenue;
assert.equal(roborock?.unit, '亿元人民币');
assert.equal(roborock?.sourceId, 'S1');
approximate(roborock?.value, 186.95, 'Roborock published rounded revenue');
assert.match(claims.get('C01')?.text ?? '', /186\.95/, 'C01 must match the published rounded company value.');

const ecovacs = companies.get('ecovacs')?.revenue;
assert.equal(ecovacs?.rawUnit, '人民币元');
assert.equal(ecovacs?.unit, '亿元人民币');
approximate(ecovacs?.rawValue, 19039662854.51, 'ECOVACS original RMB revenue', 0.0001);
approximate(ecovacs.rawValue / 1e8, 190.3966285451, 'ECOVACS RMB to hundred-million RMB');
assert.equal(ecovacs.value, rounded2(ecovacs.rawValue / 1e8));

const shark = companies.get('sharkninja');
const irobot = companies.get('irobot');
for (const [label, metric, expectedRaw, expectedConverted] of [
  ['SharkNinja group', shark?.revenue, 6399188, 63.99188],
  ['SharkNinja Cleaning', shark?.cleaningRevenue, 2205757, 22.05757],
  ['iRobot historical', irobot?.revenue, 681849, 6.81849],
]) {
  assert.equal(metric?.rawUnit, '千美元', `${label}: raw unit`);
  assert.equal(metric?.unit, '亿美元', `${label}: display unit`);
  assert.equal(metric?.rawValue, expectedRaw, `${label}: raw value`);
  approximate(metric.rawValue / 1e5, expectedConverted, `${label}: thousand USD to hundred-million USD`);
  assert.equal(metric.value, rounded2(expectedConverted), `${label}: rounding`);
}
const cleaningShare = shark.cleaningRevenue.rawValue / shark.revenue.rawValue * 100;
approximate(cleaningShare, 34.469326420789635, 'Cleaning share percentage');
assert.equal(Number(cleaningShare.toFixed(1)), 34.5);
assert.match(claims.get('C06')?.text ?? '', /34\.5%/);
console.log(`PASS 3/4 units: ECOVACS 190.40亿元; SharkNinja 63.99188亿美元, Cleaning ${cleaningShare.toFixed(6)}%→34.5%; iRobot 6.81849亿美元.`);

for (const id of ['C01', 'C03', 'C06']) {
  const claim = claims.get(id);
  assert.equal(claim?.grade, 'E1', `${id}: revenue evidence grade`);
  assert.ok(/集团|大类|其他清洁/.test(claim.text), `${id}: preserve group/mixed-category scope`);
  assert.ok(/不能|非机器人|未单列|不等同|不等于/.test(`${claim.text} ${claim.boundary}`), `${id}: preserve pure robot-revenue limitation`);
}
assert.match(irobot.revenue.period, /FY2024/);
assert.equal(irobot.statusSourceId, 'S5');
assert.equal(claims.get('C14')?.grade, 'E5');
assert.equal(claims.get('C14')?.verified, false);
console.log('PASS 4/4 scope: group/mixed revenue boundaries, historical iRobot status source, and unverified customer gap are retained.');
