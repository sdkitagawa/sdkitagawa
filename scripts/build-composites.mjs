import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve, relative, sep, basename } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import sharp from 'sharp';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');

const DEFAULT_ICONS_PER_ROW = 20;
const HSPACE = 2;
const VSPACE = 2;

function parseArgs(argv) {
  const o = { input: null, out: null, root: null, composites: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const flag = eq === -1 ? a : a.slice(0, eq);
    const inline = eq === -1 ? null : a.slice(eq + 1);
    const value = () => (inline !== null ? inline : argv[++i]);

    switch (flag) {
      case '--readme':
      case '--from':
      case '--input':
        o.input = value();
        break;
      case '--out':
        o.out = value();
        break;
      case '--root':
        o.root = value();
        break;
      case '--composites':
        o.composites = value();
        break;
      default:
        if (!a.startsWith('--')) o.input ??= a;
    }
  }
  return o;
}

function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function toPosix(p) {
  return p.split(sep).join('/');
}

const args = parseArgs(process.argv.slice(2));

let manifestPath = args.input ? resolve(process.cwd(), args.input) : null;

if (!manifestPath) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => {
    rl.question('README file path (default: ./README.md): ', (a) => {
      rl.close();
      r(a.trim());
    });
  });
  manifestPath = resolve(process.cwd(), answer || './README.md');
}

const ROOT = args.root ? resolve(process.cwd(), args.root) : DEFAULT_ROOT;
const COMPOSITES_DIR = args.composites
  ? resolve(process.cwd(), args.composites)
  : resolve(ROOT, 'assets', 'composites');

const manifestRaw = readFileSync(manifestPath, 'utf-8');
const inputEol = detectEol(manifestRaw);
const readme = manifestRaw.replace(/\r\n/g, '\n');

const outPath = args.out
  ? resolve(process.cwd(), args.out)
  : manifestPath.replace(/(\.[^.]+)$/, '.built$1');

const outDir = dirname(outPath);
let compositesRel = relative(outDir, COMPOSITES_DIR);
if (!compositesRel) compositesRel = '.';
else if (!compositesRel.startsWith('.')) compositesRel = `./${compositesRel}`;
compositesRel = toPosix(compositesRel);

const manifestDir = dirname(manifestPath);

function resolveAsset(src) {
  const fromRoot = resolve(ROOT, src);
  if (existsSync(fromRoot)) return fromRoot;
  const fromManifest = resolve(manifestDir, src);
  if (existsSync(fromManifest)) return fromManifest;
  return fromRoot;
}

const sectionRegex =
  /## (.+?)\s*\n\n<div>\s*\n\s*<picture>\s*\n([\s\S]*?)\n\s*<\/picture>\s*\n\s*<\/div>/g;

const imgRegex =
  /<img\s+src="([^"]+)"\s+alt="([^"]+)"(?:\s+title="([^"]*)")?(?:\s+width="(\d+)")?(?:\s+height="(\d+)")?(?:\s+hspace="(\d+)")?/g;

const gridRegex = /<!--\s*grid:\s*(\d+)\s*-->/;

function cleanSvgForRendering(raw) {
  let content = raw.replace(/<\?xml[^>]*\?>/, '').trim();
  const m = content.match(/<svg[\s\S]*?(<\/svg>)/i);
  if (!m) return null;
  let inner = m[0];
  inner = inner.replace(/<svg[^>]*>/, (tag) => tag.replace(/\s*(width|height)="[^"]*"/g, ''));
  return inner;
}

const replacements = [];
let built = 0;
let match;

while ((match = sectionRegex.exec(readme)) !== null) {
  const sectionName = match[1].trim();
  const pictureBlock = match[0];
  const inner = match[2];

  const slug = sectionName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const gridMatch = inner.match(gridRegex);
  const perRow = gridMatch
    ? Math.max(1, parseInt(gridMatch[1], 10))
    : DEFAULT_ICONS_PER_ROW;

  const icons = [];
  let imgMatch;
  while ((imgMatch = imgRegex.exec(inner)) !== null) {
    icons.push({
      src: imgMatch[1],
      width: parseInt(imgMatch[4], 10) || 48,
      height: parseInt(imgMatch[5], 10) || 50,
    });
  }

  if (icons.length === 0) continue;

  const maxW = Math.max(...icons.map((i) => i.width));
  const maxH = Math.max(...icons.map((i) => i.height));
  const slotW = maxW + 2 * HSPACE;
  const slotH = maxH + VSPACE;

  const rows = [];
  for (let i = 0; i < icons.length; i += perRow) {
    rows.push(icons.slice(i, i + perRow));
  }

  const totalWidth = Math.max(...rows.map((r) => r.length)) * slotW;
  const totalHeight = rows.length * slotH;

  const overrides = [];
  if (perRow !== DEFAULT_ICONS_PER_ROW) overrides.push(`grid:${perRow}`);
  console.log(
    `  ${slug} — ${icons.length} icons, ${rows.length}x${rows[0].length} grid, ${totalWidth}x${totalHeight}${overrides.length ? ` (${overrides.join(', ')})` : ''}`
  );

  const overlays = [];

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const icon = row[colIdx];
      const x = colIdx * slotW + Math.round((slotW - icon.width) / 2);
      const y = rowIdx * slotH + Math.round((slotH - icon.height) / 2);

      const absPath = resolveAsset(icon.src);
      if (!existsSync(absPath)) {
        console.warn(`  ! missing: ${icon.src}`);
        continue;
      }

      let input;
      if (/\.png$/i.test(icon.src)) {
        input = await sharp(readFileSync(absPath))
          .resize(icon.width, icon.height)
          .png()
          .toBuffer();
      } else {
        const cleaned = cleanSvgForRendering(readFileSync(absPath, 'utf-8'));
        if (!cleaned) {
          console.warn(`  ! unparseable svg: ${icon.src}`);
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

  const composite = await sharp({
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

  mkdirSync(COMPOSITES_DIR, { recursive: true });
  writeFileSync(resolve(COMPOSITES_DIR, `${slug}.png`), composite);
  built++;

  const imgTag = `![${sectionName}](${compositesRel}/${slug}.png)`;
  replacements.push({ from: pictureBlock, to: `## ${sectionName}  \n\n${imgTag}` });
}

let result = readme;
for (const { from, to } of replacements) {
  result = result.replace(from, to);
}

const outEol = existsSync(outPath) ? detectEol(readFileSync(outPath, 'utf-8')) : inputEol;
const finalText = outEol === '\r\n' ? result.replace(/\n/g, '\r\n') : result;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, finalText, 'utf-8');

console.log(`\nComposites: ${built} -> ${toPosix(relative(process.cwd(), COMPOSITES_DIR)) || '.'}`);
console.log(`Markdown:   ${replacements.length} sections -> ${toPosix(relative(process.cwd(), outPath)) || basename(outPath)} (${outEol === '\r\n' ? 'CRLF' : 'LF'})`);
console.log(`Manifest:   ${toPosix(relative(process.cwd(), manifestPath))} left untouched`);
