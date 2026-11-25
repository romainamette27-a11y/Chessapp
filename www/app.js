/* Interface du répertoire d'ouvertures. Donne accès aux fonctions
   Game/moveKey/START_FEN (engine.js) et treeToPgn/pgnToTree/countTree/createEdge (pgn.js). */
'use strict';

const $ = (id) => document.getElementById(id);

let DATA = null;
let path = [];
let flipped = false;
let selectedSq = -1;
let saveTimer = null;
let dirty = false;

const FILE_LABELS = 'abcdefgh';

function el(tag, attrs, text) {
  const n = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
  if (text !== undefined) n.textContent = text;
  return n;
}

function defaultData() {
  return {
    version: 1,
    perspective: 'w',
    opponents: [],
    root: { fen: START_FEN, children: [] },
  };
}

function normalizeData(d) {
  const base = defaultData();
  if (!d || typeof d !== 'object') return base;
  const out = {
    version: 1,
    perspective: d.perspective === 'b' ? 'b' : 'w',
    opponents: Array.isArray(d.opponents) ? d.opponents.filter((s) => typeof s === 'string') : [],
    root: normalizeNode(d.root, base.root.fen),
  };
  return out;
}

function normalizeNode(n, fallbackFen) {
  if (!n || typeof n !== 'object') return { fen: fallbackFen, children: [] };
  const node = {
    fen: typeof n.fen === 'string' && n.fen.length ? n.fen : fallbackFen,
    children: [],
  };
  if (Array.isArray(n.children)) {
    for (const e of n.children) {
      if (!e || typeof e !== 'object' || !e.uci) continue;
      node.children.push({
        san: typeof e.san === 'string' ? e.san : e.uci,
        uci: e.uci,
        comment: typeof e.comment === 'string' ? e.comment : '',
        tag: ['main', 'alt', 'avoid'].includes(e.tag) ? e.tag : null,
        opponents: Array.isArray(e.opponents) ? e.opponents.filter((s) => typeof s === 'string') : [],
        node: normalizeNode(e.node, node.fen),
      });
    }
  }
  return node;
}

function currentNode() {
  return path.length ? path[path.length - 1].node : DATA.root;
}

function currentGame() {
  return new Game(currentNode().fen);
}

function myColor() {
  return DATA.perspective;
}

function saveStatus(txt) {
  $('save-status').textContent = txt;
}

function scheduleSave() {
  dirtyNow();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 700);
}

function dirtyNow() {
  saveStatus('Modifications non enregistrées…');
}

async function flushSave() {
  saveStatus('Enregistrement…');
  try {
    const res = await fetch('/api/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DATA),
      keepalive: true,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const t = new Date();
    saveStatus('Enregistré à ' + t.toLocaleTimeString('fr-FR'));
  } catch (e) {
    saveStatus('⚠ Échec de l’enregistrement sur le serveur');
  }
}

/* ---------- Échiquier ---------- */

const boardEl = $('board');
const squares = [];

function buildBoardGrid() {
  squares.length = 0;
  boardEl.innerHTML = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = el('div', { class: 'sq' });
      sq.addEventListener('click', () => onSquareClick(sqIndexAt(r, c)));
      boardEl.appendChild(sq);
      squares.push(sq);
    }
  }
}

function sqIndexAt(displayRow, displayCol) {
  const rank = flipped ? displayRow : 7 - displayRow;
  const file = flipped ? 7 - displayCol : displayCol;
  return rank * 16 + file;
}

function displayPos(sq) {
  const rank = sq >> 4;
  const file = sq & 7;
  return {
    row: flipped ? rank : 7 - rank,
    col: flipped ? 7 - file : file,
  };
}

const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

