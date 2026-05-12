'use strict';
/**
 * parse_rr.js
 * Parses R&R.docx (rr_doc.xml) → rr_data.js
 * Run: node "Ciclo_5/Aventuras_secudarias/parse_rr.js"
 *
 * Structure: 10-chapter adventure, no separate numbered sections.
 * First 10 paragraphs are TOC — skipped.
 * Everything else goes into the α section, split by chapter markers in the HTML.
 */

const fs   = require('fs');
const path = require('path');

const XML_PATH = path.join(__dirname, 'rr_doc.xml');
const OUT_PATH = path.join(__dirname, 'rr_data.js');

let xml;
try { xml = fs.readFileSync(XML_PATH, 'utf8'); }
catch(e) { console.error('Cannot read XML:', e.message); process.exit(1); }
console.log(`Read ${xml.length.toLocaleString()} bytes`);

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

    const runText = segments.filter(s=>s.type==='text').map(s=>s.text).join('');
    if (segments.length >= 2 && segments[0].type === 'br' && /^\d{1,3}$/.test(runText.trim())) continue;

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
  /\bVe\s+\d+\b/i, /\bver\s+\d+\b/i,
  /^Diplomacy/i, /^Vanguard:/i, /^Protectorate:/i, /^Followers?:/i,
  /^Pierde\b/i, /^Obtén\b/i, /^Si tienes\b/i, /^Si no tienes\b/i,
  /^Si\s+[A-Z]/i, /^Elige:/i, /^Elige\b/i,
  /^Gana\b/i, /^Resta\b/i, /^Añade\b/i, /^Coloca\b/i,
  /^Retira\b/i, /^Elimina\b/i, /^Marca\b/i,
  /^Mata\b/i, /^Permite\b/i, /^Anota\b/i,
  /Diplomacia [+\-]/i, /Diplomacy [+\-]/i,
  /^Cuando termines/i, /^Cuando hayas/i,
  /Fase de Viaje/i,
  /^Investigaci\u00f3n \(/i,
];

function isGameNote(text) {
  for (const re of GAME_NOTE_PATTERNS) { if (re.test(text.trim())) return true; }
  return false;
}

function paraToHtml(para) {
  if (isHorizontalRule(para)) return null;
  const runs = extractRuns(para);
  const rawText = runs.map(r=>r.segments.map(s=>s.text||'').join('')).join('');
  if (runs.length === 0 || !rawText.trim()) return null;

  let html = runsToHtml(runs);
  if (!html.trim()) return null;

  return isGameNote(rawText.trim())
    ? `<p class="game-note">${html}</p>`
    : `<p class="narrative">${html}</p>`;
}

// ─── Parse ────────────────────────────────────────────────────────────────────
console.log('\n=== Parsing R&R ===');

const bodyStart = xml.indexOf('<w:body>');
if (bodyStart === -1) { console.error('No <w:body>'); process.exit(1); }
const bodyXml = xml.substring(bodyStart);

const paras = extractParagraphs(bodyXml);
console.log(`Found ${paras.length} paragraphs`);

// First paragraph is the TOC — skip it.
// Everything from [1] onwards goes into one α section.
const alpha = [];
for (let i = 1; i < paras.length; i++) {
  const para = paras[i];
  if (isHorizontalRule(para)) continue;
  const h = paraToHtml(para);
  if (h) alpha.push(h);
}

// ─── Build __menu__ ───────────────────────────────────────────────────────────
const sections = {
  '__menu__': [
    '<h1 class="doc-title">R&amp;R</h1>' +
    '<img class="menu-cover" src="Imagenes/R%26R.png" alt="R&amp;R">' +
    '<div class="menu-list">' +
    '<div class="menu-chapter" data-doc="rr" data-sec="α">' +
    '<span class="menu-ch-title">R&amp;R — Leer</span>' +
    '</div></div>'
  ],
  'α': alpha
};
const order = ['__menu__', 'α'];

console.log(`α section: ${alpha.length} paragraphs`);

// ─── Output ───────────────────────────────────────────────────────────────────
const DATA = {
  rr: {
    title: 'R&R',
    start: '__menu__',
    order,
    sections,
  }
};

const output = [
  `// RR_DATA — R&R`,
  `// Auto-generated by parse_rr.js on ${new Date().toISOString()}`,
  `// Sections: 1 (α with ${alpha.length} paragraphs)`,
  ``,
  `var RR_DATA = ${JSON.stringify(DATA, null, 2)};`,
  ``,
].join('\n');

fs.writeFileSync(OUT_PATH, output, 'utf8');
console.log(`Wrote ${output.length.toLocaleString()} bytes to ${OUT_PATH}`);

// Spot-check chapter starts
console.log('\n=== Spot-checks (chapter headers in α) ===');
const searches = [
  'Silla Vac\u00eda', 'La Suerte del Sorteo', 'Intestina',
  'El Juego de Todos', 'De la Ruina', 'Nada de Investigaciones',
  'M\u00e1quina Algo', 'Edo Einai', 'Peak-tophong', 'El Ni\u00f1o'
];
searches.forEach(s => {
  const idx = alpha.findIndex(p => p.replace(/<[^>]+>/g,'').indexOf(s) !== -1);
  console.log(`  "${s}" → index ${idx}`);
});
console.log('\nDone!');
