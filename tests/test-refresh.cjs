/* Verify Dashboard manual refresh without changing automatic updates elsewhere. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = { dataset: { activeView: 'dashboard' } };
const fields = { refresh: {}, message: {}, start: { value: '2026-11-14', min: '2026-08-23' }, end: { value: '2026-11-20', max: '2026-11-20' } };
const scope = vm.createContext({
  console, Date, Intl, location: { hash: '' },
  document: { querySelector: () => app },
  $: id => fields[id],
  datePHT: time => new Date(time + 28800000).toISOString().slice(0, 10)
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'hosted-source.js'), 'utf8'), scope);
vm.runInContext(`
  let D={sourceVersion:'v1'}, requests=0, renders=0, nextVersion='v1', interruptLoad=false;
  hostedVersion='v1';
  hostedJson=async()=>{requests++;return {sourceVersion:nextVersion}};
  hostedConnection=()=>{};
  metadata=()=>{};
  render=()=>{renders++};
  loadHostedData=async status=>{
    hostedStatus=status;hostedVersion=status.sourceVersion;
    if(interruptLoad)document.querySelector('.app').dataset.activeView='dashboard';
    return {sourceVersion:status.sourceVersion};
  };
`, scope);
const run = code => vm.runInContext(code, scope);

(async () => {
  assert.equal(run('automaticRefreshAllowed()'), false);
  await run('refreshHosted(true)');
  assert.equal(run('requests'), 0);
  app.dataset.activeView = '';
  assert.equal(run('automaticRefreshAllowed()'), false); // Default initial route.
  scope.location.hash = '#market';
  assert.equal(run('automaticRefreshAllowed()'), true);
  for (const page of ['market', 'map', 'calculator', 'demand', 'sources', 'project']) {
    app.dataset.activeView = page;
    assert.equal(run('automaticRefreshAllowed()'), true, page);
  }
  await run('refreshHosted(true)');
  assert.equal(run('requests'), 1);

  // A pending automatic load must not update the Dashboard after navigating to it.
  app.dataset.activeView = 'market';
  run("nextVersion='v2';interruptLoad=true");
  await run('refreshHosted(true)');
  assert.equal(run('D.sourceVersion'), 'v1');
  assert.equal(run('hostedVersion'), 'v1');
  assert.equal(run('renders'), 0);

  // Explicit refresh remains available on the Dashboard.
  run('interruptLoad=false');
  await run('refreshHosted(false)');
  assert.equal(run('D.sourceVersion'), 'v2');
  assert.equal(run('renders'), 1);
  assert.equal(fields.refresh.disabled, false);
  console.log('Passed: Dashboard manual refresh, automatic updates elsewhere, and pending-load navigation protection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