function renderBoard() {
  const fen = currentNode().fen;
  const game = currentGame();
  const legal = game.legalMoves();
  const last = path.length ? path[path.length - 1] : null;
  const checkedColor = game.inCheck() ? game.kingSquare(game.turn) : -1;

  squares.forEach((sqEl) => {
    sqEl.className = 'sq';
    sqEl.innerHTML = '';
  });

  for (let sq = 0; sq < 128; sq++) {
    if ((sq & 0x88) !== 0) continue;
    const pos = displayPos(sq);
    const sqEl = squares[pos.row * 8 + pos.col];
    const piece = game.board[sq];
    sqEl.classList.add(((sq >> 4) + (sq & 7)) % 2 === 1 ? 'light' : 'dark');
    if (piece) {
      const sp = el('span', { class: 'piece ' + (piece === piece.toUpperCase() ? 'w' : 'b') }, GLYPHS[piece.toLowerCase()]);
      sqEl.appendChild(sp);
    }
    if (pos.col === 0) sqEl.appendChild(el('span', { class: 'coord rank' }, String((sq >> 4) + 1)));
    if (pos.row === 7) sqEl.appendChild(el('span', { class: 'coord file' }, 'abcdefgh'[sq & 7]));

    if (last && (sq === fromOf(last.uci) || sq === toOf(last.uci))) sqEl.classList.add('lastmove');
    if (sq === checkedColor) sqEl.classList.add('checked');

    const child = currentNode().children.find((e) => toOf(e.uci) === sq);
    if (child) {
      const dot = el('span', { class: 'dot ' + (game.turn === myColor() ? 'book-mine' : 'book-opp') });
      sqEl.appendChild(dot);
    }
  }

  if (selectedSq >= 0) {
    const pos = displayPos(selectedSq);
    squares[pos.row * 8 + pos.col].classList.add('selected');
    for (const m of legal) {
      if (m.from !== selectedSq) continue;
      const p = displayPos(m.to);
      const target = squares[p.row * 8 + p.col];
      if (!target.querySelector('.dot')) target.appendChild(el('span', { class: 'dot legal' }));
    }
  }

  const banner = $('turn-banner');
  banner.innerHTML = '';
  if (game.isCheckmate()) {
    banner.textContent = '';
    banner.appendChild(document.createTextNode('Échec et mat. '));
    $('game-end').textContent = 'Échec et mat';
  } else if (game.isStalemate()) {
    banner.textContent = '';
    $('game-end').textContent = 'Pat (nulle)';
  } else {
    $('game-end').textContent = '';
    if (game.turn === myColor()) {
      banner.appendChild(el('span', { class: 'me' }, 'À votre tour de jouer.'));
      banner.appendChild(document.createTextNode(' Les points verts montrent vos coups déjà préparés.'));
    } else {
      banner.appendChild(el('span', { class: 'opp' }, 'À l\'adversaire de jouer.'));
      banner.appendChild(document.createTextNode(' Jouez le coup de l\'adversaire pour voir votre réponse.'));
    }
  }
}

function isBookMove(sq, legal) {
  return legal.some((m) => m.to === sq);
}

function fromOf(uci) { return fromAlgebraic(uci.slice(0, 2)); }
function toOf(uci) { return fromAlgebraic(uci.slice(2, 4)); }

function onSquareClick(sq) {
  const game = currentGame();
  if (sq < 0) return;
  if (selectedSq >= 0) {
    const candidates = game.legalMoves().filter((m) => m.from === selectedSq && m.to === sq);
    if (candidates.length > 1) {
      showPromotionChooser(candidates);
      return;
    }
    if (candidates.length === 1) {
      playMove(candidates[0]);
      return;
    }
  }
  const piece = game.board[sq];
  if (piece && (piece === piece.toUpperCase() ? 'w' : 'b') === game.turn) {
    selectedSq = (selectedSq === sq) ? -1 : sq;
  } else {
    selectedSq = -1;
  }
  renderBoard();
}

let pendingPromotion = null;

