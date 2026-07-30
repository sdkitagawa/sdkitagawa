import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ASSETS = resolve(ROOT, 'assets');
const OUT = resolve(ASSETS, 'composites');

let readme = readFileSync(resolve(ROOT, 'README.md'), 'utf-8');
readme = readme.replace(/\r\n/g, '\n');

const sectionRegex = /## (.+?)\s*\n\n<table[^>]*>[\s\S]*?<\/table>/g;

const ICONS_PER_ROW = 20;

function cleanSvgContent(raw) {
  let content = raw.replace(/<\?xml[^>]*\?>/, '').trim();
  const m = content.match(/<svg[\s\S]*?(<\/svg>)/i);
  if (!m) return null;
  let inner = m[0];

  // For SVGs with embedded PNG and hidden vectors: strip the <image> and unhide vectors
  const hasPngOverlay = /<image[^>]*xlink:href="data:image\/png;base64[^>]*>/.test(inner);
  const hasDisplayNone = /display\s*:\s*none/.test(inner);

  if (hasPngOverlay && hasDisplayNone) {
    // Remove the <image> element with base64 PNG data
    inner = inner.replace(/<image[\s\S]*?xlink:href="data:image\/png;base64[^"]*"[\s\S]*?\/?>/g, '');
    // Change display:none to display:inline in <style> blocks
    inner = inner.replace(/display\s*:\s*none\s*;/g, 'display:inline;');
    // Also handle class-based display:none
    inner = inner.replace(/\.st\d+\s*\{\s*display\s*:\s*none\s*;\s*\}/g, '');
  }

  // Strip width/height from SVG tag (we set these on the wrapper)
  inner = inner.replace(/<svg[^>]*>/, (tag) => {
    return tag.replace(/\s*(width|height)="[^"]*"/g, '');
  });

  // Extract viewBox from the SVG tag
  const vbMatch = inner.match(/viewBox="([^"]+)"/);
  const viewBox = vbMatch ? vbMatch[1] : '0 0 256 256';

  return { content: inner, viewBox };
}

let match;
const replacements = [];

while ((match = sectionRegex.exec(readme)) !== null) {
  const sectionName = match[1].trim();
  const tableBlock = match[0];
  const slug = sectionName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const imgRegex = /<img\s+src="([^"]+)"\s+alt="([^"]+)"(?:\s+title="([^"]*)")?(?:\s+width="(\d+)")?(?:\s+height="(\d+)")?/g;
  const icons = [];
  let imgMatch;
  while ((imgMatch = imgRegex.exec(tableBlock)) !== null) {
    icons.push({
      src: imgMatch[1],
      alt: imgMatch[2],
      title: imgMatch[3] || imgMatch[2],
      width: parseInt(imgMatch[4], 10) || 48,
      height: parseInt(imgMatch[5], 10) || 50,
    });
  }

  if (icons.length === 0) continue;

  const slotW = Math.max(...icons.map(i => i.width)) + 2;
  const slotH = Math.max(...icons.map(i => i.height)) + 2;

  const rows = [];
  for (let i = 0; i < icons.length; i += ICONS_PER_ROW) {
    rows.push(icons.slice(i, i + ICONS_PER_ROW));
  }

  const totalWidth = rows[0].length * slotW;
  const totalHeight = rows.length * slotH;

  const svgParts = [];
  svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`);

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const icon = row[colIdx];
      const x = colIdx * slotW;
      const y = rowIdx * slotH;

      const absPath = resolve(dirname(resolve(ROOT, 'README.md')), icon.src);

      if (/\.png$/i.test(icon.src)) {
        const pngBuffer = readFileSync(absPath);
        const b64 = pngBuffer.toString('base64');
        svgParts.push(`  <image x="${x}" y="${y}" width="${icon.width}" height="${icon.height}" href="data:image/png;base64,${b64}" aria-label="${icon.alt}"/>`);
        continue;
      }

      const rawSvg = readFileSync(absPath, 'utf-8');
      const cleaned = cleanSvgContent(rawSvg);
      if (!cleaned) {
        console.warn(`  ⚠  Could not parse: ${absPath}`);
        continue;
      }

      const svgBuffer = Buffer.from(cleaned.content, 'utf-8');
      const b64 = svgBuffer.toString('base64');
      svgParts.push(`  <image x="${x}" y="${y}" width="${icon.width}" height="${icon.height}" href="data:image/svg+xml;base64,${b64}" aria-label="${icon.alt}"/>`);
    }
  }

  svgParts.push(`</svg>`);

  const composite = svgParts.join('\n');
  const outPath = resolve(OUT, `${slug}.svg`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, composite, 'utf-8');

  const sizeKB = (composite.length / 1024).toFixed(0);
  console.log(`  ✓ ${slug}.svg — ${icons.length} icons, ${sizeKB} KB`);

  const imgTag = `<img src="./assets/composites/${slug}.svg" alt="${sectionName}">`;
  replacements.push({ from: tableBlock, to: `## ${sectionName}  \n\n${imgTag}` });
}

let result = readme;
for (const { from, to } of replacements) {
  result = result.replace(from, to);
}

writeFileSync(resolve(ROOT, 'README.md'), result, 'utf-8');
console.log(`\nReplaced ${replacements.length} sections in README.md`);
