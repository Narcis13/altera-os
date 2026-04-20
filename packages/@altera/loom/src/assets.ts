import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VENDOR_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'vendor',
);
const CSS_PATH = resolve(VENDOR_ROOT, 'loom.bundle.css');
const JS_PATH = resolve(VENDOR_ROOT, 'loom-core.js');

let cssCache: string | null = null;
let jsCache: string | null = null;

export function getLoomCss(): string {
  if (cssCache === null) cssCache = readFileSync(CSS_PATH, 'utf-8');
  return cssCache;
}

export function getLoomJs(): string {
  if (jsCache === null) jsCache = readFileSync(JS_PATH, 'utf-8');
  return jsCache;
}

export function embedLoomCss(): string {
  return `<style>\n${getLoomCss()}\n</style>`;
}

export function embedLoomJs(): string {
  const safe = getLoomJs().replace(/<\/script>/gi, '<\\/script>');
  return `<script>\n${safe}\n</script>`;
}