function showPromotionChooser(candidates) {
  pendingPromotion = candidates;
  const overlay = el('div', { id: 'promo-overlay' });
  const box = el('div', { id: 'promo-box' });
  box.appendChild(el('p', {}, 'Promotion en :'));
  for (const t of ['q', 'r', 'b', 'n']) {
    const move = candidates.find((m) => m.promotion && m.promotion.toLowerCase() === t);
    if (!move) continue;
    const btn = el('button', { class: 'promo-btn' }, GLYPHS[t]);
    btn.addEventListener('click', () => {
      closePromotionChooser();
      playMove(move);
    });
    box.appendChild(btn);
  }
  const cancel = el('button', {}, 'Annuler');
  cancel.addEventListener('click', () => { closePromotionChooser(); selectedSq = -1; renderBoard(); });
  box.appendChild(cancel);
  overlay.appendChild(box);
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) { closePromotionChooser(); selectedSq = -1; renderBoard(); } });
  document.body.appendChild(overlay);
}

function closePromotionChooser() {
  pendingPromotion = null;
  const o = $('promo-overlay');
  if (o) o.remove();
}

function playMove(move) {
  const node = currentNode();
  const game = currentGame();
  if (!game.isLegalMove(move)) return;
  const uci = moveKey(move);
  let edge = node.children.find((e) => e.uci === uci);
  if (!edge) {
    edge = createEdge(node, game, move, game.buildSan(move));
    scheduleSave();
  }
  path.push(edge);
  selectedSq = -1;
  renderAll();
}

/* ---------- Navigation ---------- */

function goStart() { path = []; selectedSq = -1; renderAll(); }
function goBack() { if (path.length) { path.pop(); selectedSq = -1; renderAll(); } }
function goForward() { const c = currentNode().children; if (c.length) { path.push(c[0]); renderAll(); } }

function navigateTo(edge) {
  const idx = path.indexOf(edge);
  if (idx >= 0) {
    path = path.slice(0, idx + 1);
  } else {
    path = pathFindTo(edge);
  }
  renderAll();
}

function pathFindTo(edge) {
  const found = [];
  function walk(node, acc) {
    for (const e of node.children) {
      acc.push(e);
      if (e === edge) { found.push(...acc); return true; }
      if (walk(e.node, acc)) return true;
      acc.pop();
    }
    return false;
  }
  walk(DATA.root, []);
  return found;
}

/* ---------- Bandeau de ligne ---------- */

function renderLineBar() {
  const bar = $('line-bar');
  bar.innerHTML = '';
  if (!path.length) {
    bar.appendChild(el('span', { class: 'hint' }, 'Position de départ.'));
    return;
  }
  const game = new Game(DATA.root.fen);
  path.forEach((edge, i) => {
    const white = game.turn === 'w';
    const span = el('span', { class: 'lm ' + (white ? 'moi' : 'adv') + (i === path.length - 1 ? ' current' : '') });
    const prefix = white ? game.fullmove + '. ' : (i === 0 ? game.fullmove + '... ' : '');
    span.textContent = (white || i === 0 ? prefix : ' ') + edge.san;
    span.title = edge.comment || '';
    span.addEventListener('click', () => { path = path.slice(0, i + 1); selectedSq = -1; renderAll(); });
    bar.appendChild(span);
    const mv = game.legalMoves().find((m) => moveKey(m) === edge.uci);
    if (mv) game.makeMove(mv);
  });
}

/* ---------- Coups candidats ---------- */

function renderCandidates() {
  const box = $('candidates');
  box.innerHTML = '';
  const node = currentNode();
  if (!node.children.length) {
    box.appendChild(el('p', { class: 'hint' }, 'Aucun coup enregistré ici. Jouez sur l’échiquier pour commencer une ligne, ou importez un PGN.'));
    return;
  }
  const isMyTurn = new Game(node.fen).turn === myColor();
  for (const edge of node.children) {
    const cand = el('span', { class: 'cand' });
    cand.appendChild(el('span', { class: 'who ' + (isMyTurn ? 'moi' : 'adv') }, isMyTurn ? 'Moi' : 'Adv.'));
    cand.appendChild(document.createTextNode(edge.san));
    if (edge.tag === 'main') cand.appendChild(el('span', { class: 'tag' }, '★'));
    if (edge.tag === 'avoid') cand.appendChild(el('span', { class: 'tag' }, '⚠'));
    if (edge.opponents.length) cand.appendChild(el('span', { class: 'opponents' }, '· ' + edge.opponents.join(', ')));
    if (edge.comment) cand.title = edge.comment;
    cand.addEventListener('click', () => { path.push(edge); renderAll(); });
    box.appendChild(cand);
  }
}

