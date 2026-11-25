import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { httpContract } from './http-contract.js';

const header = (value: unknown[]) => ({
  name: 'Omnigraph-Http-Api', in: 'header', required: true, schema: { type: 'string', enum: value },
});
const spec = (...ops: unknown[][]) => ({
  paths: Object.fromEntries(ops.map((values, i) => [`/p${i}`, { get: { parameters: [header(values)] } }])),
});

test('the contract is the spec header value, not the server release', () => {
  const pinned = JSON.parse(readFileSync(new URL('../spec/openapi.json', import.meta.url), 'utf8'));
  const contract = httpContract(pinned);
  assert.match(contract, /^\d+\.\d+$/);
  assert.equal(httpContract(spec(['0.14'], ['0.14'])), '0.14');
});

test('a spec with no, several, or disagreeing contract values fails closed', () => {
  assert.throws(() => httpContract({ paths: {} }), /one Omnigraph-Http-Api value/);
  assert.throws(() => httpContract(spec(['0.14'], ['0.15'])), /one Omnigraph-Http-Api value/);
  assert.throws(() => httpContract(spec(['0.14', '0.15'])), /exactly one string value/);
  assert.throws(() => httpContract(spec([14])), /exactly one string value/);
});
