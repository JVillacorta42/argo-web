'use strict';
/**
 * parse_cqlc.js
 * Parses Cueste_lo_que_cueste.docx (cqlc_doc.xml) → cqlc_data.js
 * Run: node "Ciclo_5/Aventuras_secudarias/parse_cqlc.js"
 *
 * Structure:
 *   α  — Intro section (everything before 0001, incl. all chapter intros)
 *   0001–0066 — numbered game sections
 */

const fs   = require('fs');
const path = require('path');

const XML_PATH  = path.join(__dirname, 'cqlc_doc.xml');
const OUT_PATH  = path.join(__dirname, 'cqlc_data.js');
const IMGS_DIR  = 'Aventuras_secudarias/cqlc_img';

let xml;
try { xml = fs.readFileSync(XML_PATH, 'utf8'); }
catch(e) { console.error('Cannot read XML:', e.message); process.exit(1); }
console.log(`Read ${xml.length.toLocaleString()} bytes`);

// ─── Image relationship map ────────────────────────────────────────────────────
const RID_TO_IMG = {};
try {
  const { execSync } = require('child_process');
  const docx = path.join(__dirname, "Cueste_lo_que_cueste.docx");
  const relsXml = execSync(`unzip -p "${docx}" word/_rels/document.xml.rels`).toString();
  for (const m of relsXml.matchAll(/Id="(rId\d+)"[^>]*Target="media\/([^"]+)"/g)) RID_TO_IMG[m[1]] = m[2];
  console.log(`Loaded ${Object.keys(RID_TO_IMG).length} image relationships`);
} catch(e) { console.warn('Could not load image rels:', e.message); }

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

