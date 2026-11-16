import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const STORAGE = ['localStorage', 'sessionStorage'];
const STORAGE_MESSAGE = 'RF-5: prohibido localStorage/sessionStorage; usa IndexedDB (idb).';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'docs/**',
      'md/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Aplica a web/ y api/ (y a cualquier otro código del repo).
    rules: {
      'no-restricted-globals': [
        'error',
        ...STORAGE.map((name) => ({ name, message: STORAGE_MESSAGE })),
      ],
      // shortcut: no detecta acceso dinámico (window['local' + 'Storage']); revisar en code review.
      'no-restricted-properties': [
        'error',
        ...['window', 'globalThis', 'self'].flatMap((object) =>
          STORAGE.map((property) => ({ object, property, message: STORAGE_MESSAGE })),
        ),
      ],
    },
  },
);
