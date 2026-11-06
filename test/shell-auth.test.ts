import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizedAccount, contextProjectId, idFrom } from '../src/backend/shell-auth.ts';

test('Jira IDs must be decimal strings, not paths or arbitrary values', () => {
  assert.equal(idFrom('12345'), '12345');
  for (const value of ['../12345', '123?fields=*', '', 12345, null]) assert.equal(idFrom(value), null);
});

test('project context must contain an explicit Jira project ID', () => {
  assert.equal(contextProjectId({ project: { id: '10001' } }), '10001');
  assert.equal(contextProjectId({ project: { id: '../10001' } }), null);
  assert.equal(contextProjectId({}), null);
});

test('only an authenticated licensed account passes the shell identity guard', () => {
  assert.equal(authorizedAccount({ accountId: 'abc', accountType: 'licensed' }), 'abc');
  assert.equal(authorizedAccount({ accountId: 'abc', accountType: 'customer' }), null);
  assert.equal(authorizedAccount({ accountId: 'abc', accountType: 'anonymous' }), null);
  assert.equal(authorizedAccount({ accountType: 'licensed' }), null);
});
