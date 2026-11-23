/* Navigation, controls and chart inspection. Dataset/model calculations live in app.js. */
const PLATFORM_VIEWS = {
  dashboard: { label: 'Dashboard', title: 'Panay Energy Dashboard', description: 'Latest market dashboard' },
  market: { label: 'Market', title: 'Market analysis', description: 'Panay market overview' },
  calculator: { label: 'Calculator', title: 'Load-shift calculator', description: 'Load-shift calculator' },
  map: { label: 'Bus Map', title: 'Panay bus locations', description: 'Panay bus map' },
  demand: { label: 'Demand', title: 'ILECO I · demand & outlook', description: 'ILECO I demand' },
  sources: { label: 'Methods', title: 'Data sources & methods', description: 'Sources & methods' },
  project: { label: 'About', title: 'About the project', description: 'About the project' }
};

function initializeInterface() {
  if (!D) return;
  icons.dashboard = '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>';
  icons.calculator = '<rect x="5" y="2" width="14" height="20" rx="1"/><path d="M8 6h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h2M14 19h2"/>';
  palette.splice(0, 6, '#b9650d', '#444765', '#788ba4', '#5e8584', '#a06f62', '#9693aa');
  document.querySelector('.rail-brand').innerHTML = panayLogo + '<span>PANAY<br>ENERGY</span><small>Market Observatory</small>';
  for (const group of ['primary', 'secondary']) {
    const keys = group === 'primary' ? ['dashboard', 'market', 'map', 'demand', 'calculator'] : ['sources', 'project'];
    document.querySelector('.rail-nav.' + group).innerHTML = keys.map(key => {
      const item = PLATFORM_VIEWS[key];
      return '<button data-view="' + key + '" aria-label="' + item.description + '" aria-controls="' + key + 'View"><svg viewBox="0 0 24 24" aria-hidden="true">' + icons[key] + '</svg><span>' + item.label + '</span></button>';
    }).join('');
  }

  document.querySelector('.rail-nav.secondary').insertAdjacentHTML('beforebegin','<div class="reference-label">REFERENCE</div>');
  document.querySelector('.rail').insertAdjacentHTML('beforeend',`<svg class="rail-landscape" viewBox="0 0 210 125" aria-hidden="true"><path d="M0 50Q32 12 68 46T145 38T210 43V125H0Z" fill="#285767"/><path d="M0 64Q50 34 91 63T210 50V125H0Z" fill="#3e7581"/><path d="M0 84Q65 47 120 76T210 65V125H0Z" fill="#193e50"/><path d="M0 109Q100 94 210 96L210 104Q95 95 0 114Z" fill="#ce792d"/><g fill="none" stroke="#dbe9ea" stroke-width="2"><path d="M132 100V30M132 30L114 11M132 30L156 25M132 30L126 53M172 101V52M172 52L160 39M172 52L190 48M172 52L168 69"/><circle cx="132" cy="30" r="2"/><circle cx="172" cy="52" r="2"/></g><g stroke="#092a38" fill="none" stroke-width="1.3"><path d="M31 104L42 61L54 105M35 87H50M37 78H47M39 69H45M25 70H59M27 74H57M31 104L50 87L37 78L45 69M54 105L35 87L47 78L39 69"/></g></svg>`);
  const main = document.querySelector('.main');
  const market = document.createElement('div');
  market.id = 'marketView';
  market.className = 'page-view';
  const cards = main.querySelector('.cards');
  const content = main.querySelector('.content');
  main.insertBefore(market, cards);
  market.append(cards, content);
  content.insertAdjacentHTML('beforebegin',marketForecastMarkup());
  initializeMarketForecast();
  for (const [key, markup] of [['dashboard', overviewMarkup()], ['calculator', '<div class="calculator-page-intro"><span class="feature-label">Decision tool</span><p>Turn historical price differences into a flexible-load scenario. Choose a bus and dates above, then compare two load windows.</p></div><div id="calculatorWorkspace"></div>'], ['map', mapMarkup()], ['demand', demandMarkup()], ['sources', sourcesMarkup()], ['project', projectMarkup()]]) {
    const page = document.createElement('div');
    page.id = key + 'View';
    page.className = 'page-view';
    page.innerHTML = markup;
    main.insertBefore(page, main.querySelector('.footer'));
  }

  $('demandView').insertAdjacentHTML('beforeend', '<details class="study-context"><summary>Demand study context & assumptions</summary><div id="historySidebar" class="history-sidebar"><div class="mode-label">ILECO I / planning study</div><section><h3>Annual coincident peak</h3><p><strong>History:</strong> 2000–2024<br><strong>Forecast vintage:</strong> after 2024<br><strong>Projection:</strong> 2025–2034</p></section><section><h3>Keep the scales separate</h3><p>These are annual utility peak-demand values in MW. They are not the 5-minute Visayas market requirement or bus schedules.</p></section><section><h3>Notebook results</h3><p>Saved observations, forecasts and validation outputs from your ENGG 184 notebook. Models have not been retrained in this dashboard.</p><p>Weather-based monthly factors are illustrative. Forecast curves are model projections, including 2025–2026, not subsequently verified actuals.</p></section></div></details>');

  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => switchView(button.dataset.view));
  document.querySelectorAll('[data-demand]').forEach(button => button.onclick = () => {
    demandMode = button.dataset.demand;
    renderDemand();
  });
  for (const id of ['demandModel', 'forecastYear', 'demandAll']) $(id).onchange = renderDemand;
  document.querySelectorAll('[data-mapzoom]').forEach(button => button.onclick = () => drawPanay(button.dataset.mapzoom));

  const originalDemandRender=renderDemand;
  renderDemand=function(){
    originalDemandRender();
    const cards=document.querySelectorAll('.demand-cards .card');
    if(cards.length){setIndicator(cards[0],history.at(-1)['Coincident Peak MW'],history.at(-2)['Coincident Peak MW'],'vs. previous historical year');
    const year=Number($('forecastYear').value),field=annualColumn($('demandModel').value),row=annual.find(r=>r.Year===year),prior=annual.find(r=>r.Year===year-1);
    setIndicator(cards[1],row[field],prior?prior[field]:83.86,'vs. previous year · model projection');}
  };
  setupCalculator();
  organizeCalculator();
  const marketNotes = document.createElement('details');
  marketNotes.className = 'market-notes';
  marketNotes.innerHTML = '<summary>Data quality & interpretation</summary>';
  const notes = document.querySelector('#marketView .right');
  marketNotes.append(notes);
  market.append(marketNotes);
  const marketAction = document.createElement('div');
  marketAction.className = 'market-action';
  marketAction.innerHTML = '<div><strong>Put price differences to work</strong><span>Compare the energy cost of moving a flexible load.</span></div><button data-open-calculator>Open load-shift calculator</button>';
  market.insertBefore(marketAction, marketNotes);
  document.querySelectorAll('[data-open-calculator]').forEach(button => button.onclick = () => navigateView('calculator'));
  const originalRender = render;
  render = function () {
    if (activeView === 'dashboard') { renderOverview(); return; }
    if (!['market', 'map', 'calculator'].includes(activeView)) return;
    originalRender();
    renderCalculator();
    if (view.nodes) {
      if (activeView === 'market') { enhanceMarketCharts(); renderMarketForecast(); }
      updateFilterState();
      marketComparisonIndicators();
    }
    if (activeView === 'map') {
      drawPanay();
      stationPanel(stations[stationChoice].nodes.includes(view.node) ? stationChoice : (stations.sta.nodes.includes(view.node) ? 'sta' : 'ilo'));
    }
    if (activeView === 'calculator') $('rangeCaption').textContent = $('node').value + ' · ' + $('start').value + ' to ' + $('end').value + ' · historical price scenario';
  };
  for (const id of ['node', 'start', 'end', 'nodeMetric', 'regionalMetric', 'priceUnit', 'compare']) {
    $(id).removeEventListener('change', originalRender);
    $(id).addEventListener('change', () => render());
  }
  const originalCsv = csv;
  csv = () => activeView === 'demand' ? exportDemand() : originalCsv();
  $('export').onclick = csv;
  $('mobileControls').onclick = () => {
    const open = $('marketFilters').classList.toggle('expanded');
    $('mobileControls').setAttribute('aria-expanded', String(open));
  };
  window.addEventListener('resize', () => {
    clearTimeout(window.platformResizeTimer);
    window.platformResizeTimer = setTimeout(() => {
      if (activeView === 'demand') renderDemand();
      if (activeView === 'map') drawPanay();
    }, 180);
  });
  setupDefinitions();
  initializeTheme();
  const requested = location.hash.slice(1);
  navigateView(PLATFORM_VIEWS[requested] ? requested : 'dashboard', false);
  hostedConnection();
}

