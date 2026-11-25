/* Moteur d'échecs 0x88 : génération de coups légaux, SAN, FEN. */
'use strict';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const KNIGHT_OFFSETS = [33, 31, 18, 14, -33, -31, -18, -14];
const KING_OFFSETS = [16, -16, 1, -1, 17, 15, -17, -15];
const BISHOP_DIRECTIONS = [17, 15, -17, -15];
const ROOK_DIRECTIONS = [16, -16, 1, -1];

const PIECE_TYPES = { p: 'p', n: 'n', b: 'b', r: 'r', q: 'q', k: 'k' };

function isOnBoard(sq) { return (sq & 0x88) === 0; }
function fileOf(sq) { return sq & 7; }
function rankOf(sq) { return sq >> 4; }
function algebraic(sq) {
  return 'abcdefgh'[fileOf(sq)] + (rankOf(sq) + 1);
}
function fromAlgebraic(s) {
  const file = 'abcdefgh'.indexOf(s[0]);
  const rank = parseInt(s[1], 10) - 1;
  if (file < 0 || rank < 0 || rank > 7) return -1;
  return rank * 16 + file;
}
function colorOfPiece(piece) {
  return piece === piece.toUpperCase() ? 'w' : 'b';
}

class Game {
  constructor(fen) {
    this.setFen(fen || START_FEN);
  }

