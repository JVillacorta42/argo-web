'use strict';
/**
 * parse_mnemos.js
 * Parses MNEMOS.docx (mnemos_doc.xml) → mnemos_data.js
 * Run: node "Ciclo_5/Aventuras_secudarias/parse_mnemos.js"
 *
 * Structure: 8 memory groups, each with 3 sections:
 *   M00X = sueño, M01X = recuerdo, M02X = verdad
 * The __menu__ section is built with images from Imagenes/ folder.
 */

const fs   = require('fs');
const path = require('path');

const XML_PATH = path.join(__dirname, 'mnemos_doc.xml');
const OUT_PATH = path.join(__dirname, 'mnemos_data.js');

let xml;
try { xml = fs.readFileSync(XML_PATH, 'utf8'); }
catch(e) { console.error('Cannot read XML:', e.message); process.exit(1); }
console.log(`Read ${xml.length.toLocaleString()} bytes`);

// ─── Group definitions (document order) ──────────────────────────────────────
const GROUPS = [
  { name: 'Shelter',          img: 'Imagenes/Sheelter.png',                ids: ['m003','m013','m023'] },
  { name: 'Último Cruzado',   img: 'Imagenes/last%20Crusader.png',         ids: ['m002','m012','m022'] },
  { name: 'Dogma',            img: 'Imagenes/Dogma.png',                   ids: ['m004','m014','m024'] },
  { name: 'Punto de Fuga',    img: 'Imagenes/Vanishing%20point.png',       ids: ['m005','m015','m025'] },
  { name: 'Palabras y Hechos',img: 'Imagenes/words%20and%20Deeds.png',     ids: ['m001','m011','m021'] },
  { name: 'A Tu Imagen',      img: 'Imagenes/In%20Your%20Image.png',       ids: ['m006','m016','m026'] },
  { name: 'Crepúsculo',       img: 'Imagenes/Twiglight.png',               ids: ['m007','m017','m027'] },
  { name: 'Él Dijo la Verdad',img: 'Imagenes/He%20Spoke%20Truth.png',      ids: ['m008','m018','m028'] },
];

const GROUP_NAMES = new Set(GROUPS.map(g => g.name));

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
  /^Gana\b/i, /^Resta\b/i, /^Pierde\b/i, /^Obtén\b/i,
  /^Elige:/i, /^Elige\b/i, /^Puedes\b/i,
  /^Añade\b/i, /^Coloca\b/i, /^Retira\b/i, /^Marca\b/i,
  /^Anota\b/i, /^Elimina\b/i, /^Mata\b/i, /^Permite\b/i,
  /fichas de Dolor/i, /fichas de Éter/i, /fichas de Desesperación/i,
  /carta de Condici/i, /Registro de Mnemos/i,
  /Simulaci\u00f3n de Batalla/i, /Disyunci\u00f3n/i, /Fase de Viaje/i,
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

// Detect section marker: M followed by 3 digits at start of paragraph
// e.g. "M003El sueño..." or "M003" standalone
function detectSectionMarker(plain) {
  const m = /^(M0\d{2})([\s\S]*)$/.exec(plain);
  if (!m) return null;
  return { id: m[1].toLowerCase(), rest: m[2].trim() };
}

// Strip the M-code prefix from the first text run of a paragraph
function stripMCodePrefix(runs, code) {
  let stripped = false;
  return runs.map(run => {
    if (stripped) return run;
    const newSegs = run.segments.map(seg => {
      if (!stripped && seg.type === 'text' && seg.text.replace(/\s/g,'').toUpperCase().startsWith(code.toUpperCase())) {
        stripped = true;
        return { ...seg, text: seg.text.replace(new RegExp('^\\s*' + code + '\\s*', 'i'), '') };
      }
      return seg;
    });
    return { ...run, segments: newSegs };
  });
}

// ─── Parse ────────────────────────────────────────────────────────────────────
console.log('\n=== Parsing MNEMOS ===');

