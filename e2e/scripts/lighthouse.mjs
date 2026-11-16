// Auditorías de Lighthouse 11 (PRD §8, riesgo R1: Lighthouse 12 eliminó la categoría PWA) sobre una URL desplegada o local.
//   node scripts/lighthouse.mjs <url-base> [--label <nombre>] [--pages /,/reportes,/panel]
//        [--categories accessibility,performance,pwa] [--throttling mobile|slow3g]
// Por cada página guarda una captura del informe y, al final, un resumen JSON en docs/evidencia/lighthouse/<label>.json.
// El navegador es el Chromium de Playwright (hace falta ejecutarlo donde estén sus dependencias: ver README).
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const LIGHTHOUSE = 'lighthouse@11';
// «Perfil móvil con throttling 3G»: `mobile` es el que trae Lighthouse (4× CPU, 150 ms de RTT y 1.6 Mbps, el «Fast 3G» de
// DevTools); `slow3g` es el más duro de DevTools (400 ms de RTT y 400 Kbps).
const THROTTLING = {
  mobile: [
    '--throttling.rttMs=150',
    '--throttling.throughputKbps=1638.4',
    '--throttling.cpuSlowdownMultiplier=4',
  ],
  slow3g: [
    '--throttling.rttMs=400',
    '--throttling.throughputKbps=400',
    '--throttling.cpuSlowdownMultiplier=4',
  ],
};

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const base = args
  .find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'))
  ?.replace(/\/+$/, '');
if (!base) {
  console.error(
    'Uso: node scripts/lighthouse.mjs <url-base> [--label x] [--pages /,/reportes] [--categories accessibility,performance,pwa] [--throttling mobile|slow3g]',
  );
  process.exit(1);
}
const label = option('label', 'lighthouse');
const pages = option('pages', '/,/reportes,/panel').split(',');
const categories = option('categories', 'accessibility');
const throttling = option('throttling', 'mobile');
if (!THROTTLING[throttling])
  throw new Error(`--throttling debe ser mobile o slow3g, no «${throttling}»`);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'docs/evidencia/lighthouse');
mkdirSync(out, { recursive: true });
const work = mkdtempSync(path.join(tmpdir(), 'lighthouse-'));
const chrome = chromium.executablePath();

const summary = {
  lighthouse: null,
  label,
  base,
  date: new Date().toISOString(),
  formFactor: 'mobile',
  throttling: `${throttling} (${THROTTLING[throttling].join(' ')})`,
  pages: {},
};
const browser = await chromium.launch({ channel: 'chromium' });
try {
  for (const route of pages) {
    const name = route === '/' ? 'inicio' : route.replaceAll('/', '');
    const prefix = path.join(work, name);
    execFileSync(
      'npx',
      [
        '--yes',
        LIGHTHOUSE,
        `${base}${route}`,
        `--only-categories=${categories}`,
        '--form-factor=mobile',
        '--throttling-method=simulate',
        ...THROTTLING[throttling],
        '--chrome-flags=--headless=new --no-sandbox',
        '--output=json',
        '--output=html',
        `--output-path=${prefix}`,
        '--quiet',
      ],
      { env: { ...process.env, CHROME_PATH: chrome }, stdio: ['ignore', 'inherit', 'inherit'] },
    );
    const report = JSON.parse(readFileSync(`${prefix}.report.json`, 'utf8'));
    summary.lighthouse = report.lighthouseVersion;
    const scores = Object.fromEntries(
      Object.entries(report.categories).map(([id, category]) => [
        id,
        Math.round((category.score ?? 0) * 100),
      ]),
    );
    const metric = (id) => report.audits[id]?.numericValue;
    summary.pages[route] = {
      scores,
      metrics:
        scores.performance === undefined
          ? undefined
          : {
              fcpMs: Math.round(metric('first-contentful-paint') ?? NaN),
              lcpMs: Math.round(metric('largest-contentful-paint') ?? NaN),
              tbtMs: Math.round(metric('total-blocking-time') ?? NaN),
              cls: Number((metric('cumulative-layout-shift') ?? NaN).toFixed(3)),
              speedIndexMs: Math.round(metric('speed-index') ?? NaN),
            },
      // Lista de comprobaciones de la categoría PWA (checklist del reporte final): una por auditoría.
      pwaChecklist: report.categories.pwa?.auditRefs
        .filter((ref) => ref.weight > 0 || report.audits[ref.id].scoreDisplayMode === 'manual')
        .map((ref) => {
          const audit = report.audits[ref.id];
          return {
            id: ref.id,
            title: audit.title,
            result:
              audit.scoreDisplayMode === 'manual' ? 'manual' : audit.score === 1 ? 'pass' : 'fail',
          };
        }),
      // Oportunidades de mejora de rendimiento que Lighthouse todavía ve (ahorro estimado en ms).
      opportunities: Object.values(report.audits)
        .filter(
          (audit) =>
            audit.details?.type === 'opportunity' && (audit.details.overallSavingsMs ?? 0) > 0,
        )
        .map((audit) => ({
          id: audit.id,
          title: audit.title,
          savingsMs: Math.round(audit.details.overallSavingsMs),
        })),
      // Lo que no llegó a 1 (100 %): cada hallazgo con su título, para asignarlo en el informe.
      pending: Object.values(report.audits)
        .filter((audit) => audit.scoreDisplayMode === 'binary' && audit.score === 0)
        .map((audit) => ({ id: audit.id, title: audit.title })),
    };
    // Captura de la cabecera del informe (los puntajes) como evidencia.
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.goto(`file://${prefix}.report.html`);
    await page.screenshot({ path: path.join(out, `${label}-${name}.png`) });
    await page.close();
    const { metrics } = summary.pages[route];
    console.log(
      `${route}: ${JSON.stringify(scores)}${metrics ? ` · LCP ${metrics.lcpMs} ms` : ''}`,
    );
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
writeFileSync(path.join(out, `${label}.json`), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Resumen: docs/evidencia/lighthouse/${label}.json (Lighthouse ${summary.lighthouse})`);
