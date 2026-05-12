'use strict';
/**
 * parse_sots.js
 * Parses "Sermon On The Shoal.docx" (sots_doc.xml) → sots_data.js
 * Run: node "Ciclo_5/Aventuras_secudarias/parse_sots.js"
 *
 * Structure: 10 standalone sermon entries numbered 1–10.
 * Each entry becomes a section named with a Greek letter (α–κ).
 * Number headers are stripped and replaced with the Greek letter as title.
 */

const fs   = require('fs');
const path = require('path');

const XML_PATH = path.join(__dirname, 'sots_doc.xml');
const OUT_PATH = path.join(__dirname, 'sots_data.js');

let xml;
try { xml = fs.readFileSync(XML_PATH, 'utf8'); }
catch(e) { console.error('Cannot read XML:', e.message); process.exit(1); }
console.log(`Read ${xml.length.toLocaleString()} bytes`);

// Greek letter mapping: 1→α, 2→β, ..., 10→κ
const GREEK = ['α','β','γ','δ','ε','ζ','η','θ','ι','κ'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function decodeXmlEntities(s) {
  return s
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&apos;/g,"'")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(parseInt(n,10)))
    .replace(/&#x([0-9a-fA-F]+);/g,(_,h)=>String.fromCharCode(parseInt(h,16)));
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function extractParagraphs(xmlFrag) {
  const result = [];
  let pos = 0;
  while (true) {
    const a = xmlFrag.indexOf('<w:p ', pos);
    const b = xmlFrag.indexOf('<w:p>', pos);
    if (a === -1 && b === -1) break;
    let s = (a === -1) ? b : (b === -1) ? a : Math.min(a,b);
    const e = xmlFrag.indexOf('</w:p>', s);
    if (e === -1) break;
    result.push(xmlFrag.substring(s, e + 6));
    pos = e + 6;
  }
  return result;
}

function paragraphPlainText(para) {
  const texts = [];
  const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(para)) !== null) texts.push(m[1]);
  return texts.join('').trim();
}

function isHorizontalRule(para) {
  return para.includes('o:hr="t"') || (para.includes('<w:pict') && !para.includes('<w:t'));
}

function extractRuns(para) {
  const cleaned = para.replace(/<w:lastRenderedPageBreak\/>/g,'');
  const runs = [];
  const runRE = /<w:r[ >][\s\S]*?<\/w:r>/g;
  let m;
  while ((m = runRE.exec(cleaned)) !== null) {
    const rs = m[0];
    const bold      = /<w:b\/>/.test(rs) || /<w:b\s/.test(rs);
    const italic    = /<w:i\/>/.test(rs) || /<w:i\s/.test(rs);
    const atoFont   = /rFonts[^>]*ATO icons/.test(rs);
    const atoSymbol = /rFonts[^>]*ATOSymbol/.test(rs);

    const segments = [];
    const innerRE = /<w:br[^/]*\/>|<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let im;
    while ((im = innerRE.exec(rs)) !== null) {
      if (im[0].startsWith('<w:br')) segments.push({ type:'br' });
      else segments.push({ type:'text', text: im[1] || '' });
    }
    if (segments.length === 0) continue;
    runs.push({ bold, italic, atoFont, atoSymbol, segments });
  }
  return runs;
}

function joinBrSegments(segments) {
  const parts = [];
  for (const seg of segments) {
    if (seg.type === 'br') {
      const prev = parts.length > 0 ? parts[parts.length-1] : '';
      if (prev && prev[prev.length-1] !== ' ') parts.push(' ');
    } else {
      parts.push(decodeXmlEntities(seg.text || ''));
    }
  }
  return parts.join('');
}

function runsToHtml(runs) {
  let html = '';
  for (const run of runs) {
    let text = joinBrSegments(run.segments).replace(/ {2,}/g,' ');
    if (!text.trim()) continue;
    if (html && html[html.length-1] !== ' ' && text[0] !== ' ') html += ' ';
    if (run.atoFont)   { html += `<span class="ato-icon">${escHtml(text)}</span>`; continue; }
    if (run.atoSymbol) { html += `<span class="ato-symbol">${escHtml(text)}</span>`; continue; }
    if (run.bold && run.italic) html += `<strong><em>${escHtml(text)}</em></strong>`;
    else if (run.bold)          html += `<strong>${escHtml(text)}</strong>`;
    else if (run.italic)        html += `<em>${escHtml(text)}</em>`;
    else                        html += escHtml(text);
  }
  return html;
}

