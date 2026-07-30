import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ASSETS = resolve(ROOT, 'assets');
const OUT = resolve(ASSETS, 'composites');

let readme = readFileSync(resolve(ROOT, 'README.md'), 'utf-8');
readme = readme.replace(/\r\n/g, '\n');

const sectionRegex = /## (.+?)\s*\n\n<table[^>]*>[\s\S]*?<\/table>/g;

const ICONS_PER_ROW = 20;

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

  const isPng = (src) => /\.png$/i.test(src);
  const hasPng = icons.some(i => isPng(i.src));

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
      const relPath = relative(OUT, absPath).replace(/\\/g, '/');

      if (isPng(icon.src)) {
        const pngBuffer = readFileSync(absPath);
        const b64 = pngBuffer.toString('base64');
        const dataUri = `data:image/png;base64,${b64}`;
        svgParts.push(`  <image x="${x}" y="${y}" width="${icon.width}" height="${icon.height}" href="${dataUri}" aria-label="${icon.alt}"/>`);
        continue;
      }

      svgParts.push(`  <image x="${x}" y="${y}" width="${icon.width}" height="${icon.height}" href="${relPath}" aria-label="${icon.alt}"/>`);
    }
  }

  svgParts.push(`</svg>`);

  const composite = svgParts.join('\n');
  const outPath = resolve(OUT, `${slug}.svg`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, composite, 'utf-8');
  console.log(`  ✓ ${slug}.svg — ${icons.length} icons${hasPng ? ' (PNGs base64-embedded)' : ''}`);
  console.log(`      ${(composite.length / 1024).toFixed(0)} KB`);

  const imgTag = `<img src="./assets/composites/${slug}.svg" alt="${sectionName}">`;
  replacements.push({ from: tableBlock, to: `## ${sectionName}  \n\n${imgTag}` });
}

let result = readme;
for (const { from, to } of replacements) {
  result = result.replace(from, to);
}

writeFileSync(resolve(ROOT, 'README.md'), result, 'utf-8');
console.log(`\nReplaced ${replacements.length} sections in README.md`);
