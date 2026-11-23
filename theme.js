/* Light-only appearance; legacy stored theme preferences are ignored. */
document.documentElement.dataset.theme = 'light';
function chartColor(color) { return color; }
function initializeTheme() { setColorTheme('light', false); }
function setColorTheme(_theme, redraw = true) {
  document.documentElement.dataset.theme = 'light';
  palette.splice(0,6,'#b9650d','#444765','#788ba4','#5e8584','#a06f62','#9693aa');
  Object.assign(dColors, { Actual:'#272448', 'Log-Linear':'#b9650d', 'Linear Full':'#a79db9', 'Linear 10-Year Recent':'#587b82', 'Linear 5-Year Recent':'#ad6b73', PSPP:'#70658e', Naive:'#aaa6ad' });
  if(!redraw)return;
  if(typeof definitionBubble!=='undefined' && definitionBubble) hideDefinition();
  if(activeView==='demand')renderDemand();else render();
}