const GAME_NOTE_PATTERNS = [
  /^Un\s+(único|Argonauta|único Argonauta)\b/i,
  /^Gana\b/i, /^Resta\b/i, /^Pierde\b/i, /^Obtén\b/i,
  /^Elige:/i, /^Elige\b/i, /^Puedes\b/i,
  /^Añade\b/i, /^Coloca\b/i, /^Retira\b/i, /^Marca\b/i,
  /fichas de Dolor/i, /carta de Condici/i, /Simulaci\u00f3n de Batalla/i,
  /Disyunci\u00f3n/i, /Fase de Viaje/i,
];

function isGameNote(text) {
  for (const re of GAME_NOTE_PATTERNS) { if (re.test(text.trim())) return true; }
  return false;
}

function paraToHtml(para) {
  if (isHorizontalRule(para)) return null;
  const runs = extractRuns(para);
  const rawText = runs.map(r=>r.segments.map(s=>s.text||'').join('')).join('');
  if (!rawText.trim()) return null;
  let html = runsToHtml(runs);
  if (!html.trim()) return null;
  return isGameNote(rawText.trim())
    ? `<p class="game-note">${html}</p>`
    : `<p class="narrative">${html}</p>`;
}

// ─── Detect entry header: "N Title" or "N  Title" ─────────────────────────────
function detectEntryHeader(para) {
  const plain = paragraphPlainText(para);
  const m = /^(\d{1,2})\s+(.+)$/.exec(plain);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  if (num < 1 || num > 10) return null;
  return { num, title: m[2].trim() };
}

// ─── Parse ────────────────────────────────────────────────────────────────────
console.log('\n=== Parsing Sermon On The Shoal ===');

const bodyStart = xml.indexOf('<w:body>');
if (bodyStart === -1) { console.error('No <w:body>'); process.exit(1); }
const bodyXml = xml.substring(bodyStart);

const paras = extractParagraphs(bodyXml);
console.log(`Found ${paras.length} paragraphs`);

const sections = {};
const order = [];
// Titles keyed by Greek letter, for menu
const titles = {};
let current = null;

for (let i = 0; i < paras.length; i++) {
  const para = paras[i];
  if (isHorizontalRule(para)) continue;

  const entry = detectEntryHeader(para);
  if (entry) {
    const greek = GREEK[entry.num - 1];
    current = greek;
    sections[greek] = [];
    order.push(greek);
    titles[greek] = entry.title;
    // First paragraph is the title, rendered as a narrative header
    sections[greek].push(`<p class="narrative drop-cap"><strong>${escHtml(greek)} \u2014 ${escHtml(entry.title)}</strong></p>`);
    continue;
  }

  if (current === null) continue;
  const h = paraToHtml(para);
  if (h) sections[current].push(h);
}

console.log(`Parsed ${order.length} sections:`, order.join(', '));

// ─── Build __menu__ ───────────────────────────────────────────────────────────
const menuEntries = order.map(g => {
  const num = GREEK.indexOf(g) + 1;
  return `<div class="menu-chapter" data-doc="sots" data-sec="${g}">` +
         `<span class="menu-ch-title">${escHtml(g)} \u2014 ${escHtml(titles[g])}</span>` +
         `</div>`;
}).join('');

sections['__menu__'] = [
  '<h1 class="doc-title">Sermon On The Shoal</h1>' +
  '<img class="menu-cover" src="Imagenes/Sermon%20On%20The%20Shoals.png" alt="Sermón en los Bajíos">' +
  '<div class="menu-list">' + menuEntries + '</div>'
];

// ─── Output ───────────────────────────────────────────────────────────────────
const DATA = {
  sots: {
    title: 'Sermon On The Shoal',
    start: '__menu__',
    order: ['__menu__', ...order],
    sections,
  }
};

const output = [
  `// SOTS_DATA — Sermon On The Shoal`,
  `// Auto-generated by parse_sots.js on ${new Date().toISOString()}`,
  `// Sections: ${order.length} (${order.join(', ')})`,
  ``,
  `var SOTS_DATA = ${JSON.stringify(DATA, null, 2)};`,
  ``,
].join('\n');

fs.writeFileSync(OUT_PATH, output, 'utf8');
console.log(`Wrote ${output.length.toLocaleString()} bytes to ${OUT_PATH}`);

console.log('\n=== Spot-checks ===');
order.forEach(g => {
  const p = sections[g];
  const preview = (p[0]||'').replace(/<[^>]+>/g,'').substring(0,60);
  console.log(`[${g}] ${p.length} paras — "${preview}"`);
});
console.log('\nDone!');
