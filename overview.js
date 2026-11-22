/* Fixed latest-snapshot views. These do not change the Market tab's filters. */
function buildLatestSnapshot(data) {
  const names = Object.keys(data.nodes);
  const nodeLookups = names.map(name => new Map(data.nodes[name].map(row => [row[0], row])));
  // Use a common observed interval, rather than mixing different timestamps.
  const region = data.regional.slice().reverse().find(row => nodeLookups.every(rows => rows.has(row[0])));
  if (!region) return null;
  const end = region[0], start = end - 86400000;
  const reference = names.includes('08STBAR_SS1') ? '08STBAR_SS1' : names[0];
  const priceIndex = data.nodeFields.indexOf('LMP') + 1;
  const nodePrices = names.map((name, i) => ({ name, value: nodeLookups[i].get(end)[priceIndex] }));
  const prices = nodePrices.map(row => row.value).filter(Number.isFinite);
  const regionalValue = field => region[data.regionalFields.indexOf(field) + 1];
  return {
    start, end, reference, nodePrices,
    price: nodePrices.find(row => row.name === reference).value,
    spread: prices.length > 1 ? Math.max(...prices) - Math.min(...prices) : null,
    generation: regionalValue('GENERATION'), requirement: regionalValue('MKT_REQT'),
    prices: data.nodes[reference].filter(row => row[0] > start && row[0] <= end).map(row => ({ x: row[0], y: row[priceIndex] == null ? null : row[priceIndex] / 1000 })),
    regional: data.regional.filter(row => row[0] > start && row[0] <= end)
  };
}

function overviewMarkup() {
  return `<section class="overview-summary" aria-label="Latest interval statistics">
    <div class="overview-stat"><span>Sta. Barbara bus price</span><strong id="nowPrice">—</strong><small>08STBAR_SS1 · PHP/kWh</small></div>
    <div class="overview-stat"><span>Visayas generation</span><strong id="nowGeneration">—</strong><small>MW · latest common interval</small></div>
    <div class="overview-stat"><span>Visayas market requirement</span><strong id="nowRequirement">—</strong><small>MW · latest common interval</small></div>
    <div class="overview-stat"><span>Spread across six buses</span><strong id="nowSpread">—</strong><small>PHP/kWh · highest minus lowest</small></div>
  </section>
  <div class="overview-context"><span id="overviewAsOf"></span><span>Panay bus prices · regional quantities cover all Visayas</span></div>
  <section class="panel overview-price"><div class="panel-head"><div><h2>Spot price · past 24 hours</h2><p class="panel-sub">Sta. Barbara · 08STBAR_SS1 · five-minute observations</p></div><span class="chart-unit">PHP/kWh</span></div><div class="overview-chart"><canvas id="overviewPrice" role="img" aria-label="Sta. Barbara bus prices for the latest 24 hours"></canvas></div></section>
  <div class="overview-grid"><section class="panel"><div class="panel-head"><div><h2>Generation & market requirement</h2><p class="panel-sub">Visayas · same 24-hour window</p></div><span class="chart-unit">MW</span></div><div class="overview-chart secondary"><canvas id="overviewRegional" role="img" aria-label="Visayas generation and market requirement for the latest 24 hours"></canvas></div><div class="demand-legend"><span><i style="background:#16476b"></i>Generation</span><span><i style="background:#b9650d"></i>Market requirement</span></div></section>
  <section class="panel"><div class="panel-head"><div><h2>Latest price by bus</h2><p class="panel-sub">Six Panay candidate buses · same observed interval</p></div><span class="chart-unit">PHP/kWh</span></div><div id="latestBusPrices" class="latest-bus-prices"></div></section></div>
  <section class="overview-edge"><div><span class="feature-label">From market insight to a load decision</span><h2>What could shifting a flexible load save?</h2><p>Compare complete historical price windows for your chosen bus and see the energy-only cost difference.</p></div><button data-open-calculator>Try the load-shift calculator</button></section>
  <details class="overview-method"><summary>About these figures</summary><p>All four indicators and the bus comparison use the latest interval available in every displayed bus series and the regional series. Prices are wholesale RTD observations, not retail tariffs. These buses are candidates; their ILECO I settlement mapping is unverified. The plots show available five-minute observations without gap filling.</p><p id="overviewCompleteness"></p></details>`;
}

function renderOverview() {
  const snapshot = buildLatestSnapshot(D);
  if (!snapshot) { $('rangeCaption').textContent = 'No common bus and regional observation is available.'; return; }
  const price = value => value == null ? '—' : '₱' + num(value / 1000);
  $('nowPrice').textContent = price(snapshot.price);
  $('nowGeneration').textContent = num(snapshot.generation, 0);
  $('nowRequirement').textContent = num(snapshot.requirement, 0);
  $('nowSpread').textContent = price(snapshot.spread);
  $('overviewAsOf').textContent = 'Interval ended ' + stamp(snapshot.end) + ' PHT';
  $('rangeCaption').textContent = 'Latest available market observations · automatic refresh';
  const clock = value => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
  const ticks = Array.from({ length: 5 }, (_, i) => snapshot.start + i * 21600000);
  const options = { ticks, xmin: snapshot.start, xmax: snapshot.end, formatX: clock, formatTooltip: value => stamp(value) + ' PHT', markers: false, maxGap: 450000 };
  drawAnalyticalSeries('overviewPrice', [{ name: snapshot.reference, color: '#b9650d', data: snapshot.prices }], { ...options, unit: 'PHP/kWh', decimals: 1 });
  drawAnalyticalSeries('overviewRegional', [
    { name: 'Generation', color: '#16476b', data: snapshot.regional.map(row => ({ x: row[0], y: row[D.regionalFields.indexOf('GENERATION') + 1] })) },
    { name: 'Market requirement', color: '#b9650d', dashed: true, data: snapshot.regional.map(row => ({ x: row[0], y: row[D.regionalFields.indexOf('MKT_REQT') + 1] })) }
  ], { ...options, unit: 'MW' });
  const max = Math.max(1, ...snapshot.nodePrices.map(row => Math.abs(row.value || 0)));
  $('latestBusPrices').innerHTML = snapshot.nodePrices.map(row => '<div class="latest-bus-row"><div><span>' + escapeChartText(row.name) + '</span><strong>' + price(row.value) + '</strong></div><div class="bus-price-track"><span style="width:' + (Math.abs(row.value || 0) / max * 100) + '%" class="' + (row.value < 0 ? 'negative' : '') + '"></span></div></div>').join('');
  $('overviewCompleteness').textContent = snapshot.prices.filter(row => Number.isFinite(row.y)).length + ' of 288 expected reference-bus prices and ' + snapshot.regional.length + ' of 288 regional intervals are present in this 24-hour window.';
}

function organizeCalculator() {
  const calculator = $('loadShift');
  $('calculatorWorkspace').append(calculator);
  const inputPanel = document.createElement('div');
  inputPanel.className = 'calculator-inputs';
  const resultPanel = document.createElement('div');
  resultPanel.className = 'calculator-outcome';
  resultPanel.innerHTML = '<h2>Scenario result</h2><p class="panel-sub">Average cost per complete paired shift · PHP</p>';
  let result = false;
  for (const child of Array.from(calculator.children)) {
    if (child.id === 'shiftWindowNote') result = true;
    (result ? resultPanel : inputPanel).append(child);
  }
  calculator.append(inputPanel, resultPanel);
  calculator.querySelector('h2').textContent = 'Build your scenario';
}
