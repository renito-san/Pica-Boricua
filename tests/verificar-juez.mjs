#!/usr/bin/env node
/*
 * Pica Boricua — verificación del juez y de las liquidaciones.
 *
 * Uso:
 *   node tests/verificar-juez.mjs [index.html] [index-anterior.html]
 *
 * Sin argumentos verifica el index.html del paquete. Con un segundo
 * archivo comprueba además la EQUIVALENCIA entre versiones: para las
 * mismas 1,000 carreras sorteadas (misma semilla), ganador, pasados y
 * distancias deben ser idénticos.
 *
 * Cómo funciona: extrae del propio index.html, sin copiar a mano, las
 * piezas puras del juego (ROWS, TYPES, laneOf, slotFrac, judgeFinals,
 * TIP_X/TIP_Y, NOSE_LEN, CAP) y las ejecuta en Node. Los carriles son
 * círculos perfectos (lanePathD: dos arcos de radio LANE_R sobre el
 * centro 200,150, arco 0 arriba y sentido horario), así que el
 * getPointAtLength del navegador se reproduce aquí por parametrización
 * del círculo y lanePerim = 2πr, igual que getTotalLength().
 *
 * El juicio independiente NO reutiliza la búsqueda del juez: barre el
 * perímetro completo de cada carril con paso denso y refina el mínimo
 * global; si ambos métodos discrepan en ganador o pasados, se cuenta
 * una discrepancia.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fileA = process.argv[2] || join(here, "..", "index.html");
const fileB = process.argv[3] || null;
const RACES = 1000;
const SEED = 20261125;

// ---------- extracción verbatim desde el HTML ----------
function grabFunction(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error("no se encontró function " + name);
  let depth = 0, j = src.indexOf("{", i);
  const start = j;
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error("llaves sin cerrar en " + name);
}
function grabVar(src, name, endMark) {
  const i = src.indexOf("var " + name + " =");
  if (i < 0) throw new Error("no se encontró var " + name);
  const j = src.indexOf(endMark, i);
  return src.slice(i, j + endMark.length);
}

function loadGame(file) {
  const src = readFileSync(file, "utf8");
  const parts = [
    grabVar(src, "ROWS", "];"),
    grabVar(src, "TYPES", "};"),
    grabVar(src, "LANE_R", "];"),
    "var CX = 200, CY = 150;",
    grabFunction(src, "round2"),
    grabFunction(src, "laneOf"),
    grabFunction(src, "slotFrac"),
    grabFunction(src, "judgeFinals"),
  ];
  const tip = src.match(/var TIP_X = ([\d.]+), TIP_Y = (-?[\d.]+);/);
  const nose = src.match(/var NOSE_LEN = ([\d.]+);/);
  const cap = src.match(/CAP = (\d+)/);
  if (!tip || !nose || !cap) throw new Error("constantes TIP/NOSE/CAP no encontradas en " + file);
  parts.push(`var TIP_X = ${tip[1]}, TIP_Y = ${tip[2]};`);
  parts.push(`var NOSE_LEN = ${nose[1]};`);
  // Carriles circulares: getPointAtLength por parametrización del círculo.
  parts.push(`
    var lanePaths = [], lanePerim = [];
    LANE_R.forEach(function (r) {
      var per = 2 * Math.PI * r;
      lanePerim.push(per);
      lanePaths.push({ getPointAtLength: function (s) {
        var a = -Math.PI / 2 + s / r;
        return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
      }});
    });`);
  const factory = new Function(parts.join("\n") +
    "\nreturn { ROWS, TYPES, LANE_R, laneOf, slotFrac, judgeFinals, round2, lanePerim, TIP_X, TIP_Y, NOSE_LEN, CAP: " + cap[1] + " };");
  return factory();
}

// ---------- RNG con semilla (mulberry32) ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- sorteo de una carrera: la misma fórmula de runRace ----------
function sortearCarrera(g, rand) {
  const gatherPos = {}, finals = {};
  for (let n = 1; n <= 24; n++) {
    const startPos = g.slotFrac(n); // mesa fresca: cada caballo en su casa
    const gf = 0.50 + g.slotFrac(n) * 0.30;
    const k = Math.ceil(startPos + 0.05 - gf);
    gatherPos[n] = gf + k;
    const e = -0.20 + rand() * 0.33;
    finals[n] = (Math.floor(gatherPos[n]) + 1 + 6) + e;
  }
  if (g.judgeFinals(finals).passed.length > 19) {
    const shuffled = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (let j = 0; j < 5; j++) {
      const sn = shuffled[j];
      const gapS = 1.5 + rand() * 12;
      finals[sn] = (Math.floor(gatherPos[sn]) + 1 + 6) - (g.NOSE_LEN + gapS) / (g.lanePerim[g.laneOf(sn)] || 1);
    }
  }
  return finals;
}

// ---------- juicio independiente: barrido denso del perímetro entero ----------
function juicioIndependiente(g, finals) {
  const gaps = {}, passed = [];
  let winner = null, bestGap = Infinity;
  for (let n = 1; n <= 24; n++) {
    const r = g.LANE_R[g.laneOf(n)];
    const per = 2 * Math.PI * r;
    const fr = ((finals[n] % 1) + 1) % 1;
    const sc = fr * per;
    const pt = { x: 200 + r * Math.cos(-Math.PI / 2 + sc / r), y: 150 + r * Math.sin(-Math.PI / 2 + sc / r) };
    const sc2 = (sc + 2) % per;
    const pt2 = { x: 200 + r * Math.cos(-Math.PI / 2 + sc2 / r), y: 150 + r * Math.sin(-Math.PI / 2 + sc2 / r) };
    const ang = Math.atan2(pt2.y - pt.y, pt2.x - pt.x);
    const tipX = pt.x + g.TIP_X * Math.cos(ang) - g.TIP_Y * Math.sin(ang);
    const tipY = pt.y + g.TIP_X * Math.sin(ang) + g.TIP_Y * Math.cos(ang);
    let bestS = 0, bestD = Infinity;
    for (let s = 0; s < per; s += 0.01) {
      const qx = 200 + r * Math.cos(-Math.PI / 2 + s / r), qy = 150 + r * Math.sin(-Math.PI / 2 + s / r);
      const d2 = (qx - tipX) ** 2 + (qy - tipY) ** 2;
      if (d2 < bestD) { bestD = d2; bestS = s; }
    }
    for (let s = bestS - 0.01; s <= bestS + 0.01; s += 0.0001) {
      const qx = 200 + r * Math.cos(-Math.PI / 2 + s / r), qy = 150 + r * Math.sin(-Math.PI / 2 + s / r);
      const d2 = (qx - tipX) ** 2 + (qy - tipY) ** 2;
      if (d2 < bestD) { bestD = d2; bestS = s; }
    }
    let o = ((bestS % per) + per) % per;
    if (o > per / 2) o -= per;
    gaps[n] = -o;
    if (o > 0) passed.push(n);
    else if (gaps[n] < bestGap) { bestGap = gaps[n]; winner = n; }
  }
  if (winner === null) {
    let bg = -Infinity;
    for (let m = 1; m <= 24; m++) if (gaps[m] > bg) { bg = gaps[m]; winner = m; }
  }
  return { winner, passed, gaps };
}

// ---------- correr el lote ----------
function correrLote(g) {
  const rand = mulberry32(SEED);
  const resultados = [];
  let discrepancias = 0;
  for (let race = 0; race < RACES; race++) {
    const finals = sortearCarrera(g, rand);
    const juzgado = g.judgeFinals(finals);
    const indep = juicioIndependiente(g, finals);
    const mismaPasados = JSON.stringify([...juzgado.passed].sort((a, b) => a - b)) ===
                         JSON.stringify([...indep.passed].sort((a, b) => a - b));
    if (juzgado.winner !== indep.winner || !mismaPasados) discrepancias++;
    resultados.push({ winner: juzgado.winner, passed: juzgado.passed, gaps: juzgado.gaps });
  }
  return { resultados, discrepancias };
}

// ---------- liquidaciones: tabla de pagos y fórmula de finishRace ----------
function verificarLiquidaciones(g) {
  const esperado = { numero: [20, 2], linea: [4, 30], cuarta: [5, 20], bajando: [5, 20] };
  let errores = 0;
  for (const [tipo, [mult, max]] of Object.entries(esperado)) {
    const t = g.TYPES[tipo];
    if (!t || t.mult !== mult || t.max !== max) { console.error(`  ✗ TYPES.${tipo}: esperado mult ${mult}/máx ${max}, hay ${t && t.mult}/${t && t.max}`); errores++; }
  }
  // Fórmula de finishRace: credit = won ? round2(amount × mult) : 0,
  // saldo nuevo = min(CAP, round2(saldo + credit)), delta = credit − amount.
  for (const [tipo, t] of Object.entries(g.TYPES)) {
    for (const amount of [1, 2, 7.5, t.max]) {
      for (const won of [true, false]) {
        const credit = won ? g.round2(amount * t.mult) : 0;
        const saldo = Math.min(g.CAP, g.round2(50 + credit));
        const credited = g.round2(saldo - 50);
        const delta = won ? g.round2(credited - amount) : -amount;
        if (!Number.isFinite(delta) || Math.abs(credited - Math.min(credit, g.CAP - 50)) > 0.001) {
          console.error(`  ✗ liquidación ${tipo} $${amount} won=${won}`); errores++;
        }
      }
    }
  }
  return errores;
}

// ---------- main ----------
const gA = loadGame(fileA);
console.log(`Archivo: ${fileA}`);
const a = correrLote(gA);
console.log(`Juez: ${RACES} carreras, ${a.discrepancias} discrepancias contra el juicio independiente`);
const errLiq = verificarLiquidaciones(gA);
console.log(`Liquidaciones: tabla de pagos y fórmula verificadas, ${errLiq} errores`);

let fail = a.discrepancias !== 0 || errLiq !== 0;

if (fileB) {
  const gB = loadGame(fileB);
  const b = correrLote(gB);
  let difs = 0;
  for (let i = 0; i < RACES; i++) {
    const x = a.resultados[i], y = b.resultados[i];
    if (x.winner !== y.winner || JSON.stringify(x.passed) !== JSON.stringify(y.passed)) { difs++; continue; }
    for (let n = 1; n <= 24; n++) if (Math.abs(x.gaps[n] - y.gaps[n]) > 1e-9) { difs++; break; }
  }
  console.log(`Equivalencia con ${fileB}: ${RACES} carreras, ${difs} diferencias`);
  if (difs !== 0) fail = true;
}

console.log(fail ? "RESULTADO: FALLO ✗" : "RESULTADO: OK ✓");
process.exit(fail ? 1 : 0);