  setFen(fen) {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 2) throw new Error('FEN invalide : ' + fen);
    this.board = new Array(128).fill(null);
    const rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('FEN invalide : ' + fen);
    for (let r = 0; r < 8; r++) {
      let file = 0;
      for (const ch of rows[r]) {
        if (/[1-8]/.test(ch)) {
          file += parseInt(ch, 10);
        } else {
          const piece = PIECE_TYPES[ch.toLowerCase()];
          if (!piece || file > 7) throw new Error('FEN invalide : ' + fen);
          this.board[(7 - r) * 16 + file] = ch;
          file++;
        }
      }
      if (file !== 8) throw new Error('FEN invalide : ' + fen);
    }
    this.turn = parts[1] === 'b' ? 'b' : 'w';
    this.castling = '';
    if (parts[2] && parts[2] !== '-') {
      for (const ch of parts[2]) {
        if ('KQkq'.includes(ch)) this.castling += ch;
      }
    }
    this.ep = (parts[3] && parts[3] !== '-') ? fromAlgebraic(parts[3]) : -1;
    this.halfmove = parts[4] ? parseInt(parts[4], 10) : 0;
    this.fullmove = parts[5] ? parseInt(parts[5], 10) : 1;
  }

  clone() {
    const g = new Game(this.fen());
    return g;
  }

  fen() {
    let out = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = this.board[rank * 16 + file];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        out += p;
      }
      if (empty) out += empty;
      if (rank > 0) out += '/';
    }
    let castling = this.castling || '-';
    const ep = this.ep >= 0 ? algebraic(this.ep) : '-';
    return `${out} ${this.turn} ${castling} ${ep} ${this.halfmove} ${this.fullmove}`;
  }

  kingSquare(color) {
    const target = color === 'w' ? 'K' : 'k';
    for (let sq = 0; sq < 128; sq++) {
      if (isOnBoard(sq) && this.board[sq] === target) return sq;
    }
    return -1;
  }

  isAttacked(sq, byColor) {
    // Cavaliers
    for (const off of KNIGHT_OFFSETS) {
      const s = sq + off;
      if (isOnBoard(s)) {
        const p = this.board[s];
        if (p && colorOfPiece(p) === byColor && p.toLowerCase() === 'n') return true;
      }
    }
    // Roi
    for (const off of KING_OFFSETS) {
      const s = sq + off;
      if (isOnBoard(s)) {
        const p = this.board[s];
        if (p && colorOfPiece(p) === byColor && p.toLowerCase() === 'k') return true;
      }
    }
    // Pions
    const pawn = byColor === 'w' ? 'P' : 'p';
    const pawnDir = byColor === 'w' ? -16 : 16;
    for (const side of [-1, 1]) {
      const s = sq + pawnDir + side;
      if (isOnBoard(s) && this.board[s] === pawn) return true;
    }
    // Fous / dames
    for (const dir of BISHOP_DIRECTIONS) {
      let s = sq + dir;
      while (isOnBoard(s)) {
        const p = this.board[s];
        if (p) {
          const t = p.toLowerCase();
          if (colorOfPiece(p) === byColor && (t === 'b' || t === 'q')) return true;
          break;
        }
        s += dir;
      }
    }
    // Tours / dames
    for (const dir of ROOK_DIRECTIONS) {
      let s = sq + dir;
      while (isOnBoard(s)) {
        const p = this.board[s];
        if (p) {
          const t = p.toLowerCase();
          if (colorOfPiece(p) === byColor && (t === 'r' || t === 'q')) return true;
          break;
        }
        s += dir;
      }
    }
    return false;
  }

  inCheck(color) {
    const color2 = color || this.turn;
    const ks = this.kingSquare(color2);
    return ks >= 0 && this.isAttacked(ks, color2 === 'w' ? 'b' : 'w');
  }

  makeMove(move) {
    const undo = {
      captured: null,
      capturedSq: -1,
      castling: this.castling,
      ep: this.ep,
      halfmove: this.halfmove,
      promotedRook: null,
      rookFrom: -1,
      rookTo: -1,
    };
    const piece = this.board[move.from];
    const color = colorOfPiece(piece);
    undo.captured = move.epCapture ? this.board[move.epCaptureSq] : this.board[move.to];
    undo.capturedSq = move.epCapture ? move.epCaptureSq : move.to;

    this.ep = -1;
    if (move.epCapture) {
      this.board[move.epCaptureSq] = null;
      this.board[move.to] = piece;
      this.board[move.from] = null;
    } else if (move.castle) {
      this.board[move.to] = piece;
      this.board[move.from] = null;
      const rf = move.rookFrom, rt = move.rookTo;
      undo.rookFrom = rf; undo.rookTo = rt;
      this.board[rt] = this.board[rf];
      this.board[rf] = null;
    } else {
      this.board[move.to] = move.promotion ? move.promotion : piece;
      this.board[move.from] = null;
      if (move.promotion) undo.promotedRook = piece;
    }

    if (piece.toLowerCase() === 'p' || undo.captured) {
      this.halfmove = 0;
    } else {
      this.halfmove++;
    }
    if (move.double) {
      this.ep = (move.from + move.to) / 2;
    }
    if (piece === 'K') this.castling = this.castling.replace(/[KQ]/g, '');
    if (piece === 'k') this.castling = this.castling.replace(/[kq]/g, '');
    if (move.from === 7 || move.to === 7) this.castling = this.castling.replace('K', '');
    if (move.from === 0 || move.to === 0) this.castling = this.castling.replace('Q', '');
    if (move.from === 119 || move.to === 119) this.castling = this.castling.replace('k', '');
    if (move.from === 112 || move.to === 112) this.castling = this.castling.replace('q', '');

    if (this.turn === 'b') this.fullmove++;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    return undo;
  }

  undoMove(move, undo) {
    if (this.turn === 'w') this.fullmove--;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    this.castling = undo.castling;
    this.ep = undo.ep;
    this.halfmove = undo.halfmove;
    const piece = move.promotion ? undo.promotedRook : this.board[move.to];
    this.board[move.from] = piece;
    this.board[move.to] = null;
    if (move.castle) {
      this.board[undo.rookFrom] = this.board[undo.rookTo];
      this.board[undo.rookTo] = null;
    }
    if (undo.capturedSq >= 0 && undo.captured) {
      this.board[undo.capturedSq] = undo.captured;
    }
  }

  pseudoMoves(color) {
    const moves = [];
    for (let sq = 0; sq < 128; sq++) {
      if (!isOnBoard(sq)) continue;
      const piece = this.board[sq];
      if (!piece || colorOfPiece(piece) !== color) continue;
      const type = piece.toLowerCase();
      if (type === 'p') {
        const dir = color === 'w' ? 16 : -16;
        const startRank = color === 'w' ? 1 : 6;
        const promoRank = color === 'w' ? 7 : 0;
        const one = sq + dir;
        if (isOnBoard(one) && !this.board[one]) {
          this.addPawnMoves(moves, sq, one, piece, promoRank, false);
          if (rankOf(sq) === startRank) {
            const two = sq + 2 * dir;
            if (!this.board[two]) {
              moves.push({ from: sq, to: two, piece, double: true });
            }
          }
        }
        for (const side of [-1, 1]) {
          const t = sq + dir + side;
          if (!isOnBoard(t)) continue;
          const target = this.board[t];
          if (target && colorOfPiece(target) !== color) {
            this.addPawnMoves(moves, sq, t, piece, promoRank, true);
          } else if (t === this.ep) {
            moves.push({
              from: sq, to: t, piece, epCapture: true,
              epCaptureSq: t - dir,
            });
          }
        }
      } else if (type === 'n' || type === 'k') {
        const offsets = type === 'n' ? KNIGHT_OFFSETS : KING_OFFSETS;
        for (const off of offsets) {
          const t = sq + off;
          if (!isOnBoard(t)) continue;
          const target = this.board[t];
          if (!target || colorOfPiece(target) !== color) {
            moves.push({ from: sq, to: t, piece });
          }
        }
        if (type === 'k') {
          this.addCastling(moves, color);
        }
      } else {
        const dirs = type === 'b' ? BISHOP_DIRECTIONS
          : type === 'r' ? ROOK_DIRECTIONS
          : KING_OFFSETS;
        for (const dir of dirs) {
          let t = sq + dir;
          while (isOnBoard(t)) {
            const target = this.board[t];
            if (!target) {
              moves.push({ from: sq, to: t, piece });
              t += dir;
            } else {
              if (colorOfPiece(target) !== color) {
                moves.push({ from: sq, to: t, piece });
              }
              break;
            }
          }
        }
      }
    }
    return moves;
  }

  addPawnMoves(moves, from, to, piece, promoRank, isCapture) {
    if (rankOf(to) === promoRank) {
      for (const promo of ['q', 'r', 'b', 'n']) {
        moves.push({
          from, to, piece, promotion: colorOfPiece(piece) === 'w' ? promo.toUpperCase() : promo,
        });
      }
    } else {
      moves.push({ from, to, piece, capture: isCapture });
    }
  }

  addCastling(moves, color) {
    const ks = color === 'w' ? 4 : 116;
    const rights = color === 'w'
      ? { k: 'K', q: 'Q', rookK: 7, rookQ: 0 }
      : { k: 'k', q: 'q', rookK: 119, rookQ: 112 };
    const enemy = color === 'w' ? 'b' : 'w';
    if (!this.isAttacked(ks, enemy)) {
      if (this.castling.includes(rights.k)
        && !this.board[ks + 1] && !this.board[ks + 2]
        && this.board[rights.rookK] === (color === 'w' ? 'R' : 'r')
        && !this.isAttacked(ks + 1, enemy)
        && !this.isAttacked(ks + 2, enemy)) {
        moves.push({
          from: ks, to: ks + 2, piece: color === 'w' ? 'K' : 'k',
          castle: true, rookFrom: rights.rookK, rookTo: ks + 1,
        });
      }
      if (this.castling.includes(rights.q)
        && !this.board[ks - 1] && !this.board[ks - 2] && !this.board[ks - 3]
        && this.board[rights.rookQ] === (color === 'w' ? 'R' : 'r')
        && !this.isAttacked(ks - 1, enemy)
        && !this.isAttacked(ks - 2, enemy)) {
        moves.push({
          from: ks, to: ks - 2, piece: color === 'w' ? 'K' : 'k',
          castle: true, rookFrom: rights.rookQ, rookTo: ks - 1,
        });
      }
    }
  }

  legalMoves() {
    const result = [];
    const color = this.turn;
    const pseudo = this.pseudoMoves(color);
    for (const move of pseudo) {
      const undo = this.makeMove(move);
      const legal = !this.inCheck(color);
      this.undoMove(move, undo);
      if (legal) result.push(move);
    }
    return result;
  }

  isLegalMove(move) {
    const undo = this.makeMove(move);
    const legal = !this.inCheck(colorOfPiece(move.piece));
    this.undoMove(move, undo);
    return legal;
  }

  sanFor(move) {
    return this.buildSan(move);
  }

  isCheckmate() {
    return this.inCheck() && this.legalMoves().length === 0;
  }

  isStalemate() {
    return !this.inCheck() && this.legalMoves().length === 0;
  }

  moveNumber() {
    return this.fullmove;
  }
}

