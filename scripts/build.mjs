// Development-only build; generated bundles have no Node.js/runtime dependencies.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { transform } from 'esbuild';

const root = new URL('../', import.meta.url);
await mkdir(new URL('dist/', root), { recursive: true });
const qrSource = await readFile(new URL('node_modules/jsqr/dist/jsQR.js', root), 'utf8');
const qrLicense = await readFile(new URL('node_modules/jsqr/LICENSE', root), 'utf8');
// Package the decoder as a local variable, without a module loader or global leak.
await writeFile(new URL('dist/jsqr.js', root), '/*! jsQR 1.4.0 — https://github.com/cozmo/jsQR\n' +
	qrLicense + '\n*/\nvar jsQR = (function () {\nvar module = { exports: {} }; var exports = module.exports;\n' +
	qrSource + '\nreturn module.exports;\n})();\n');
const sources = JSON.parse(await readFile(new URL('scripts/sources.json', root), 'utf8'));
const code = (await Promise.all(sources.map(file => readFile(new URL(file, root), 'utf8')))).join('\n')
	.replace(/\r\n/g, '\n').replace(/^[\t ]+/gm, indent => indent.replace(/\t/g, '    '))
	.replace(/[\t ]+$/gm, '');
const minified = await transform(code, { minify: true, target: 'es2017', legalComments: 'inline' });
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/displaysocket.js', root), code);
await writeFile(new URL('dist/displaysocket.min.js', root), minified.code);
console.log('Built browser bundles in dist/.');