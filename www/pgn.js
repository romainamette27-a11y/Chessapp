/* Import/export PGN avec variantes, commentaires et tags sous forme de NAG.
   Arbre : nœud {fen, children:[coups]}, coup {san, uci, comment, tag, opponents, node}. */
'use strict';

const TAG_NAG = { main: '$1', alt: '$5', avoid: '$4' };
const NAG_TAG = { 1: 'main', 4: 'avoid', 5: 'alt' };

function cloneGameOf(fen) { return new Game(fen); }

/* ---------- Export ---------- */

function treeToPgn(root, meta) {
  const headers = [];
  meta = meta || {};
  headers.push('[Event "' + (meta.event || 'Répertoire personnel') + '"]');
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  headers.push('[Date "' + d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + '"]');
  headers.push('[White "' + (meta.white || (meta.perspective === 'b' ? 'Adversaire' : 'Moi')) + '"]');
  headers.push('[Black "' + (meta.black || (meta.perspective === 'b' ? 'Moi' : 'Adversaire')) + '"]');
  headers.push('[Result "*"]');
  let body = movesText(root.fen, root, { forceNumber: true, first: true });
  if (body.length === 0) body = '';
  return headers.join('\n') + '\n\n' + body.trim() + ' *';
}

function movesText(fen, node, opts) {
  const game = cloneGameOf(fen);
  if (!node.children.length) return '';
  const mainline = node.children[0];
  const white = game.turn === 'w';
  const needNumber = white || opts.first;
  let out = needNumber ? game.fullmove + (white ? '. ' : '... ') : '';
  out += mainline.san;
  if (mainline.tag && TAG_NAG[mainline.tag]) out += ' ' + TAG_NAG[mainline.tag];
  if (mainline.comment) out += ' {' + mainline.comment.replace(/[}]/g, '') + '}';
  for (let i = 1; i < node.children.length; i++) {
    const edge = node.children[i];
    let mv = game.fullmove + (white ? '. ' : '... ') + edge.san;
    if (edge.tag && TAG_NAG[edge.tag]) mv += ' ' + TAG_NAG[edge.tag];
    if (edge.comment) mv += ' {' + edge.comment.replace(/[}]/g, '') + '}';
    const sub = movesText(edge.node.fen, edge.node, { first: false });
    if (sub) mv += ' ' + sub;
    out += ' (' + mv + ')';
  }
  const sub = movesText(mainline.node.fen, mainline.node, { first: false });
  if (sub) out += ' ' + sub;
  return out.trim();
}

/* ---------- Import ---------- */

function pgnToTree(text, opts) {
  opts = opts || {};
  let startFen = opts.startFen || START_FEN;
  let headerFenFound = false;
  const headerRe = /^\s*\[(\w+)\s+"([^"]*)"\]/;
  const bodyLines = [];
  const resultRe = /^(1-0|0-1|1\/2-1\/2|\*)$/;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const line of lines) {
    if (line.trim().startsWith('%')) continue;
    const m = line.match(headerRe);
    if (m) {
      if (m[1].toLowerCase() === 'fen' && m[2]) { startFen = m[2].trim(); headerFenFound = true; }
      continue;
    }
    bodyLines.push(line);
  }
  let body = bodyLines.join('\n');
  body = body.replace(/;[^\n]*/g, ' ');

  const tokens = [];
  const re = /\{([^}]*)\}|\(|\)|\$(\d+)|(\d+)\s*(\.{1,3})|([^\s(){}$]+)/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    if (match[1] !== undefined) tokens.push({ kind: 'comment', text: match[1].trim() });
    else if (match[0] === '(') tokens.push({ kind: 'open' });
    else if (match[0] === ')') tokens.push({ kind: 'close' });
    else if (match[2] !== undefined) tokens.push({ kind: 'nag', n: parseInt(match[2], 10) });
    else if (match[3] !== undefined) {
      tokens.push({ kind: 'num', n: parseInt(match[3], 10), ellipsis: (match[4] || '').length >= 3 });
    } else if (resultRe.test(match[0])) { /* résultat : ignoré */ }
    else if (match[5] && !/^[+!?$#.]+$/.test(match[5])) tokens.push({ kind: 'san', text: match[5] });
  }

  const root = opts.into || { fen: startFen, children: [] };
  const ctx = { movesCount: 0 };
  parseBody(tokens, 0, root, cloneGameOf(root.fen), null, ctx, true);
  return { root, movesCount: ctx.movesCount, headerFen: headerFenFound ? startFen : null };
}