function linkifyRefs(html) {
  return html.replace(/(?<![&\w="])(\d{4,5})(?!\d)(?![^<]*>)/g, (_, num) =>
    `<a class="ref-link" data-doc="cqlc" data-sec="${num}">${num}</a>`
  );
}

const GAME_NOTE_PATTERNS = [
  /\bVe\s+\d{4,5}\b/i, /\bve\s+a\s+\d{4,5}\b/i,
  /^Diplomacy/i, /^Vanguard:/i, /^Protectorate:/i, /^Followers?:/i,
  /^Pierde\b/i, /^Obtén\b/i, /^Si tienes\b/i, /^Si no tienes\b/i,
  /^Si\s+[A-ZV]/i, /^Elige:/i, /^Elige\b/i, /^Elige\s+por/i,
  /^Gana\b/i, /^Resta\b/i, /^Añade\b/i, /^Coloca\b/i,
  /^Retira\b/i, /^Elimina\b/i, /^Marca\b/i,
  /^Mata\b/i, /^Permite\b/i, /^Anota\b/i,
  /Diplomacia [+\-]/i, /Diplomacy [+\-]/i,
  /^Cuando termines/i, /^Cuando hayas/i,
  /Fase de Viaje/i,
  /^Fallo\b/i, /^Éxito\b/i, /^Independientemente\b/i,
  /^\d+[-+–]\d+\s+éxito/i, /^\d+\+\s+éxito/i,
  /^Cada\s+Argonauta\b/i, /^Cualquier\s+Argonauta\b/i,
  /^De lo contrario/i,
  /^Protectorado:/i, /^Seguidores?:/i, /^Vanguardia:/i,
  /^Reduce\b/i, /^Resuelve\b/i,
  /Pista\s+[A-Z]/i, /^Marca\s+[A-Z]/i,
  /regresa a la Fase/i,
  /^Descarta\b/i,
];

function isGameNote(text) {
  for (const re of GAME_NOTE_PATTERNS) { if (re.test(text.trim())) return true; }
  return false;
}

function extractDrawingRids(para) {
  const rids = [];
  for (const m of para.matchAll(/r:embed="(rId\d+)"/g)) rids.push(m[1]);
  return rids;
}

function paraToHtml(para, runsOverride) {
  if (isHorizontalRule(para)) return null;

  const rids = extractDrawingRids(para);
  let imgHtml = '';
  for (const rid of rids) {
    const fname = RID_TO_IMG[rid];
    if (fname) imgHtml += `<img class="rules-img" src="${IMGS_DIR}/${fname}" alt="">`;
  }

  const runs = runsOverride || extractRuns(para);
  const rawText = runs.map(r=>r.segments.map(s=>s.text||'').join('')).join('');

  if (imgHtml && !rawText.trim()) return `<div class="rules-img-wrap">${imgHtml}</div>`;
  if (runs.length === 0) return imgHtml ? `<div class="rules-img-wrap">${imgHtml}</div>` : null;
  if (!rawText.trim()) return imgHtml ? `<div class="rules-img-wrap">${imgHtml}</div>` : null;

  let html = runsToHtml(runs);
  if (!html.trim()) return imgHtml ? `<div class="rules-img-wrap">${imgHtml}</div>` : null;
  html = linkifyRefs(html);

  const textHtml = isGameNote(rawText.trim())
    ? `<p class="game-note">${html}</p>`
    : `<p class="narrative">${html}</p>`;

  return imgHtml ? `<div class="rules-img-wrap">${imgHtml}</div>${textHtml}` : textHtml;
}

// ─── Section detection ────────────────────────────────────────────────────────
function detectSectionStart(para) {
  if (isHorizontalRule(para)) return null;
  const plain = paragraphPlainText(para);
  if (!plain) return null;

  // Standalone 4-5 digit number
  if (/^\d{4,5}$/.test(plain)) return { type:'standalone', num: plain };

  // Inline: "XXXX text…"
  const inlineM = /^(\d{4,5}) ([\s\S]+)$/.exec(plain);
  if (inlineM) {
    const runs = extractRuns(para);
    return { type:'inline', num: inlineM[1], restRuns: stripNumPrefix(runs, inlineM[1]) };
  }

  // BR-split
  const firstRunM = /<w:t[^>]*>(\d{4,5})<\/w:t><\/w:r>/.exec(para);
  if (firstRunM) {
    const afterFirst = para.substring(para.indexOf(firstRunM[0]) + firstRunM[0].length);
    if (/<w:r[^>]*>\s*(?:<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:br/.test(afterFirst)) {
      const allRuns = extractRuns(para);
      const bodyRuns = allRuns.slice(1);
      if (bodyRuns.length > 0 && bodyRuns[0].segments[0] && bodyRuns[0].segments[0].type==='br')
        bodyRuns[0] = { ...bodyRuns[0], segments: bodyRuns[0].segments.slice(1) };
      return { type:'br_split', num: firstRunM[1], bodyRuns };
    }
  }
  return null;
}

function stripNumPrefix(runs, num) {
  const escaped = num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let stripped = false;
  return runs.map(run => {
    if (stripped) return run;
    const newSegs = run.segments.map(seg => {
      if (!stripped && seg.type==='text' && seg.text.startsWith(num)) {
        stripped = true;
        return { ...seg, text: seg.text.replace(new RegExp('^' + escaped + '\\s*'), '') };
      }
      return seg;
    });
    return { ...run, segments: newSegs };
  });
}

// ─── Parse ────────────────────────────────────────────────────────────────────
console.log('\n=== Parsing Cueste lo que Cueste ===');

const bodyStart = xml.indexOf('<w:body>');
if (bodyStart === -1) { console.error('No <w:body>'); process.exit(1); }
const bodyXml = xml.substring(bodyStart);

const paras = extractParagraphs(bodyXml);
console.log(`Found ${paras.length} paragraphs`);

const sections = {};
const order = [];

// Everything before 0001 goes into 'α'
let current = 'α';
sections['α'] = [];
order.push('α');

// Filter out Word form artifacts
const SKIP_TEXTS = ['Principio del formulario', 'Final del formulario'];

for (let i = 0; i < paras.length; i++) {
  const para = paras[i];
  if (isHorizontalRule(para)) continue;

  const plain = paragraphPlainText(para);
  if (SKIP_TEXTS.includes(plain)) continue;

  const sec = detectSectionStart(para);
  if (sec) {
    const num = sec.num;
    if (!sections[num]) { sections[num] = []; order.push(num); }
    current = num;

    if (sec.type === 'inline' || sec.type === 'br_split') {
      const bodyRuns = sec.type === 'inline' ? sec.restRuns : sec.bodyRuns;
      const rawText = bodyRuns.map(r=>r.segments.map(s=>s.text||'').join('')).join('').trim();
      if (rawText) {
        let html = runsToHtml(bodyRuns);
        html = linkifyRefs(html);
        if (html.trim()) {
          sections[num].push(isGameNote(rawText)
            ? `<p class="game-note">${html}</p>`
            : `<p class="narrative">${html}</p>`);
        }
      }
    }
    continue;
  }

  const h = paraToHtml(para);
  if (h) sections[current].push(h);
}

// Sort: α first, then numeric order
order.sort((a, b) => {
  if (a === 'α') return -1; if (b === 'α') return 1;
  return parseInt(a,10) - parseInt(b,10);
});

const sectionCount = Object.keys(sections).length;
console.log(`Parsed ${sectionCount} sections`);
console.log('First section:', order[0], '— Last:', order[order.length-1]);

// ─── Output ───────────────────────────────────────────────────────────────────
const DATA = {
  cqlc: {
    title: "Cueste lo que Cueste",
    start: 'α',
    order,
    sections,
  }
};

const output = [
  `// CQLC_DATA — Cueste lo que Cueste`,
  `// Auto-generated by parse_cqlc.js on ${new Date().toISOString()}`,
  `// Sections: ${sectionCount}`,
  ``,
  `var CQLC_DATA = ${JSON.stringify(DATA, null, 2)};`,
  ``,
].join('\n');

fs.writeFileSync(OUT_PATH, output, 'utf8');
console.log(`Wrote ${output.length.toLocaleString()} bytes to ${OUT_PATH}`);

// Spot-checks
console.log('\n=== Spot-checks ===');
['α','0001','0010','0040','0066'].forEach(k => {
  const p = sections[k];
  if (p) console.log(`[${k}] ${p.length} paras — "${(p[0]||'').replace(/<[^>]+>/g,'').substring(0,70)}"`);
  else   console.log(`[${k}] NOT FOUND`);
});
console.log('\nDone!');