/* ---------- Éditeur ---------- */

function selectedEdge() {
  return path.length ? path[path.length - 1] : null;
}

function renderEditor() {
  const edge = selectedEdge();
  const panel = $('editor');
  if (!edge) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  const isMine = new Game(path[path.length - 2] ? path[path.length - 2].node.fen : DATA.root.fen).turn === myColor();
  $('editor-title').textContent = 'Coup « ' + edge.san + ' » (' + (isMine ? 'votre coup' : 'coup adverse') + ')';
  $('ed-tag').value = edge.tag || '';
  if ($('ed-comment').value !== edge.comment) $('ed-comment').value = edge.comment;

  const chips = $('ed-opponents');
  chips.innerHTML = '';
  DATA.opponents.forEach((name) => {
    const on = edge.opponents.includes(name);
    const chip = el('span', { class: 'chip clickable' + (on ? ' on' : '') });
    const cb = el('input', { type: 'checkbox' });
    cb.checked = on;
    cb.addEventListener('change', () => {
      if (cb.checked) {
        if (!edge.opponents.includes(name)) edge.opponents.push(name);
      } else {
        edge.opponents = edge.opponents.filter((n) => n !== name);
      }
      scheduleSave();
      renderCandidates();
      renderTree();
    });
    chip.appendChild(cb);
    chip.appendChild(document.createTextNode(name));
    chips.appendChild(chip);
  });
  $('ed-new-opponent').value = '';
}

function bindEditor() {
  $('ed-tag').addEventListener('change', () => {
    const edge = selectedEdge();
    if (!edge) return;
    edge.tag = $('ed-tag').value || null;
    scheduleSave();
    renderCandidates();
    renderTree();
  });
  $('ed-comment').addEventListener('input', () => {
    const edge = selectedEdge();
    if (!edge) return;
    edge.comment = $('ed-comment').value;
    scheduleSave();
  });
  $('ed-comment').addEventListener('change', () => { renderCandidates(); renderTree(); });
  $('ed-add-opponent').addEventListener('click', () => {
    const edge = selectedEdge();
    const name = $('ed-new-opponent').value.trim();
    if (!edge || !name) return;
    if (!DATA.opponents.includes(name)) DATA.opponents.push(name);
    if (!edge.opponents.includes(name)) edge.opponents.push(name);
    scheduleSave();
    renderEditor();
    renderCandidates();
    renderTree();
    renderOpponents();
  });
  $('ed-promote').addEventListener('click', () => {
    const edge = selectedEdge();
    if (!edge) return;
    const parent = path.length >= 2 ? path[path.length - 2].node : DATA.root;
    const i = parent.children.indexOf(edge);
    if (i > 0) {
      parent.children.splice(i, 1);
      parent.children.unshift(edge);
      scheduleSave();
      renderAll();
    }
  });
  $('ed-delete').addEventListener('click', () => {
    const edge = selectedEdge();
    if (!edge) return;
    if (!confirm('Supprimer « ' + edge.san + ' » et toute sa continuation ?')) return;
    const parent = path.length >= 2 ? path[path.length - 2].node : DATA.root;
    const i = parent.children.indexOf(edge);
    if (i >= 0) parent.children.splice(i, 1);
    path.pop();
    selectedSq = -1;
    scheduleSave();
    renderAll();
  });
}

/* ---------- Arbre ---------- */

function renderTree() {
  const container = $('tree');
  container.innerHTML = '';
  container.appendChild(buildTreeLine(DATA.root, [], 0, true));
  const s = countTree(DATA.root);
  $('tree-stats').textContent = '· ' + s.edges + ' coups · ' + s.leaves + ' lignes';
}

