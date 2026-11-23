const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'..','theme.js'),'utf8');
for(const saved of ['dark','light',null]) {
 const root={dataset:{}};
 const scope=vm.createContext({document:{documentElement:root},localStorage:{getItem:()=>saved},palette:[],dColors:{}});
 vm.runInContext(source,scope);
 assert.equal(root.dataset.theme,'light');
 vm.runInContext('initializeTheme();setColorTheme("dark",false)',scope);
 assert.equal(root.dataset.theme,'light');
 assert.equal(vm.runInContext('chartColor("#43516a")',scope),'#43516a');
 assert.equal(vm.runInContext('palette.length',scope),6);
 assert.equal(vm.runInContext('Object.keys(dColors).length',scope),7);
}
assert.ok(!source.includes('createElement'));
console.log('Passed: light-only appearance, ignored legacy dark preference, chart palette, no theme controls.');
