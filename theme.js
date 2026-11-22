/* One persisted color theme for every page and canvas chart. */
const THEME_STORAGE_KEY = 'panay-markets-theme';
const DARK_CHART_COLORS = {
  '#43516a': '#c5d2e7', '#163247': '#edf3ff', '#272448': '#b9c9ff',
  '#e8ecf2': '#35465f', '#eef2f7': '#263951', '#faf6ee': '#26364a',
  '#a38a64': '#e6c796', '#c8bca8': '#8a9cb4', '#b9650d': '#ff993e',
  '#16476b': '#55d5da', '#c7bdd7': '#8c9fc4', '#bbb6ca': '#8c9fc4',
  '#444765': '#b9c9ff', '#788ba4': '#90c3ed', '#5e8584': '#76d1c0',
  '#a06f62': '#edac94', '#9693aa': '#b8abe1', '#a79db9': '#b8abe1',
  '#587b82': '#76ccd3', '#ad6b73': '#f1a8b6', '#70658e': '#bda6ee', '#aaa6ad': '#b9c6d8'
};

function savedTheme() {
  try { return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

document.documentElement.dataset.theme = savedTheme();

function chartColor(color) {
  return document.documentElement.dataset.theme === 'dark' ? DARK_CHART_COLORS[String(color).toLowerCase()] || color : color;
}

function initializeTheme() {
  const control = document.createElement('div');
  control.className = 'theme-control';
  control.setAttribute('role', 'group');
  control.setAttribute('aria-label', 'Color theme');
  control.innerHTML = '<button type="button" data-theme-choice="light" aria-pressed="false">Light</button><button type="button" data-theme-choice="dark" aria-pressed="false">Dark</button>';
  document.querySelector('.rail').append(control);
  control.querySelectorAll('button').forEach(button => button.onclick = () => setColorTheme(button.dataset.themeChoice));
  setColorTheme(document.documentElement.dataset.theme, false);
}

function setColorTheme(theme, redraw = true) {
  const selected = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = selected;
  try { localStorage.setItem(THEME_STORAGE_KEY, selected); } catch { /* Works without storage. */ }
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === selected)));
  palette.splice(0, 6, ...['#b9650d', '#444765', '#788ba4', '#5e8584', '#a06f62', '#9693aa'].map(chartColor));
  Object.assign(dColors, Object.fromEntries(Object.entries({ Actual: '#272448', 'Log-Linear': '#b9650d', 'Linear Full': '#a79db9', 'Linear 10-Year Recent': '#587b82', 'Linear 5-Year Recent': '#ad6b73', PSPP: '#70658e', Naive: '#aaa6ad' }).map(([name, color]) => [name, chartColor(color)])));
  if (!redraw) return;
  if (typeof definitionBubble !== 'undefined' && definitionBubble) hideDefinition();
  if (activeView === 'demand') renderDemand();
  else render();
}
