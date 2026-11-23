/* Dashboard controls do not change the Market tab's filters. */
let dashboardNode = '08STBAR_SS1';
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

const PRICE_MODELS = {'log':'Log-Linear','full':'Linear Full','recent10':'Linear 10-Day Recent','recent5':'Linear 5-Day Recent'};
let marketPriceModel='recent10', marketPriceHorizon=24, marketForecastResult=null;
// Complete hour-ending averages only. Regress time within hour-of-day groups:
// y = hour-specific intercept + common linear trend. Log model uses log(y).
function buildPriceForecast(rows, fields, cutoff, model='full', horizon=24) {
  if(!PRICE_MODELS[model] || ![12,24].includes(horizon)) throw Error('Unsupported forecast control');
  const HOUR=3600000, DAY=24*HOUR, index=fields.indexOf('LMP')+1, buckets=new Map();
  const origin=Math.floor(cutoff/HOUR)*HOUR;
  for(const r of rows){
    if(r[0]>origin || !Number.isFinite(r[index])) continue;
    const t=Math.ceil(r[0]/HOUR)*HOUR;
    if(!buckets.has(t)) buckets.set(t,new Map());
    buckets.get(t).set(r[0],r[index]/1000);
  }
  const hourly=new Map();
  for(const [t,values] of buckets) if(Array.from({length:12},(_,i)=>t-i*300000).every(x=>values.has(x))) hourly.set(t,[...values.values()].reduce((a,b)=>a+b,0)/12);
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  const hour=t=>((t/HOUR+8)%24+24)%24;
  const fit=at=>{
    const days=model==='recent10'?10:model==='recent5'?5:Infinity;
    const train=[...hourly].filter(([t])=>t<=at && t>at-days*DAY).sort((a,b)=>a[0]-b[0]);
    if(train.length<72 || !hourly.has(at)) return {reason:'At least 72 complete hourly observations and a complete origin hour are required.'};
    if(model==='log' && train.some(([,y])=>y<=0)) return {reason:'Log-Linear requires strictly positive training prices. Zero/negative prices are retained; choose a linear model.'};
    const groups=Array.from({length:24},()=>[]);
    train.forEach(([t,y])=>groups[hour(t)].push({x:(t-at)/DAY,y:model==='log'?Math.log(y):y}));
    if(groups.some(g=>g.length<2)) return {reason:'Each hour of day needs at least two complete observations.'};
    const means=groups.map(g=>({x:avg(g.map(p=>p.x)),y:avg(g.map(p=>p.y))}));
    let numerator=0,denominator=0;
    groups.forEach((g,h)=>g.forEach(p=>{numerator+=(p.x-means[h].x)*(p.y-means[h].y);denominator+=(p.x-means[h].x)**2;}));
    if(!denominator) return {reason:'Insufficient time variation for a trend fit.'};
    const slope=numerator/denominator, offsets=means.map(m=>m.y-slope*m.x);
    const smear=model==='log'?avg(train.map(([t,y])=>Math.exp(Math.log(y)-offsets[hour(t)]-slope*(t-at)/DAY))):1;
    const points=Array.from({length:horizon},(_,i)=>{const x=at+(i+1)*HOUR,z=offsets[hour(x)]+slope*(x-at)/DAY;return {x,y:model==='log'?Math.exp(z)*smear:z};});
    if(points.some(p=>!Number.isFinite(p.y))) return {reason:'The fitted model produced non-finite predictions.'};
    return {points,count:train.length,start:train[0][0],slope};
  };
  const fitted=fit(origin);
  if(!fitted.points) return {origin,points:[],reason:fitted.reason};
  const errors=[],baseline=[],peakErrors=[];let days=0;
  for(let d=1;d<=7;d++){
    const at=origin-d*DAY,predicted=fit(at);
    const actual=Array.from({length:horizon},(_,i)=>hourly.get(at+(i+1)*HOUR));
    const naive=Array.from({length:horizon},(_,i)=>hourly.get(at+(i+1)*HOUR-DAY));
    if(!predicted.points || !actual.every(Number.isFinite) || !naive.every(Number.isFinite)) continue;
    days++;
    predicted.points.forEach((p,i)=>{errors.push(Math.abs(p.y-actual[i]));baseline.push(Math.abs(naive[i]-actual[i]));});
    const peakIndex=predicted.points.findIndex(p=>p.y===Math.max(...predicted.points.map(q=>q.y)));
    peakErrors.push(Math.abs(peakIndex-actual.indexOf(Math.max(...actual))));
  }
  const peak=Math.max(...fitted.points.map(p=>p.y));
  return {origin,...fitted,peak,peakHours:fitted.points.filter(p=>Math.abs(p.y-peak)<1e-9).map(p=>p.x),model:PRICE_MODELS[model],horizon,days,
    mae:days>=3?avg(errors):null,baselineMae:days>=3?avg(baseline):null,peakError:days>=3?avg(peakErrors):null,
    observed:Array.from({length:24},(_,i)=>({x:origin-(23-i)*HOUR,y:hourly.get(origin-(23-i)*HOUR)??null}))};
}

