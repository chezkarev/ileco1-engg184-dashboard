/* Dependency-free regression tests for market intervals, units, scenarios and exports. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const research = html.match(/<script id="research"[^>]*>([\s\S]*?)<\/script>/)[1];
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/init\(\)\.then\(setupV2\);?/, '');
const fields = {
  priceUnit: { value: 'kwh' }, start: { value: '2026-08-23' }, end: { value: '2026-08-24' },
  demandModel: { value: 'Log-Linear' }, research: { textContent: research }
};
let blob;
let download;
class TestBlob extends Blob {
  constructor(parts, options) { super(parts, options); blob = this; }
}
const context = vm.createContext({
  console, Intl, Date, Blob: TestBlob,
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  setTimeout: callback => callback(),
  document: {
    getElementById: id => fields[id] || (fields[id] = {}),
    createElement: () => ({ click() { download = this.download; } })
  }
});
vm.runInContext(source, context);
const evaluate = code => vm.runInContext(code, context);
const plain = value => JSON.parse(JSON.stringify(value));
const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'market-data.json.gz'))));
context.testData = data;
evaluate('D = testData');

// Midnight interval ends remain in the preceding trading date/hour; gaps stay gaps.
const midnight = Date.parse('2026-08-24T00:00:00+08:00');
context.exampleRows = [
  [midnight - 300000, -7, 2000, 1, 2000, 0, 0],
  [midnight, -9, 4000, 1, 4000, 0, 0],
  [midnight + 300000, -5, -1000, 1, -1000, 0, 0],
  [midnight + 900000, 0, null, 1, null, 0, 0]
];
evaluate("resolution='hour'");
assert.deepEqual(plain(evaluate("aggregate(exampleRows,'LMP','node')")), [
  { t: midnight, v: 3, n: 2 }, { t: midnight + 3600000, v: -1, n: 1 }
]);
evaluate("resolution='day'");
assert.deepEqual(plain(evaluate("aggregate(exampleRows,'LMP','node')")), [
  { t: midnight, v: 3, n: 2 }, { t: midnight + 86400000, v: -1, n: 1 }
]);
evaluate("resolution='5m'");
assert.equal(evaluate("aggregate(exampleRows,'LMP','node').length"), 4);
assert.equal(evaluate("aggregate(exampleRows,'LMP','node').at(-1).n"), 0);
assert.equal(evaluate("val(exampleRows[0],'SCHED_MW','node')"), -7);
assert.equal(evaluate("val(exampleRows[2],'LMP','node')"), -1);
fields.priceUnit.value = 'mwh';
assert.equal(evaluate("val(exampleRows[2],'LMP','node')"), -1000);
fields.priceUnit.value = 'kwh';

// Test the financial scenario against an independently specified example.
const start = Date.parse('2026-11-14T00:00:00+08:00');
const rows = [];
for (let i = 1; i <= 36; i++) {
  rows.push([start + 18 * 3600000 + i * 300000, 0, 8560]);
  rows.push([start + 26 * 3600000 + i * 300000, 0, 2440]);
}
context.scenarioRows = rows;
context.scenarioStart = start;
const scenario = expression => evaluate('loadShiftScenario(' + expression + ')');
let result = scenario('scenarioRows,scenarioStart,scenarioStart+172800000,500,3,1080,120');
assert.ok(Math.abs(result.saving - 9180) < 1e-7);
assert.equal(result.energyKwh, 1500);
assert.equal(result.pairs, 1);
assert.equal(result.nextDay, true);
assert.ok(scenario('scenarioRows.slice(1),scenarioStart,scenarioStart+172800000,500,3,1080,120').error);
assert.ok(scenario('scenarioRows,scenarioStart,scenarioStart+86400000,500,3,1080,120').error);
assert.ok(scenario('scenarioRows,scenarioStart,scenarioStart+172800000,500,3,1080,1140').error);
assert.equal(scenario('scenarioRows,scenarioStart,scenarioStart+172800000,0,3,1080,120').saving, 0);
context.higherPriceRows = rows.map(row => row[0] > start + 86400000 ? [row[0], 0, 10000] : row);
assert.ok(scenario('higherPriceRows,scenarioStart,scenarioStart+172800000,500,3,1080,120').saving < 0);
context.negativePriceRows = rows.map(row => row[0] > start + 86400000 ? [row[0], 0, -1000] : row);
assert.ok(Math.abs(scenario('negativePriceRows,scenarioStart,scenarioStart+172800000,500,3,1080,120').saving - 14340) < 1e-7);

// Verify saved research tables and all four annual model exports.
assert.equal(evaluate('history.length'), 25);
assert.equal(evaluate('annual.length'), 10);
assert.equal(evaluate("history.at(-1)['Coincident Peak MW']"), 83.86);
assert.equal(evaluate("annual.at(-1)['Log-Linear MW']"), 144.23);
assert.equal(evaluate('rollingMetrics.length'), 5);
assert.equal(evaluate("Research.tables['14'][0].records.length"), 12);

(async () => {
  for (const model of ['Log-Linear', 'Linear Full', 'Linear 10-Year Recent', 'Linear 5-Year Recent']) {
    fields.demandModel.value = model;
    evaluate('exportDemand()');
    const text = await blob.text();
    const lines = text.trim().split(/\r?\n/);
    assert.equal(lines.length, 46); // Header + 25 historical + 10 model + 10 PSPP.
    assert.ok(download.startsWith('ILECO_I_annual_'));
    assert.ok(text.includes(model));
  }
  evaluate("resolution='hour';view={node:'08STBAR_SS1',nm:'LMP',rm:'GENERATION',series:aggregate(exampleRows,'LMP','node'),regional:[]}");
  evaluate('csv()');
  const text = await blob.text();
  assert.ok(text.includes('TIME_INTERVAL_PHT'));
  assert.ok(text.includes('2026-08-24T00:00:00+08:00'));
  assert.ok(text.includes('PHP/kWh'));
  assert.ok(text.includes('"3"'));
  console.log('Passed: interval boundaries, missing values, signed schedules, price units, load shifts, notebook data and both CSV export types.');
})().catch(error => { console.error(error); process.exitCode = 1; });
