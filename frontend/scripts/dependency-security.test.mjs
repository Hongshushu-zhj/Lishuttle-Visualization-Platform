import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('source-map-js includes indexed section offset denial-of-service fix',()=>{const v=require('source-map-js/package.json').version.split('.').map(Number);assert.ok(v[0]===1&&(v[1]>2||v[1]===2&&v[2]>=2),'GHSA-68fv-2mgg-jv7q requires source-map-js >=1.2.2');});