function marketForecastMarkup(){
 return `<section class="panel market-forecast" aria-label="Market price forecasting"><div class="panel-head"><div><h2>Price forecast · experimental</h2><div id="marketForecastContext" class="panel-sub"></div></div><div class="market-forecast-controls"><label>Model<select id="marketPriceModel">${Object.entries(PRICE_MODELS).map(([key,label])=>'<option value="'+key+'">'+label+'</option>').join('')}</select></label><label>Horizon<select id="marketPriceHorizon"><option value="12">12 hours</option><option value="24" selected>1 day · 24 hours</option></select></label><button id="exportPriceForecast">Export forecast CSV</button></div></div><div id="marketForecastStatus" aria-live="polite"></div><div class="market-forecast-chart"><canvas id="marketForecastChart" role="img" aria-label="Selected bus hourly price forecast"></canvas></div><details class="forecast-method"><summary>Forecast method & validation</summary><div id="marketForecastMethod"></div></details></section>`;
}
function initializeMarketForecast(){
 $('marketPriceModel').value=marketPriceModel;
 $('marketPriceHorizon').value=String(marketPriceHorizon);
 $('marketPriceModel').onchange=()=>{marketPriceModel=$('marketPriceModel').value;renderMarketForecast();};
 $('marketPriceHorizon').onchange=()=>{marketPriceHorizon=Number($('marketPriceHorizon').value);renderMarketForecast();};
 $('exportPriceForecast').onclick=()=>{
   if(!marketForecastResult?.points.length)return;
   const f=marketForecastResult,body='BUS,MODEL,ORIGIN_PHT,INTERVAL_END_PHT,HORIZON_HOURS,FORECAST_PHP_PER_KWH\n'+f.points.map(p=>[view.node,f.model,stamp(f.origin)+' PHT',stamp(p.x)+' PHT',f.horizon,p.y].map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');
   const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([body],{type:'text/csv;charset=utf-8'}));link.download='Panay_price_forecast_'+view.node+'_'+f.horizon+'h.csv';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
 };
}
function renderMarketForecast(){
 if(!$('experimentalForecast').open)return;
 const last=view.nodes?.at(-1),context=$('marketForecastContext'),status=$('marketForecastStatus'),method=$('marketForecastMethod');
 $('marketForecastChart').parentElement.hidden=false;
 if(!last){marketForecastResult=null;context.textContent='No observations in the selected window.';status.textContent='Select a date range with observed prices.';method.textContent='';$('marketForecastChart').parentElement.hidden=true;$('exportPriceForecast').disabled=true;return;}
 const f=buildPriceForecast(D.nodes[view.node],D.nodeFields,last[0],marketPriceModel,marketPriceHorizon);marketForecastResult=f;
 context.textContent=view.node+' · hourly average LMP · PHP/kWh · origin '+stamp(f.origin)+' PHT';
 $('exportPriceForecast').disabled=!f.points.length;
 const notes='Fits observed hourly prices with a linear time trend and 24 hour-of-day intercepts. Log-Linear fits log(price), then applies a residual smearing correction. Full uses all available prior history; recent models use the preceding 10 or 5 days, adapted from the annual demand study’s year-based windows. Training may precede the selected display start date. All fitting uses data available at each forecast origin. No weather inputs. Prices are not retail tariffs.';
 if(!f.points.length){status.textContent='Forecast unavailable: '+f.reason;method.textContent=notes;$('marketForecastChart').parentElement.hidden=true;return;}
 const end=f.points.at(-1).x,peak=f.peakHours[0],historical=Date.now()>end;
 status.innerHTML='<div><span>Estimated peak hourly mean</span><strong>₱'+num(f.peak)+'/kWh</strong><span>'+stamp(peak-3600000)+'–'+new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(peak)+' PHT'+(f.peakHours.length>1?' · tied hours':'')+'</span></div><div><span>'+ (historical?'Historical forecast':'Forecast window')+'</span><strong>'+f.horizon+' hours ahead</strong><span>Ends '+stamp(end)+' PHT'+(historical?' · newer source data needed for a current outlook.':'')+'</span></div><div><span>Rolling backtest MAE</span><strong>'+(f.mae==null?'Unavailable':'₱'+num(f.mae)+'/kWh')+'</strong><span>'+f.days+' complete holdouts · '+f.horizon+' hours each</span></div>';
 method.textContent=notes+' Training: '+f.count+' complete hours from '+stamp(f.start)+' PHT. '+(f.mae==null?'At least 3 valid holdouts are needed to report accuracy.':'MAE: ₱'+num(f.mae)+'/kWh; previous-day baseline MAE: ₱'+num(f.baselineMae)+'/kWh. Mean peak-hour timing error: '+num(f.peakError,1)+' hours (earliest tied peak). Seven prior origins are evaluated where complete data exist. Model choice is manual; browsing these scores is not an independent final test.')+' Estimated peaks are not guaranteed price spikes.';
 if(f.mae!=null){const comparison=document.createElement('span');comparison.textContent='Previous-day baseline MAE: ₱'+num(f.baselineMae)+'/kWh'+(f.mae>f.baselineMae?' · lower error than this model.':' · selected model has equal or lower error.');status.lastElementChild.append(comparison);}
 const start=f.origin-23*3600000;
 drawAnalyticalSeries('marketForecastChart',[{name:'Observed hourly mean',color:'#16476b',data:f.observed},{name:f.model+' · forecast',color:'#b9650d',dashed:true,data:[{x:f.origin,y:f.observed.at(-1).y},...f.points]}],{xmin:start,xmax:end,ticks:Array.from({length:5},(_,i)=>start+i*(end-start)/4),formatX:t=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',day:'2-digit',month:'short',hour:'2-digit',hourCycle:'h23'}).format(t),formatTooltip:t=>stamp(t)+' PHT',unit:'PHP/kWh',decimals:2,maxGap:5400000,compact:true});
}

// ILECO I PSPP 2026–2035, p.11; these are reported supply capacities, not MWh shares.
function supplierPortfolioMarkup() {
  const suppliers = [
    ['GCGI', 'Green Core Geothermal, Inc.', 18, '#215c79'],
    ['PEDC U3', 'Panay Energy Development Corp. · Unit 3', 8, '#b75e13'],
    ['PEDC U1–2', 'Panay Energy Development Corp. · Units 1 & 2', 3.5, '#7b7398'],
    ['SPI', 'Sual Power Inc.', 15, '#398879']
  ];
  const total = suppliers.reduce((sum, row) => sum + row[2], 0);
  return `<div class="supplier-total"><strong>${total.toFixed(1)} <small>MW</small></strong><span>Reported supply capacity · PSPP 2026–2035</span></div>
    <div class="supplier-stack" role="img" aria-label="Reported supply capacity: GCGI 18 MW; PEDC Unit 3 8 MW; PEDC Units 1 and 2 3.5 MW; SPI 15 MW. Total 44.5 MW. Not actual energy shares.">${suppliers.map(([label, name, mw, color]) => `<span style="flex:${mw};background:${color}" title="${name}: ${mw} MW (${(mw / total * 100).toFixed(1)}% of listed capacity)"></span>`).join('')}</div>
    <ul class="supplier-list" aria-label="Suppliers listed in ILECO I's plan">${suppliers.map(([label, name, mw, color]) => `<li><span title="${name}"><i style="background:${color}"></i>${label}</span><b>${mw} MW</b></li>`).join('')}</ul>
    <p class="supplier-note">WESM: additional spot purchases; no fixed MW allocation.</p>
    <details class="supplier-details"><summary>Names, status & historical suppliers</summary><p>${suppliers.map(([, name, mw]) => `${name}: ${mw} MW`).join('; ')}.</p><p>SPI: delivery began 26 Nov 2025 (p.5); the planning table still classifies 15 MW as pending (p.8). GNPK and FDC provided emergency supply in 2025, replaced by SPI (p.5). These are not additional current capacity segments.</p><p>Capacity shares are not actual generation, energy-purchase shares or bus-level supplier assignments. The plan is dated 3 Nov 2026; this panel is not a live contract registry.</p></details>
    <div class="supplier-source">Source: <a href="https://ileco1.com/wp-content/uploads/2026/11/2026-PSPP-ILECO-I.pdf#page=11" target="_blank" rel="noopener">ILECO I PSPP 2026–2035 · pp.5, 8, 11</a> · <a href="https://ileco1.com/power-supply-procurement-plan-2026-2035/" target="_blank" rel="noopener">Official publication</a></div><div id="overviewCompleteness"></div>`;
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
    <section class="dash-panel dash-price"><div class="dash-panel-title"><h2 id="dashboardPriceTitle">Spot price · past 24 hours</h2><div class="dashboard-price-controls"><select id="dashboardNode" aria-label="Dashboard price bus"></select></div></div><div class="overview-chart"><canvas id="overviewPrice" role="img" aria-label="Selected bus price outlook"></canvas></div></section>
    <section class="dash-panel dash-supplier"><div class="dash-panel-title"><h2>ILECO I · electricity supply portfolio</h2></div><div class="dash-supplier-body">${supplierPortfolioMarkup()}</div></section>
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
  $('nowGeneration').textContent = num(snapshot.generation, 0);
  $('nowRequirement').textContent = num(snapshot.requirement, 0);
  $('nowSpread').textContent = price(snapshot.spread);
  $('overviewAsOf').textContent = 'Interval ended ' + stamp(snapshot.end) + ' PHT';
  $('rangeCaption').textContent = 'WESM price monitoring and forecasting support · Selected Panay buses & Visayas grid';
  const clock = value => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
  const ticks = Array.from({ length: 5 }, (_, i) => snapshot.start + i * 21600000);
  const options = { ticks, xmin: snapshot.start, xmax: snapshot.end, formatX: clock, formatTooltip: value => stamp(value) + ' PHT', markers: false, maxGap: 450000, compact: true };
  $('overviewPrice').setAttribute('aria-label',snapshot.reference+' · observed bus prices for the past 24 hours');
  drawAnalyticalSeries('overviewPrice',[{name:snapshot.reference,color:'#b9650d',data:snapshot.prices}],{...options,unit:'PHP/kWh',decimals:1});
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