function moveKey(move) {
  return algebraic(move.from) + algebraic(move.to)
    + (move.promotion ? move.promotion.toLowerCase() : '');
}

/* SAN complet avec désambiguïsation et suffixe +/#. */
Game.prototype.buildSan = function (move) {
  if (move.castle) {
    var castleSan = move.to > move.from ? 'O-O' : 'O-O-O';
    var suffix0 = this.sanSuffix(move);
    return castleSan + suffix0;
  }
  var piece = this.board[move.from];
  var type = piece.toLowerCase();
  var isCapture = !!this.board[move.to];
  var san = '';
  if (type === 'p') {
    if (isCapture) san += 'abcdefgh'[fileOf(move.from)] + 'x';
    san += algebraic(move.to);
    if (move.promotion) san += '=' + move.promotion.toUpperCase();
  } else {
    san += type.toUpperCase();
    var others = [];
    for (const m of this.legalMoves()) {
      if (m.from !== move.from && m.to === move.to
        && this.board[m.from] === piece) {
        others.push(m.from);
      }
    }
    if (others.length) {
      const sameFile = others.some((s) => fileOf(s) === fileOf(move.from));
      const sameRank = others.some((s) => rankOf(s) === rankOf(move.from));
      if (!sameFile) san += 'abcdefgh'[fileOf(move.from)];
      else if (!sameRank) san += String(rankOf(move.from) + 1);
      else san += algebraic(move.from);
    }
    if (isCapture) san += 'x';
    san += algebraic(move.to);
  }
  return san + this.sanSuffix(move);
};

Game.prototype.sanSuffix = function (move) {
  const undo = this.makeMove(move);
  let suffix = '';
  if (this.inCheck()) {
    suffix = this.legalMoves().length === 0 ? '#' : '+';
  }
  this.undoMove(move, undo);
  return suffix;
};

/* Trouve un coup légal correspondant à un SAN (tolérant : +, #, x, !?, e.p.). */
Game.prototype.findSan = function (sanText) {
  const wanted = sanText.replace(/[+#!?]/g, '').replace(/e\.p\./i, '').replace(/0/g, 'O').trim();
  for (const move of this.legalMoves()) {
    const san = this.buildSan(move).replace(/[+#]/g, '');
    if (san === wanted) return move;
  }
  return null;
};

/* Perft pour le mode test. */
Game.prototype.perft = function (depth) {
  if (depth === 0) return 1;
  let nodes = 0;
  for (const move of this.legalMoves()) {
    const undo = this.makeMove(move);
    nodes += this.perft(depth - 1);
    this.undoMove(move, undo);
  }
  return nodes;
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    Game, START_FEN, algebraic, fromAlgebraic, moveKey,
    fileOf, rankOf, isOnBoard, colorOfPiece,
  };
}
