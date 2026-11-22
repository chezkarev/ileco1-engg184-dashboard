const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'theme.js'), 'utf8');
function fixture(initial, blocked = false) {
  const storage = new Map(initial ? [['panay-markets-theme', initial]] : []);
  const root = { dataset: {} };
  const buttons = ['light', 'dark'].map(mode => ({ dataset: { themeChoice: mode }, setAttribute(key, value) { this[key] = value; } }));
  const scope = vm.createContext({
    document: { documentElement: root, querySelectorAll: () => buttons },
    localStorage: {
      getItem(key) { if (blocked) throw Error('Storage blocked'); return storage.get(key); },
      setItem(key, value) { if (blocked) throw Error('Storage blocked'); storage.set(key, value); }
    }, palette: [], dColors: {}
  });
  vm.runInContext(source, scope);
  return { root, buttons, storage, run: code => vm.runInContext(code, scope) };
}
const saved = fixture('light');
assert.equal(saved.root.dataset.theme, 'light');
saved.run("setColorTheme('dark', false)");
assert.equal(saved.root.dataset.theme, 'dark');
assert.equal(saved.storage.get('panay-markets-theme'), 'dark');
assert.equal(saved.buttons[1]['aria-pressed'], 'true');
assert.equal(saved.buttons[0]['aria-pressed'], 'false');
assert.notEqual(saved.run("chartColor('#43516a')"), '#43516a');
assert.equal(fixture(saved.storage.get('panay-markets-theme')).root.dataset.theme, 'dark');
saved.run("setColorTheme('light', false)");
assert.equal(saved.run("chartColor('#43516a')"), '#43516a');
assert.equal(saved.run('palette.length'), 6);
assert.equal(saved.run('Object.keys(dColors).length'), 7);
const restricted = fixture(null, true);
assert.equal(restricted.root.dataset.theme, 'dark');
assert.doesNotThrow(() => restricted.run("setColorTheme('light', false)"));
assert.equal(restricted.root.dataset.theme, 'light');
console.log('Passed: saved theme across reloads, selected controls, chart colors, palette switching and blocked-storage fallback.');