function navigateView(key, resetScroll = true) {
  if (!PLATFORM_VIEWS[key]) return;
  activeView = key;
  document.querySelector('.app').dataset.activeView = key;
  for (const viewKey of Object.keys(PLATFORM_VIEWS)) $(viewKey + 'View').hidden = viewKey !== key;
  document.querySelectorAll('[data-view]').forEach(button => {
    const selected = button.dataset.view === key;
    button.classList.toggle('active', selected);
    if (button.closest('nav')) {
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  });
  if (definitionBubble) hideDefinition();
  const marketControls = key === 'market' || key === 'map' || key === 'calculator';
  $('marketFilters').hidden = !marketControls;
  $('mobileControls').hidden = !marketControls;
  document.querySelector('h1').textContent = PLATFORM_VIEWS[key].title;
  $('export').hidden = !['market', 'map', 'demand'].includes(key);
  $('export').textContent = key === 'demand' ? 'Export annual forecast' : 'Export selected CSV';
  document.querySelector('.top .badge').textContent = key === 'dashboard' ? 'Manual refresh' : key === 'calculator' ? 'Energy-only scenario' : key === 'demand' ? 'Annual study · 2024 cutoff' : key === 'map' ? 'Approximate station areas' : key === 'project' ? 'ENGG 184 · project brief' : 'Observed RTD · PHT';
  document.querySelector('.footer').firstElementChild.textContent = key === 'demand' ? 'Source: ENGG 184 notebook · saved annual demand, forecasts and backtests' : 'Source: IEMOP RTD via Google Sheets · methods and station caveats in Sources & methods';
  if (marketControls) render();
  if (key === 'dashboard') renderOverview();
  if (key === 'demand') {
    renderDemand();
    $('rangeCaption').textContent = 'Annual coincident peak · history 2000–2024 · projections 2025–2034';
  }
  if (key === 'sources') $('rangeCaption').textContent = 'Data provenance, aggregation, geography and model interpretation';
  if (key === 'project') $('rangeCaption').textContent = 'Philippine electricity markets · research and utility demand planning';
  updateObservationTime();
  window.history.replaceState(null, '', '#' + key);
  if (resetScroll) window.scrollTo({ top: 0, behavior: 'instant' });
}

function updateFilterState() {
  $('variableSummary').textContent = labels[$('nodeMetric').value] + ' + ' + labels[$('regionalMetric').value].toLowerCase() + ' · ' + unit($('nodeMetric').value);
  document.querySelectorAll('[data-resolution]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.resolution === resolution)));
  const latest = datePHT(D.regional.at(-1)[0] - 1);
  const first = datePHT(D.regional[0][0] - 1);
  document.querySelectorAll('[data-days]').forEach(button => {
    const days = button.dataset.days;
    const from = days === 'all' ? first : datePHT(Date.parse(latest + 'T00:00:00+08:00') - (Number(days) - 1) * 86400000);
    button.setAttribute('aria-pressed', String($('start').value === from && $('end').value === latest));
  });
}

function escapeChartText(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function resetChartInspector(element) {
  for (const handler of ['onmousemove', 'onpointermove', 'onpointerleave', 'onmouseleave', 'onclick', 'onkeydown', 'onblur']) element[handler] = null;
  if (element._inspector) {
    element._inspector.tip.style.display = 'none';
    element._inspector.line.style.display = 'none';
  }
}

function nearestChartIndex(points, value, accessor = point => point.x) {
  let low = 0, high = points.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (accessor(points[middle]) < value) low = middle + 1;
    else high = middle;
  }
  return low > 0 && Math.abs(accessor(points[low - 1]) - value) < Math.abs(accessor(points[low]) - value) ? low - 1 : low;
}

function installChartInspector(element, options) {
  resetChartInspector(element);
  if (!options.count) return;
  const parent = element.parentElement;
  let tip = element._inspector?.tip;
  let line = element._inspector?.line;
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-inspector';
    tip.id = element.id + 'Inspector';
    tip.setAttribute('role', 'status');
    line = document.createElement('div');
    line.className = 'chart-crosshair';
    parent.append(line, tip);
    element._inspector = { tip, line };
  }
  element.tabIndex = 0;
  element.setAttribute('aria-describedby', 'chartInstructions');
  let index = 0, pinned = false;
  const hide = () => { tip.style.display = 'none'; line.style.display = 'none'; };
  const inspect = selected => {
    index = Math.max(0, Math.min(options.count - 1, selected));
    tip.innerHTML = options.content(index);
    tip.style.display = 'block';
    const px = options.x ? options.x(index) : 15;
    tip.style.left = Math.max(4, Math.min(parent.clientWidth - tip.offsetWidth - 4, px + 12)) + 'px';
    tip.style.top = '28px';
    if (options.x) { line.style.left = px + 'px'; line.style.display = 'block'; }
  };
  const fromEvent = event => {
    const box = element.getBoundingClientRect();
    return options.index(event.clientX - box.left, event.clientY - box.top);
  };
  element.onpointermove = event => {
    if (pinned || event.pointerType === 'touch') return;
    const selected = fromEvent(event);
    if (selected < 0) hide(); else inspect(selected);
  };
  element.onclick = event => {
    const selected = fromEvent(event);
    if (selected < 0) return;
    pinned = !pinned;
    inspect(selected);
  };
  element.onpointerleave = () => { if (!pinned) hide(); };
  element.onmouseleave = element.onpointerleave;
  element.onblur = () => { pinned = false; hide(); };
  element.onkeydown = event => {
    if (event.key === 'Escape') { pinned = false; hide(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    pinned = true;
    inspect(event.key === 'Home' ? 0 : event.key === 'End' ? options.count - 1 : index + (event.key === 'ArrowRight' ? 1 : -1));
  };
}

function chartRows(items) {
  return items.map(item => '<div class="inspector-row"><span><i style="background:' + item.color + '"></i>' + escapeChartText(item.label) + '</span><b>' + escapeChartText(item.value) + '</b></div>').join('');
}

function enhanceMarketCharts() {
  const chart = view.chart;
  const points = view.series;
  const series = chart.list.map(item => ({ ...item, lookup: new Map(item.data.map(point => [point.t, point])) }));
  const regional = new Map(view.regional.map(point => [point.t, point]));
  installChartInspector($('timeline'), {
    count: points.length,
    index: px => px < chart.L || px > chart.w - chart.R ? -1 : nearestChartIndex(points, view.a + (px - chart.L) / chart.pw * (view.b - view.a), point => point.t),
    x: index => chart.x(points[index].t),
    content: index => {
      const point = points[index];
      const rows = series.map(item => ({ color: item.color, label: item.name, value: num(item.lookup.get(point.t)?.v) + ' ' + unit(view.nm) }));
      const region = regional.get(point.t);
      if (view.rm !== 'none') rows.push({ color: chartColor('#16476b'), label: 'Visayas ' + labels[view.rm].toLowerCase(), value: num(region?.v) + ' MW' });
      return '<strong>' + stamp(point.t) + ' PHT</strong>' + chartRows(rows) + '<div class="inspector-note">' + point.n + ' node observations · ' + labels[view.nm] + '</div>';
    }
  });

  const hourly = Array.from({ length: 24 }, () => []);
  for (const row of view.nodes) hourly[new Date(row[0] - 1 + 28800000).getUTCHours()].push(val(row, 'LMP', 'node'));
  const profile = $('profile');
  const width = profile.getBoundingClientRect().width;
  installChartInspector(profile, {
    count: 24,
    index: px => px < 51 || px > width - 14 ? -1 : Math.round((px - 51) / (width - 65) * 23),
    x: index => 51 + index / 23 * (width - 65),
    content: index => '<strong>' + String(index).padStart(2, '0') + ':00–' + String((index + 1) % 24).padStart(2, '0') + ':00 PHT</strong>' + chartRows([{ color: '#b9650d', label: 'Mean nodal price', value: num(mean(hourly[index])) + ' ' + unit('LMP') }]) + '<div class="inspector-note">' + hourly[index].filter(Number.isFinite).length + ' available five-minute prices</div>'
  });
  const nodeNames = Object.keys(D.nodes);
  const comparisons = nodeNames.map(node => D.nodes[node].filter(row => row[0] > view.a && row[0] <= view.b).map(row => val(row, 'LMP', 'node')));
  installChartInspector($('comparison'), {
    count: nodeNames.length,
    index: (_px, py) => py < 0 || py > 200 ? -1 : Math.max(0, Math.min(nodeNames.length - 1, Math.round((py - 15) / 31))),
    content: index => '<strong>' + nodeNames[index] + '</strong>' + chartRows([{ color: '#b9650d', label: 'Mean nodal price', value: num(mean(comparisons[index])) + ' ' + unit('LMP') }]) + '<div class="inspector-note">' + comparisons[index].filter(Number.isFinite).length.toLocaleString() + ' prices · selected window</div>'
  });
}

function drawAnalyticalSeries(id, series, options = {}) {
  const { c, w, h, el } = canvas(id);
  if (options.compact) c.font = '13px Segoe UI, Arial';
  const L = options.compact ? 48 : 56, R = options.compact ? 12 : 24, T = options.compact ? 19 : 30, B = options.compact ? 28 : 36, pw = w - L - R, ph = h - T - B;
  const all = series.flatMap(item => item.data.filter(point => point.y != null));
  if (!all.length) return;
  const xmin = options.xmin ?? Math.min(...all.map(point => point.x));
  const xmax = options.xmax ?? Math.max(...all.map(point => point.x));
  let [lo, hi] = bounds(all.map(point => point.y));
  if (options.zero) lo = 0;
  const x = value => L + (value - xmin) / (xmax - xmin || 1) * pw;
  const y = value => T + (hi - value) / (hi - lo) * ph;
  if (options.boundary != null) {
    c.fillStyle=chartColor('#faf6ee');
    c.fillRect(x(options.boundary), T, w - R - x(options.boundary), ph);
    c.fillStyle=chartColor('#a38a64');
    c.textAlign = 'left';
    c.fillText('MODEL PROJECTIONS', x(options.boundary) + 9, T + 14);
  }
  const divisions = Math.max(1, Math.min(4, Math.floor(ph / 22)));
  for (let i = 0; i <= divisions; i++) {
    const yy = T + i * ph / divisions;
    c.strokeStyle=chartColor('#e8ecf2'); c.lineWidth = 1;
    c.beginPath(); c.moveTo(L, yy); c.lineTo(w - R, yy); c.stroke();
    c.textAlign = 'right'; c.fillStyle=chartColor('#43516a');
    c.fillText(num(hi - (hi - lo) * i / divisions, options.decimals ?? 0), L - 9, yy + 4);
  }
  const ticks = options.ticks || Array.from({ length: 5 }, (_, i) => Math.round(xmin + (xmax - xmin) * i / 4));
  const stride = options.compact && w < 360 ? 2 : w < 500 && ticks.length > 6 ? 2 : 1;
  ticks.forEach((tick, i) => {
    if (i % stride && i !== ticks.length - 1) return;
    c.textAlign = i === 0 ? 'left' : i === ticks.length - 1 ? 'right' : 'center';
    c.fillStyle=chartColor('#43516a');
    c.fillText(options.formatX ? options.formatX(tick) : String(tick), x(tick), h - 10);
  });
  if (options.boundary != null) {
    c.strokeStyle=chartColor('#c8bca8'); c.setLineDash([3, 4]); c.beginPath();
    c.moveTo(x(options.boundary), T); c.lineTo(x(options.boundary), h - B); c.stroke(); c.setLineDash([]);
  }
  for (const item of series) {
    c.strokeStyle=chartColor(item.color); c.lineWidth = item.name === 'Actual' ? 2.4 : 1.8;
    c.setLineDash(item.dashed ? [6, 4] : []); c.beginPath();
    let previous = false;
    for (const point of item.data) {
      if (point.y == null) { previous = false; continue; }
      if (options.maxGap && previous && point.x - previous > options.maxGap) previous = false;
      if (previous) c.lineTo(x(point.x), y(point.y)); else c.moveTo(x(point.x), y(point.y));
      previous = point.x;
    }
    c.stroke(); c.setLineDash([]);
    for (const point of options.markers === false ? [] : item.data) {
      if (point.y == null) continue;
      c.beginPath(); c.arc(x(point.x), y(point.y), 2.5, 0, Math.PI * 2); c.fillStyle=chartColor(item.color); c.fill();
    }
  }
  c.fillStyle=chartColor('#43516a'); c.textAlign = 'left'; c.fillText(options.unit || 'MW', L, 14);
  const xs = [...new Set(all.map(point => point.x))].sort((a, b) => a - b).map(value => ({ x: value }));
  installChartInspector(el, {
    count: xs.length,
    index: px => px < L || px > w - R ? -1 : nearestChartIndex(xs, xmin + (px - L) / pw * (xmax - xmin)),
    x: index => x(xs[index].x),
    content: index => {
      const value = xs[index].x;
      const items = series.map(item => ({ item, point: item.data.find(point => point.x === value) })).filter(pair => pair.point);
      return '<strong>' + escapeChartText(options.formatTooltip ? options.formatTooltip(value) : options.formatX ? options.formatX(value) : value) + '</strong>' + chartRows(items.map(pair => ({ color: pair.item.color, label: pair.item.name, value: num(pair.point.y) + ' ' + (options.unit || 'MW') })));
    }
  });
}

function enhanceValidationBars() {
  installChartInspector($('errorChart'), {
    count: rollingMetrics.length,
    index: (_px, py) => py < 12 || py > 245 ? -1 : Math.max(0, Math.min(rollingMetrics.length - 1, Math.floor((py - 21) / 43))),
    content: index => {
      const metric = rollingMetrics[index];
      return '<strong>' + escapeChartText(metric.Model) + '</strong>' + chartRows([{ color: '#b9650d', label: 'Rolling MAE', value: num(metric.MAE, 3) + ' MW' }]) + '<div class="inspector-note">2015–2024 · one-year-ahead · n = 10</div>';
    }
  });
}