function buildTreeLine(node, basePath, depth, isFirst) {
  const frag = document.createDocumentFragment();
  node.children.forEach((edge, i) => {
    const isVariation = i > 0;
    if (isVariation) {
      frag.appendChild(el('span', { class: 'indent' }, '\n' + '  '.repeat(depth + 1)));
      frag.appendChild(el('span', { class: 'marker' }, '('));
    }
    const game = new Game(node.fen);
    const white = game.turn === 'w';
    const prefix = (isVariation || isFirst || white) ? (game.fullmove + (white ? '. ' : '... ')) : '';
    const active = path.includes(edge);
    const tooltipParts = [];
    if (edge.tag) tooltipParts.push({ main: 'principale', alt: 'alternative', avoid: 'à éviter' }[edge.tag]);
    if (edge.opponents.length) tooltipParts.push('contre : ' + edge.opponents.join(', '));
    if (edge.comment) tooltipParts.push(edge.comment);
    const span = el('span', {
      class: 'tm ' + (white ? 'moi' : 'adv') + (active ? ' active' : ''),
      title: tooltipParts.join(' — '),
    }, prefix + edge.san + (edge.tag === 'main' ? ' ★' : edge.tag === 'avoid' ? ' ⚠' : ''));
    span.addEventListener('click', () => navigateTo(edge));
    frag.appendChild(span);
    if (isVariation) {
      const inner = buildTreeLine(edge.node, basePath.concat(edge), depth + 1, false);
      frag.appendChild(inner);
      frag.appendChild(el('span', { class: 'indent' }, '\n' + '  '.repeat(depth + 1) + ')'));
    }
  });
  if (node.children.length) {
    frag.appendChild(buildTreeLine(node.children[0].node, basePath.concat([node.children[0]]), depth, false));
  }
  return frag;
}

/* ---------- Adversaires ---------- */

function renderOpponents() {
  const box = $('op-list');
  box.innerHTML = '';
  if (!DATA.opponents.length) {
    box.appendChild(el('span', { class: 'hint' }, 'Aucun adversaire pour l’instant.'));
    return;
  }
  DATA.opponents.forEach((name, idx) => {
    const chip = el('span', { class: 'chip' });
    chip.appendChild(document.createTextNode(name));
    const x = el('span', { class: 'x', title: 'Retirer de la liste' }, '×');
    x.addEventListener('click', () => {
      if (!confirm('Retirer « ' + name + ' » ? (les mentions de ce nom sur les coups seront effacées)')) return;
      DATA.opponents.splice(idx, 1);
      stripOpponent(DATA.root, name);
      scheduleSave();
      renderOpponents();
      renderEditor();
      renderCandidates();
      renderTree();
    });
    chip.appendChild(x);
    box.appendChild(chip);
  });
}

function stripOpponent(node, name) {
  for (const e of node.children) {
    e.opponents = e.opponents.filter((n) => n !== name);
    stripOpponent(e.node, name);
  }
}

function bindOpponents() {
  $('op-add').addEventListener('click', () => {
    const name = $('op-new').value.trim();
    if (!name) return;
    if (!DATA.opponents.includes(name)) {
      DATA.opponents.push(name);
      scheduleSave();
    }
    $('op-new').value = '';
    renderOpponents();
    renderEditor();
  });
  $('op-new').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('op-add').click(); });
}

/* ---------- Import / export ---------- */

function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

let modalMode = null;

function openModal(mode, title, text) {
  modalMode = mode;
  $('modal-title').textContent = title;
  $('modal-text').value = text || '';
  $('modal-error').textContent = '';
  $('modal-replace').checked = true;
  $('modal-replace').parentElement.classList.toggle('hidden', mode !== 'pgn');
  $('modal-text').readOnly = false;
  $('modal-file-label').classList.toggle('hidden', mode === 'export-pgn');
  $('modal-ok').classList.toggle('hidden', mode === 'export-pgn');
  $('modal-file').value = '';
  $('modal').showModal();
}