const bodyStart = xml.indexOf('<w:body>');
if (bodyStart === -1) { console.error('No <w:body>'); process.exit(1); }
const bodyXml = xml.substring(bodyStart);

const paras = extractParagraphs(bodyXml);
console.log(`Found ${paras.length} paragraphs`);

const sections = {};
const order = [];
let current = null;

for (let i = 0; i < paras.length; i++) {
  const para = paras[i];
  if (isHorizontalRule(para)) continue;

  const plain = paragraphPlainText(para);
  if (!plain) continue;

  // Skip group title paragraphs (e.g., "Shelter", "Último Cruzado", ...)
  if (GROUP_NAMES.has(plain)) continue;

  // Skip page number artifacts (standalone small numbers)
  if (/^[\d\s]+$/.test(plain) && plain.length < 5) continue;

  // Detect section marker
  const sec = detectSectionMarker(plain);
  if (sec) {
    current = sec.id;
    if (!sections[current]) { sections[current] = []; order.push(current); }
    // If there's text after the code on the same paragraph, include it
    if (sec.rest) {
      const runs = stripMCodePrefix(extractRuns(para), sec.id.toUpperCase());
      const rawText = runs.map(r=>r.segments.map(s=>s.text||'').join('')).join('').trim();
      if (rawText) {
        let html = runsToHtml(runs);
        if (html.trim()) {
          sections[current].push(isGameNote(rawText)
            ? `<p class="game-note">${html}</p>`
            : `<p class="narrative">${html}</p>`);
        }
      }
    }
    continue;
  }

  if (current === null) continue;
  const h = paraToHtml(para);
  if (h) sections[current].push(h);
}

console.log(`Parsed ${order.length} sections:`, order.join(', '));

// ─── Build __menu__ ───────────────────────────────────────────────────────────
function sectionLabel(id) {
  const code = id.toUpperCase(); // e.g. M003
  const n = parseInt(id.slice(2), 10); // e.g. 3
  const prefix = parseInt(id[1], 10); // 0, 1, or 2
  if (prefix === 0) return `${code} — El sueño`;
  if (prefix === 1) return `${code} — El recuerdo`;
  return `${code} — La verdad`;
}

const menuChapters = GROUPS.map(g => {
  const subEntries = g.ids.map(id => {
    return `<div class="menu-sub" data-doc="mnemos" data-sec="${id}">${escHtml(sectionLabel(id))}</div>`;
  }).join('');
  return (
    `<div class="menu-chapter memory-group" data-doc="mnemos" data-sec="${g.ids[0]}">` +
    `<img class="memory-thumb" src="${g.img}" alt="${escHtml(g.name)}">` +
    `<div class="menu-sub-list">${subEntries}</div>` +
    `</div>`
  );
}).join('');

sections['__menu__'] = [
  '<h1 class="doc-title">MNEMOS</h1>' +
  '<div class="menu-list memory-menu">' + menuChapters + '</div>'
];

// ─── Output ───────────────────────────────────────────────────────────────────
const allOrder = ['__menu__', ...order];

const DATA = {
  mnemos: {
    title: 'MNEMOS',
    start: '__menu__',
    order: allOrder,
    sections,
  }
};

const output = [
  `// MNEMOS_DATA — MNEMOS`,
  `// Auto-generated by parse_mnemos.js on ${new Date().toISOString()}`,
  `// Sections: ${order.length} (${order.join(', ')})`,
  ``,
  `var MNEMOS_DATA = ${JSON.stringify(DATA, null, 2)};`,
  ``,
].join('\n');

fs.writeFileSync(OUT_PATH, output, 'utf8');
console.log(`Wrote ${output.length.toLocaleString()} bytes to ${OUT_PATH}`);

console.log('\n=== Spot-checks ===');
['m001','m003','m011','m021','m028'].forEach(k => {
  const p = sections[k];
  if (p) console.log(`[${k}] ${p.length} paras — "${(p[0]||'').replace(/<[^>]+>/g,'').substring(0,60)}"`);
  else   console.log(`[${k}] NOT FOUND`);
});
console.log('\nDone!');
