import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: path.join(import.meta.dirname, '..') });

async function ruleIds(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((message) => message.ruleId);
}

for (const filePath of ['web/src/example.ts', 'api/src/example.ts']) {
  for (const store of ['localStorage', 'sessionStorage']) {
    test(`${filePath}: ${store} falla con no-restricted-globals`, async () => {
      const ids = await ruleIds(`${store}.setItem('k', 'v');\n`, filePath);
      assert.deepEqual(ids, ['no-restricted-globals']);
    });

    for (const owner of ['window', 'globalThis', 'self']) {
      test(`${filePath}: ${owner}.${store} falla con no-restricted-properties`, async () => {
        const ids = await ruleIds(`${owner}.${store}.getItem('k');\n`, filePath);
        assert.ok(ids.includes('no-restricted-properties'), `reglas: ${ids}`);
      });
    }
  }
}

test('código sin almacenamiento web pasa limpio', async () => {
  const ids = await ruleIds('export const total: number = 1 + 1;\n', 'web/src/example.ts');
  assert.deepEqual(ids, []);
});

test('IndexedDB no se confunde con el almacenamiento prohibido', async () => {
  const ids = await ruleIds(
    "export const open = () => indexedDB.open('civicguard');\n",
    'web/src/db.ts',
  );
  assert.deepEqual(ids, []);
});
