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
    <div class="overview-stat"><strong id="nowPrice">—</strong><span>Sta. Barbara price <small>PHP/kWh</small></span></div>
    <div class="overview-stat"><strong id="nowGeneration">—</strong><span>Visayas generation <small>MW</small></span></div>
    <div class="overview-stat"><strong id="nowRequirement">—</strong><span>Market requirement <small>MW · Visayas</small></span></div>
    <div class="overview-stat"><strong id="nowSpread">—</strong><span>Six-bus price spread <small>PHP/kWh</small></span></div>
  </section>
  <div class="dash-grid">
    <section class="dash-panel dash-map"><div class="dash-panel-title"><h2>Panay bus locations</h2><button data-view="map" class="dash-text-button">Full map</button></div><div class="dash-map-body"><svg id="overviewMap" viewBox="0 0 500 390" role="group" aria-label="Panay map showing the approximate Sta. Barbara and Iloilo 1 station areas"></svg><div id="overviewMapReadout" aria-live="polite"></div></div></section>
    <section class="dash-panel dash-price"><div class="dash-panel-title"><h2>Spot price · past 24 hours</h2><span>08STBAR_SS1 · PHP/kWh</span></div><div class="overview-chart"><canvas id="overviewPrice" role="img" aria-label="Sta. Barbara bus prices for the latest 24 hours"></canvas></div></section>
    <section class="dash-panel dash-supplier"><div class="dash-panel-title"><h2>Power supplier · regional context</h2></div><div class="dash-supplier-body"><strong>Panay Energy Development Corp.</strong><div class="dash-capacity"><b>314 <small>MW</small></b><span>164 + 150 MW installed</span></div><p>Coal-fired generation · Iloilo City</p><p class="supplier-note">Regional generator; bus-level suppliers unverified.</p><a href="https://www.gbp.com.ph/power-generation/our-solutions-panay-mindoro/" target="_blank" rel="noopener">PEDC / official plant profile</a><div id="overviewCompleteness"></div></div></section>
    <section class="dash-panel dash-regional"><div class="dash-panel-title"><h2>Generation & requirement</h2><span>MW</span></div><div class="overview-chart secondary"><canvas id="overviewRegional" role="img" aria-label="Visayas generation and market requirement for the latest 24 hours"></canvas></div><div class="dash-legend"><span><i></i>Generation</span><span><i></i>Requirement</span></div></section>
    <section class="dash-panel dash-buses"><div class="dash-panel-title"><h2>Latest bus prices</h2><span>PHP/kWh</span></div><div id="latestBusPrices" class="latest-bus-prices"></div></section>
  </div>
  <div class="dash-footnote"><span id="overviewAsOf"></span><span>Wholesale RTD · approximate station areas · ILECO I mapping unverified</span></div>`;
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
  $('rangeCaption').textContent = 'Market snapshot · Panay buses & Visayas grid';
  const clock = value => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
  const ticks = Array.from({ length: 5 }, (_, i) => snapshot.start + i * 21600000);
  const options = { ticks, xmin: snapshot.start, xmax: snapshot.end, formatX: clock, formatTooltip: value => stamp(value) + ' PHT', markers: false, maxGap: 450000, compact: true };
  drawAnalyticalSeries('overviewPrice', [{ name: snapshot.reference, color: '#b9650d', data: snapshot.prices }], { ...options, unit: 'PHP/kWh', decimals: 1 });
  drawAnalyticalSeries('overviewRegional', [
    { name: 'Generation', color: '#16476b', data: snapshot.regional.map(row => ({ x: row[0], y: row[D.regionalFields.indexOf('GENERATION') + 1] })) },
    { name: 'Market requirement', color: '#b9650d', dashed: true, data: snapshot.regional.map(row => ({ x: row[0], y: row[D.regionalFields.indexOf('MKT_REQT') + 1] })) }
  ], { ...options, unit: 'MW' });
  const max = Math.max(1, ...snapshot.nodePrices.map(row => Math.abs(row.value || 0)));
  $('latestBusPrices').innerHTML = snapshot.nodePrices.map(row => '<div class="latest-bus-row"><span>' + escapeChartText(row.name) + '</span><strong>' + price(row.value) + '</strong><div class="bus-price-track"><span style="width:' + (Math.abs(row.value || 0) / max * 100) + '%" class="' + (row.value < 0 ? 'negative' : '') + '"></span></div></div>').join('');
  $('overviewCompleteness').textContent = snapshot.prices.filter(row => Number.isFinite(row.y)).length + '/288 price intervals · ' + snapshot.regional.length + '/288 regional intervals';
  renderOverviewMap(snapshot);
}

function renderOverviewMap(snapshot) {
  const project = (lon, lat) => [60 + (lon - 121.73) * 180, 350 - (lat - 10.28) * 180];
  const paths = Research.coast.map(ring => '<path class="dash-coast" d="' + ring.map((point, i) => (i ? 'L' : 'M') + project(...point).map(value => value.toFixed(1)).join(',')).join(' ') + 'Z"/>').join('');
  const markers = Object.entries(stations).map(([key, station]) => {
    const [x, y] = project(station.lon, station.lat);
    const labelX = key === 'sta' ? 105 : 395;
    const labelY = key === 'sta' ? y - 36 : y + 18;
    return '<g class="dash-station" tabindex="0" role="button" aria-label="' + station.name + ' dashboard station" data-dashboard-station="' + key + '"><title>' + station.name + ' · approximate area · ' + station.nodes.join(', ') + '</title><path d="M' + x + ',' + y + 'L' + labelX + ',' + labelY + '"/><circle cx="' + x + '" cy="' + y + '" r="8"/><text x="' + labelX + '" y="' + (labelY - 9) + '" text-anchor="middle">' + station.name + '</text><text class="dash-map-count" x="' + labelX + '" y="' + (labelY + 17) + '" text-anchor="middle">' + station.nodes.length + (station.nodes.length === 1 ? ' bus' : ' buses') + '</text></g>';
  }).join('');
  $('overviewMap').innerHTML = '<defs><clipPath id="overviewIslandClip"><rect width="500" height="390"/></clipPath></defs><g clip-path="url(#overviewIslandClip)">' + paths + '</g><text class="dash-island-name" x="190" y="145">PANAY</text><text class="dash-map-north" x="452" y="35">N ↑</text>' + markers;
  const describe = key => {
    const station = stations[key];
    $('overviewMapReadout').innerHTML = '<strong>' + station.name + '</strong><span>' + station.nodes.map(name => name.replace(key === 'sta' ? '08STBAR_' : '08ILO_', '')).join(' · ') + '</span>';
  };
  document.querySelectorAll('[data-dashboard-station]').forEach(marker => {
    marker.onmouseenter = marker.onfocus = marker.onclick = () => describe(marker.dataset.dashboardStation);
    marker.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); describe(marker.dataset.dashboardStation); } };
  });
  describe('sta');
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
