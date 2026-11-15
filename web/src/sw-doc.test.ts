// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), 'utf8');
const sw = read('../public/sw.js');
const doc = read('../../docs/mapeo-ciclo-de-vida-sw.md');

// Solo los bloques marcados «js sw.js» son citas literales; el resto de los bloques del documento son ejemplos.
const quoted = [...doc.matchAll(/```js sw\.js\n([\s\S]*?)\n```/g)].map((match) => match[1]);

describe('docs/mapeo-ciclo-de-vida-sw.md', () => {
  it('cita las constantes y los cuatro listeners del SW', () => {
    const joined = quoted.join('\n');
    for (const fragment of [
      'const VERSION',
      "addEventListener('install'",
      "addEventListener('activate'",
      "addEventListener('message'",
      "addEventListener('fetch'",
    ])
      expect(joined).toContain(fragment);
  });

  it('copia el código tal cual está en public/sw.js', () => {
    for (const block of quoted) expect(sw).toContain(block);
  });
});