function bindToolbar() {
  $('perspective').addEventListener('change', () => {
    DATA.perspective = $('perspective').value;
    flipped = DATA.perspective === 'b';
    scheduleSave();
    renderAll();
  });
  $('btn-flip').addEventListener('click', () => { flipped = !flipped; renderBoard(); });
  $('btn-start').addEventListener('click', goStart);
  $('btn-prev').addEventListener('click', goBack);
  $('btn-next').addEventListener('click', goForward);

  $('btn-import-pgn').addEventListener('click', () => openModal('pgn', 'Importer un PGN (variantes et commentaires reconnus)', ''));
  $('btn-import-json').addEventListener('click', () => openModal('json', 'Importer une sauvegarde JSON complète', ''));
  $('btn-export-pgn').addEventListener('click', () => {
    const text = treeToPgn(DATA.root, { perspective: DATA.perspective, event: 'Répertoire d’ouvertures' });
    openModal('export-pgn', 'Export PGN (les adversaires ne sont conservés que dans le JSON)', text);
  });
  $('btn-export-json').addEventListener('click', () => {
    const text = JSON.stringify(DATA, null, 2);
    openModal('export-json', 'Export JSON (sauvegarde complète)', text);
  });
  $('btn-new').addEventListener('click', () => {
    if (!confirm('Effacer tout le répertoire actuel ? Pensez à exporter avant.')) return;
    DATA = defaultData();
    path = [];
    selectedSq = -1;
    scheduleSave();
    renderAll();
  });

  $('modal-cancel').addEventListener('click', () => $('modal').close());
  $('modal-file').addEventListener('change', () => {
    const f = $('modal-file').files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { $('modal-text').value = reader.result; };
    reader.readAsText(f);
  });
  $('modal-ok').addEventListener('click', () => {
    const text = $('modal-text').value;
    try {
      if (modalMode === 'pgn') {
        const replace = $('modal-replace').checked;
        if (replace) {
          const res = pgnToTree(text);
          DATA.root = res.root;
        } else {
          const probe = pgnToTree(text);
          if (probe.headerFen && probe.headerFen !== DATA.root.fen) {
            $('modal-error').textContent = 'Ce PGN commence à une autre position (' + probe.headerFen + '). La fusion nécessite le même point de départ ; utilisez « Remplacer » ou importez un PGN partant de la position initiale.';
            return;
          }
          pgnToTree(text, { into: DATA.root, startFen: DATA.root.fen });
        }
        path = [];
        selectedSq = -1;
        scheduleSave();
        $('modal').close();
        renderAll();
      } else if (modalMode === 'json') {
        DATA = normalizeData(JSON.parse(text));
        path = [];
        selectedSq = -1;
        scheduleSave();
        $('modal').close();
        renderAll();
      } else if (modalMode === 'export-pgn') {
        downloadFile('repertoire.pgn', $('modal-text').value, 'application/x-chess-pgn');
        $('modal').close();
      } else if (modalMode === 'export-json') {
        downloadFile('repertoire.json', $('modal-text').value, 'application/json');
        $('modal').close();
      }
    } catch (e) {
      $('modal-error').textContent = 'Erreur : ' + e.message;
    }
  });
}

/* ---------- Clavier ---------- */

function bindKeyboard() {
  document.addEventListener('keydown', (ev) => {
    if (ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
    if ($('modal').open) return;
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); goBack(); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); goForward(); }
    else if (ev.key === 'Home' || ev.key === 'ArrowUp') { ev.preventDefault(); goStart(); }
  });
}

/* ---------- Rendu global ---------- */

function renderAll() {
  renderBoard();
  renderLineBar();
  renderCandidates();
  renderEditor();
  renderTree();
}

/* ---------- Démarrage ---------- */

async function init() {
  buildBoardGrid();
  bindEditor();
  bindOpponents();
  bindToolbar();
  bindKeyboard();
  try {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DATA = normalizeData(await res.json());
    saveStatus('Répertoire chargé.');
  } catch (e) {
    DATA = defaultData();
    saveStatus('⚠ Impossible de charger les données : ' + e.message);
  }
  $('perspective').value = DATA.perspective;
  flipped = DATA.perspective === 'b';
  renderAll();
}

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && saveTimer) {
    clearTimeout(saveTimer);
    flushSave();
  }
});

init();
