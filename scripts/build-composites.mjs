import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import sharp from 'sharp';

function resolveReadmePath() {
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf('--readme');
  if (flagIdx !== -1 && flagIdx + 1 < args.length)
    return resolve(process.cwd(), args[flagIdx + 1]);
  for (const a of args) {
    if (a.startsWith('--readme='))
      return resolve(process.cwd(), a.slice('--readme='.length));
    if (!a.startsWith('--'))
      return resolve(process.cwd(), a);
  }
  return null;
}

let readmePath = resolveReadmePath();

if (!readmePath) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  readmePath = await new Promise(resolve => {
    rl.question('README file path (default: ./README.md): ', answer => {
      rl.close();
      resolve(answer.trim() || './README.md');
    });
  });
  readmePath = resolve(process.cwd(), readmePath);
}

const ROOT = dirname(readmePath);
const ASSETS = resolve(ROOT, 'assets');
const OUT = resolve(ASSETS, 'composites');

let readme = readFileSync(readmePath, 'utf-8');
readme = readme.replace(/\r\n/g, '\n');

const sectionRegex = /## (.+?)\s*\n\n<div>\s*\n\s*<picture>\s*\n([\s\S]*?)\n\s*<\/picture>\s*\n\s*<\/div>/g;

const ICONS_PER_ROW = 20;
const HSPACE = 2;
const VSPACE = 2;

async function main() {
  let match;
  const replacements = [];

  while ((match = sectionRegex.exec(readme)) !== null) {
    const sectionName = match[1].trim();
    const pictureBlock = match[0];
    const imgContent = match[2];

    const slug = sectionName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const imgRegex = /<img\s+src="([^"]+)"\s+alt="([^"]+)"(?:\s+title="([^"]*)")?(?:\s+width="(\d+)")?(?:\s+height="(\d+)")?(?:\s+hspace="(\d+)")?/g;
    const icons = [];
    let imgMatch;
    while ((imgMatch = imgRegex.exec(imgContent)) !== null) {
      icons.push({
        src: imgMatch[1],
        alt: imgMatch[2],
        title: imgMatch[3] || imgMatch[2],
        width: parseInt(imgMatch[4], 10) || 48,
        height: parseInt(imgMatch[5], 10) || 50,
        hspace: parseInt(imgMatch[6], 10) || HSPACE,
      });
    }

    if (icons.length === 0) continue;

    const maxW = Math.max(...icons.map(i => i.width));
    const maxH = Math.max(...icons.map(i => i.height));
    const slotW = maxW + 2 * HSPACE;
    const slotH = maxH + VSPACE;

    const rows = [];
    for (let i = 0; i < icons.length; i += ICONS_PER_ROW) {
      rows.push(icons.slice(i, i + ICONS_PER_ROW));
    }

    const totalWidth = rows[0].length * slotW;
    const totalHeight = rows.length * slotH;

    console.log(`  Processing ${slug} (${icons.length} icons, ${totalWidth}x${totalHeight})...`);

    const overlays = [];

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];
      for (let colIdx = 0; colIdx < row.length; colIdx++) {
        const icon = row[colIdx];
        const x = colIdx * slotW + Math.round((slotW - icon.width) / 2);
        const y = rowIdx * slotH + Math.round((slotH - icon.height) / 2);

        const absPath = resolve(ROOT, icon.src);

        let input;
        if (/\.png$/i.test(icon.src)) {
          const pngBuffer = readFileSync(absPath);
          input = await sharp(pngBuffer)
            .resize(icon.width, icon.height)
            .png()
            .toBuffer();
        } else {
          const svgString = readFileSync(absPath, 'utf-8');
          const cleaned = cleanSvgForRendering(svgString);
          if (!cleaned) {
            console.warn(`  \u26a0  Could not parse: ${absPath}`);
            continue;
          }
          input = await sharp(Buffer.from(cleaned))
            .resize(icon.width, icon.height)
            .png()
            .toBuffer();
        }

        overlays.push({ input, left: x, top: y });
      }
    }

    const compositeBuffer = await sharp({
      create: {
        width: totalWidth,
        height: totalHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(overlays)
      .png()
      .toBuffer();

    const outPath = resolve(OUT, `${slug}.png`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, compositeBuffer);

    const sizeKB = (compositeBuffer.length / 1024).toFixed(0);
    console.log(`  \u2713 ${slug}.png \u2014 ${icons.length} icons, ${sizeKB} KB`);

    const imgTag = `<img src="./assets/composites/${slug}.png" alt="${sectionName}">`;
    replacements.push({ from: pictureBlock, to: `## ${sectionName}  \n\n${imgTag}` });
  }

  let result = readme;
  for (const { from, to } of replacements) {
    result = result.replace(from, to);
  }

  writeFileSync(readmePath, result, 'utf-8');
  console.log(`\nReplaced ${replacements.length} sections in README.md`);
}

function cleanSvgForRendering(raw) {
  let content = raw.replace(/<\?xml[^>]*\?>/, '').trim();
  const m = content.match(/<svg[\s\S]*?(<\/svg>)/i);
  if (!m) return null;
  let inner = m[0];

  // Strip width/height from SVG tag; sharp can infer from viewBox + resize
  inner = inner.replace(/<svg[^>]*>/, (tag) => {
    return tag.replace(/\s*(width|height)="[^"]*"/g, '');
  });

  return inner;
}

await main();