function parseBody(tokens, pos, node, game, lastEdge, ctx, topLevel) {
  const localStack = [];
  while (pos < tokens.length) {
    const tok = tokens[pos];
    if (tok.kind === 'san') {
      const move = game.findSan(tok.text);
      if (!move) throw new Error('Coup non reconnu : « ' + tok.text + ' » (position : ' + game.fen() + ')');
      localStack.push({ node, game, lastEdge });
      const san = game.buildSan(move);
      let edge = node.children.find((e) => e.uci === moveKey(move));
      if (!edge) edge = createEdge(node, game, move, san);
      node = edge.node;
      game = cloneGameOf(node.fen);
      lastEdge = edge;
      ctx.movesCount++;
      pos++;
    } else if (tok.kind === 'comment') {
      if (lastEdge) lastEdge.comment = lastEdge.comment ? lastEdge.comment + ' ' + tok.text : tok.text;
      pos++;
    } else if (tok.kind === 'nag') {
      if (lastEdge && NAG_TAG[tok.n]) lastEdge.tag = NAG_TAG[tok.n];
      pos++;
    } else if (tok.kind === 'num') {
      pos++;
    } else if (tok.kind === 'open') {
      const info = peekVariationStart(tokens, pos + 1);
      if (topLevel && !localStack.length) {
        throw new Error('Variante au début du PGN sans coup principal.');
      }
      const base = rewindForVariation(localStack, info, node, game);
      const res = parseBody(tokens, info.pos, base.node, base.game, base.lastEdge, ctx, false);
      pos = res.pos;
    } else if (tok.kind === 'close') {
      if (topLevel) throw new Error('Parenthèse fermante inattendue dans le PGN.');
      return { pos: pos + 1 };
    } else {
      pos++;
    }
  }
  return { pos };
}

function peekVariationStart(tokens, pos) {
  let num = null, ellipsis = false, sanText = null;
  let i = pos;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.kind === 'num') { num = tok.n; ellipsis = tok.ellipsis; i++; }
    else if (tok.kind === 'nag' || tok.kind === 'comment') i++;
    else if (tok.kind === 'san') { sanText = tok.text; break; }
    else break;
  }
  return { pos: i, num, ellipsis, sanText };
}

function rewindForVariation(stack, info, node, game) {
  const trySide = info.num != null ? (info.ellipsis ? 'b' : 'w') : null;
  let stackCopy = stack.slice();
  while (stackCopy.length) {
    const st = stackCopy[stackCopy.length - 1];
    if (trySide) {
      if (st.game.fullmove === info.num && st.game.turn === trySide) return st;
    } else if (info.num != null) {
      if (st.game.fullmove === info.num) return st;
    }
    stackCopy.pop();
  }
  if (stack.length) return stack[stack.length - 1];
  return { node, game, lastEdge: null };
}

function createEdge(parentNode, parentGame, move, san) {
  const childGame = parentGame.clone();
  childGame.makeMove(move);
  const edge = {
    san,
    uci: moveKey(move),
    comment: '',
    tag: null,
    opponents: [],
    node: { fen: childGame.fen(), children: [] },
  };
  parentNode.children.push(edge);
  return edge;
}

function countTree(node) {
  let edges = 0, leaves = 0, hasLeaf = node.children.length === 0;
  if (hasLeaf) leaves = 1;
  for (const edge of node.children) {
    const c = countTree(edge.node);
    edges += 1 + c.edges;
    leaves += c.leaves;
  }
  return { edges, leaves };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { treeToPgn, pgnToTree, countTree, createEdge, TAG_NAG };
}
