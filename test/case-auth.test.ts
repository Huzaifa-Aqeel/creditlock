import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allSourcesVisible } from '../src/backend/case-auth';

test('aggregated case access requires every linked source in the same project', () => {
  const ids = ['101', '102'];
  assert.equal(allSourcesVisible('55', ids, [{ id: '101', projectId: '55' }, { id: '102', projectId: '55' }]), true);
  assert.equal(allSourcesVisible('55', ids, [{ id: '101', projectId: '55' }, null]), false);
  assert.equal(allSourcesVisible('55', ids, [{ id: '101', projectId: '55' }, { id: '102', projectId: '56' }]), false);
  assert.equal(allSourcesVisible('55', ids, [{ id: '101', projectId: '55' }, { id: '999', projectId: '55' }]), false);
  assert.equal(allSourcesVisible('55', [], []), false);
});
