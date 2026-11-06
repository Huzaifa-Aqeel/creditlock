import test from 'node:test';
import assert from 'node:assert/strict';
import { builtInPolicy, validStoredPolicy, validateDefinition, type PolicyRecord } from '../src/backend/policy-registry';
import { createHash } from 'node:crypto';

test('built-in terms have source locations and a valid content hash', () => {
  const definition = builtInPolicy('100');
  assert.equal(validateDefinition(definition).length, 0);
  const record: PolicyRecord = { definition, status: 'ACTIVE', lastEventId: 'event' };
  assert.equal(validStoredPolicy(record), true);
  assert.equal(validStoredPolicy({ ...record, definition: { ...definition, effectiveFrom: '2026-01-01' } }), false);
});

test('previous registry template remains readable after the structured schema upgrade', () => {
  const modern = builtInPolicy('100');
  const { terms: _terms, definitionHash: _hash, ...base } = modern;
  const legacy = { ...base, source: { ...base.source, clauses: ['Jira Service Management Premium uptime commitment', 'Monthly uptime and service credit tiers', 'Claim procedure and exclusions'] } };
  const definition = { ...legacy, definitionHash: createHash('sha256').update(JSON.stringify(legacy)).digest('hex') };
  assert.equal(validStoredPolicy({ definition, status: 'ACTIVE', lastEventId: 'old' }), true);
});

test('supported policy requires exact terms, source version, and six clause locations', () => {
  const definition = builtInPolicy('100');
  assert.match(validateDefinition({ ...definition, terms: undefined })[0], /tested Atlassian/);
  assert.ok(validateDefinition({ ...definition, source: { ...definition.source, clauses: ['Appendix A'] } }).some(error => /references/.test(error)));
  assert.ok(validateDefinition({ ...definition, source: { ...definition.source, kind: 'CUSTOMER_DOCUMENT', contentHash: 'abc' } }).some(error => /SHA-256/.test(error)));
  assert.ok(validateDefinition({ ...definition, source: { ...definition.source, reference: 'https://example.com/sla' } }).some(error => /Atlassian official/.test(error)));
});
