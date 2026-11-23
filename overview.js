/* Dashboard controls do not change the Market tab's filters. */
let dashboardNode = '08STBAR_SS1';
let dashboardPriceMode = 'forecast';
function buildLatestSnapshot(data, selectedNode = '08STBAR_SS1') {
  const names = Object.keys(data.nodes);
  const nodeLookups = names.map(name => new Map(data.nodes[name].map(row => [row[0], row])));
  // Use a common observed interval, rather than mixing different timestamps.
  const region = data.regional.slice().reverse().find(row => nodeLookups.every(rows => rows.has(row[0])));
  if (!region) return null;
  const end = region[0], start = end - 86400000;
  const reference = names.includes(selectedNode) ? selectedNode : names[0];
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

// Hour-ending means require twelve observed 5-minute prices; gaps stay missing.
function buildPriceForecast(rows, fields, cutoff) {
  const HOUR=3600000, DAY=24*HOUR, priceIndex=fields.indexOf('LMP')+1;
  const buckets=new Map();
  for(const row of rows){
    if(row[0]>cutoff || !Number.isFinite(row[priceIndex])) continue;
    const hour=Math.ceil(row[0]/HOUR)*HOUR;
    if(!buckets.has(hour)) buckets.set(hour,new Map());
    buckets.get(hour).set(row[0],row[priceIndex]/1000);
  }
  const hourly=new Map();
  for(const [hour,values] of buckets){
    if(Array.from({length:12},(_,i)=>hour-i*300000).every(t=>values.has(t)))
      hourly.set(hour,[...values.values()].reduce((a,b)=>a+b,0)/12);
  }
  const origin=Math.floor(cutoff/HOUR)*HOUR;
  const predict=(at,trend)=>{
    const recent=Array.from({length:24},(_,i)=>hourly.get(at-i*HOUR));
    const previous=Array.from({length:24},(_,i)=>hourly.get(at-DAY-i*HOUR));
    if(!recent.every(Number.isFinite) || (trend && !previous.every(Number.isFinite))) return null;
    const change=trend?(recent.reduce((a,b)=>a+b,0)-previous.reduce((a,b)=>a+b,0))/24:0;
    return Array.from({length:24},(_,i)=>({x:at+(i+1)*HOUR,y:recent[23-i]+change}));
  };
  // Non-overlapping rolling 24-hour holdouts; no future rows enter a prediction.
  const errors=[[],[]], persistenceErrors=[];
  let days=0;
  for(let day=1;day<=7;day++){
    const at=origin-day*DAY, forecasts=[predict(at,false),predict(at,true)];
    const actual=Array.from({length:24},(_,i)=>hourly.get(at+(i+1)*HOUR));
    if(!forecasts.every(Boolean)||!actual.every(Number.isFinite)) continue;
    days++;
    forecasts.forEach((points,model)=>points.forEach((p,i)=>errors[model].push(Math.abs(p.y-actual[i]))));
    actual.forEach(value=>persistenceErrors.push(Math.abs(hourly.get(at)-value)));
  }
  const average=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  const scores=errors.map(average);
  const selected=days>=3 && scores[1]<scores[0]?1:0;
  const points=predict(origin,selected===1);
  if(!points) return {origin,points:[],reason:'A complete preceding 24-hour price profile is required.'};
  const peak=Math.max(...points.map(p=>p.y));
  return {origin,points,peak,peakHours:points.filter(p=>Math.abs(p.y-peak)<1e-9).map(p=>p.x),
    model:selected?'Daily pattern + recent daily trend':'Previous-day hourly pattern',
    mae:days>=3?scores[selected]:null, baselineMae:days>=3?scores[0]:null,
    persistenceMae:days>=3?average(persistenceErrors):null,days,
    observed:Array.from({length:24},(_,i)=>({x:origin-(23-i)*HOUR,y:hourly.get(origin-(23-i)*HOUR)??null}))};
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
    <section class="dash-panel dash-price"><div class="dash-panel-title"><h2 id="dashboardPriceTitle">Price outlook · 24 hours ahead</h2><div class="dashboard-price-controls"><select id="dashboardNode" aria-label="Dashboard price bus"></select><select id="dashboardPriceMode" aria-label="Dashboard price chart"><option value="forecast">24-hour forecast</option><option value="observed">Observed · past 24h</option></select></div></div><div class="overview-chart"><canvas id="overviewPrice" role="img" aria-label="Selected bus price outlook"></canvas></div><div id="dashboardForecastNote" class="dashboard-forecast-note" aria-live="polite"></div></section>
    <section class="dash-panel dash-supplier"><div class="dash-panel-title"><h2>Power supplier · regional context</h2></div><div class="dash-supplier-body"><strong>Panay Energy Development Corp.</strong><div class="dash-capacity"><b>314 <small>MW</small></b><span>164 + 150 MW installed</span></div><p>Coal-fired generation · Iloilo City</p><p class="supplier-note">Regional generator; bus-level suppliers unverified.</p><a href="https://www.gbp.com.ph/power-generation/our-solutions-panay-mindoro/" target="_blank" rel="noopener">PEDC / official plant profile</a><div id="overviewCompleteness"></div></div></section>
    <section class="dash-panel dash-regional"><div class="dash-panel-title"><h2>Generation & requirement</h2><span>MW</span></div><div class="overview-chart secondary"><canvas id="overviewRegional" role="img" aria-label="Visayas generation and market requirement for the latest 24 hours"></canvas></div><div class="dash-legend"><span><i></i>Generation</span><span><i></i>Requirement</span></div></section>
    <section class="dash-panel dash-buses"><div class="dash-panel-title"><h2>Latest bus prices</h2><span>PHP/kWh</span></div><div id="latestBusPrices" class="latest-bus-prices"></div></section>
  </div>
  <div class="dash-footnote"><span id="overviewAsOf"></span><span>Wholesale RTD · approximate station areas · ILECO I mapping unverified</span></div>`;
}

function renderOverview() {
  const snapshot = buildLatestSnapshot(D, dashboardNode);
  if (!snapshot) { $('rangeCaption').textContent = 'No common bus and regional observation is available.'; return; }
  const price = value => value == null ? '—' : '₱' + num(value / 1000);
  $('nowPrice').textContent = price(snapshot.price);
  $('nowPrice').nextElementSibling.innerHTML='Selected bus price <small>PHP/kWh</small>';
  const selector=$('dashboardNode');
  selector.innerHTML=Object.keys(D.nodes).map(name=>'<option value="'+name+'">'+name+'</option>').join('');
  selector.value=snapshot.reference;
  selector.onchange=()=>{dashboardNode=selector.value;renderOverview();};
  $('dashboardPriceMode').value=dashboardPriceMode;
  $('dashboardPriceMode').onchange=()=>{dashboardPriceMode=$('dashboardPriceMode').value;renderOverview();};
  $('nowGeneration').textContent = num(snapshot.generation, 0);
  $('nowRequirement').textContent = num(snapshot.requirement, 0);
  $('nowSpread').textContent = price(snapshot.spread);
  $('overviewAsOf').textContent = 'Interval ended ' + stamp(snapshot.end) + ' PHT';
  $('rangeCaption').textContent = 'Market snapshot · Panay buses & Visayas grid';
  const clock = value => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
  const ticks = Array.from({ length: 5 }, (_, i) => snapshot.start + i * 21600000);
  const options = { ticks, xmin: snapshot.start, xmax: snapshot.end, formatX: clock, formatTooltip: value => stamp(value) + ' PHT', markers: false, maxGap: 450000, compact: true };
  renderDashboardPrice(snapshot,options,clock);
  drawAnalyticalSeries('overviewRegional', [
    { name: 'Generation', color: '#16476b', data: snapshot.regional.map(row => ({ x: row[0], y: row[D.regionalFields.indexOf('GENERATION') + 1] })) },
    { name: 'Market requirement', color: '#b9650d', dashed: true, data: snapshot.regional.map(row => ({ x: row[0], y: row[D.regionalFields.indexOf('MKT_REQT') + 1] })) }
  ], { ...options, unit: 'MW' });
  const max = Math.max(1, ...snapshot.nodePrices.map(row => Math.abs(row.value || 0)));
  $('latestBusPrices').innerHTML = snapshot.nodePrices.map(row => '<div class="latest-bus-row"><span>' + escapeChartText(row.name) + '</span><strong>' + price(row.value) + '</strong><div class="bus-price-track"><span style="width:' + (Math.abs(row.value || 0) / max * 100) + '%" class="' + (row.value < 0 ? 'negative' : '') + '"></span></div></div>').join('');
  $('overviewCompleteness').textContent = snapshot.prices.filter(row => Number.isFinite(row.y)).length + '/288 price intervals · ' + snapshot.regional.length + '/288 regional intervals';
  renderOverviewMap(snapshot);
  updateComparisonIndicators(snapshot);
}

function renderDashboardPrice(snapshot,options,clock){
  const forecast=buildPriceForecast(D.nodes[snapshot.reference],D.nodeFields,snapshot.end);
  const note=$('dashboardForecastNote');
  $('dashboardPriceTitle').textContent=dashboardPriceMode==='forecast'?'Price outlook · 24 hours ahead':'Spot price · past 24 hours';
  $('overviewPrice').setAttribute('aria-label',snapshot.reference+' · '+(dashboardPriceMode==='forecast'?'24-hour-ahead hourly price forecast':'past 24-hour observed prices'));
  if(dashboardPriceMode==='observed'){
    drawAnalyticalSeries('overviewPrice',[{name:snapshot.reference,color:'#b9650d',data:snapshot.prices}],{...options,unit:'PHP/kWh',decimals:1});
    note.textContent=snapshot.reference+' · observed 5-minute LMP · PHP/kWh';
    return;
  }
  if(!forecast.points.length){
    drawAnalyticalSeries('overviewPrice',[],{...options,unit:'PHP/kWh'});
    note.textContent='Forecast unavailable: '+forecast.reason;
    return;
  }
  const start=forecast.origin-23*3600000,end=forecast.origin+86400000;
  const label=t=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',day:'2-digit',month:'short',hour:'2-digit',hourCycle:'h23'}).format(t);
  drawAnalyticalSeries('overviewPrice',[
    {name:'Observed hourly mean',color:'#16476b',data:forecast.observed},
    {name:forecast.model+' · forecast',color:'#b9650d',dashed:true,data:[{x:forecast.origin,y:forecast.observed.at(-1).y},...forecast.points]}
  ],{...options,xmin:start,xmax:end,ticks:Array.from({length:5},(_,i)=>start+i*(end-start)/4),formatX:label,unit:'PHP/kWh',decimals:1,maxGap:5400000});
  const peakHour=forecast.peakHours[0];
  const hourRange=clock(peakHour-3600000)+'–'+clock(peakHour);
  const peakDate=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',day:'2-digit',month:'short'}).format(peakHour-3600000);
  const historical=Date.now()>end;
  note.innerHTML='<strong>Estimated peak: ₱'+num(forecast.peak)+'/kWh · '+peakDate+' '+hourRange+' PHT'+(forecast.peakHours.length>1?' (tied hours)':'')+'</strong><span>'+ (historical?'Historical forecast · update source data for a current outlook. ':'') +'Forecast ends '+stamp(end)+' PHT · dashed = forecast; solid = observed. Hour-ending averages.</span><details><summary>Model & validation</summary><p>'+forecast.model+'. Repeats the preceding day’s hourly pattern; the trend variant adds the change in daily mean. Variant selected by MAE on '+forecast.days+' completed rolling 24-hour holdouts. '+(forecast.mae==null?'Fewer than three valid holdouts; validation unavailable.':'Selected MAE: ₱'+num(forecast.mae)+'/kWh; previous-day baseline: ₱'+num(forecast.baselineMae)+'/kWh; last-price baseline: ₱'+num(forecast.persistenceMae)+'/kWh. These holdouts select the variant and are not an independent test.')+' No weather inputs. Estimated peak hour, not a guaranteed spike prediction. Forecast origin: '+stamp(forecast.origin)+' PHT.</p></details>';
}

function comparisonMarkup(current, previous, label) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return '<span class="metric-change neutral">— Comparison unavailable</span>';
  const difference=current-previous;
  const percent=previous>0?Math.abs(difference)/previous*100:null;
  return '<span class="metric-change '+(difference>0?'up':difference<0?'down':'neutral')+'" title="Previous value: '+num(previous,4)+'">'+(difference>0?'▲ +':difference<0?'▼ −':'• ')+(percent==null?num(Math.abs(difference))+' absolute':num(percent,1)+'%')+'<small>'+label+'</small></span>';
}
function setIndicator(element,current,previous,label) {
  element.querySelector('.metric-change')?.remove();
  element.insertAdjacentHTML('beforeend',comparisonMarkup(current,previous,label));
}
function updateComparisonIndicators(snapshot) {
  const time=snapshot.end-86400000;
  const region=D.regional.find(r=>r[0]===time);
  const field=(row,name,fields)=>row?row[fields.indexOf(name)+1]:null;
  const prices=snapshot.nodePrices.map(n=>field(D.nodes[n.name].find(r=>r[0]===time),'LMP',D.nodeFields));
  const reference=field(D.nodes[snapshot.reference].find(r=>r[0]===time),'LMP',D.nodeFields);
  const spread=prices.every(Number.isFinite)?Math.max(...prices)-Math.min(...prices):null;
  const kwh=value=>Number.isFinite(value)?value/1000:null;
  [[kwh(snapshot.price),kwh(reference)],[snapshot.generation,field(region,'GENERATION',D.regionalFields)],[snapshot.requirement,field(region,'MKT_REQT',D.regionalFields)],[kwh(snapshot.spread),kwh(spread)]].forEach((pair,i)=>setIndicator(document.querySelectorAll('.overview-stat')[i],...pair,'vs. same interval yesterday'));
  document.querySelectorAll('.latest-bus-row').forEach((row,i)=>setIndicator(row,kwh(snapshot.nodePrices[i].value),kwh(prices[i]),'vs. yesterday'));
  const definitions={nowPrice:'Observed wholesale locational marginal price at '+snapshot.reference+', in PHP/kWh. This is not a forecast or retail tariff.',nowGeneration:'Total generation in the Visayas regional market records, in MW. It is not Panay-only generation.',nowRequirement:'Visayas market requirement, in MW. This is distinct from ILECO I demand.',nowSpread:'Highest minus lowest price across the six candidate Panay buses at the same observed interval.'};
  for(const [id,definition] of Object.entries(definitions)){const label=$(id).nextElementSibling;markDefinition(label,label.textContent,definition);}
}
function marketComparisonIndicators() {
  if(!view.nodes)return;
  const nodes=D.nodes[view.node].filter(r=>r[0]>view.a-86400000&&r[0]<=view.b-86400000);
  const regional=D.regional.filter(r=>r[0]>view.a-86400000&&r[0]<=view.b-86400000);
  const last=view.nodes.at(-1),previous=last&&D.nodes[view.node].find(r=>r[0]===last[0]-86400000);
  setIndicator($('meanPrice').parentElement,mean(view.nodes.map(r=>val(r,'LMP','node'))),mean(nodes.map(r=>val(r,'LMP','node'))),'vs. window shifted back 1 day');
  setIndicator($('latestPrice').parentElement,last?val(last,'LMP','node'):null,previous?val(previous,'LMP','node'):null,'vs. same interval yesterday');
  setIndicator($('generation').parentElement,mean(view.reg.map(r=>val(r,'GENERATION','regional'))),mean(regional.map(r=>val(r,'GENERATION','regional'))),'vs. window shifted back 1 day');
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
  describe(snapshot.reference.startsWith('08ILO_')?'ilo':'sta');
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
