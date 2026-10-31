/**
 * Additional NEXUS TEST LAB workforce (takes the lab past 50 agents).
 * Every agent below writes a real module plus its tests, runs them, and commits.
 * Code is written with String.raw so escapes land in the generated files verbatim.
 */

export interface LabLead {
  key: string;
  role: string;
  name: string;
  team: string;
  reportsTo?: string;
  planTitle: string;
  planFile: string;
  plan: string;
  after: string[];
}

export interface LabModule {
  key: string;
  role: string;
  name: string;
  team: string;
  reportsTo: string;
  title: string;
  file: string;
  code: string;
  testFile: string;
  test: string;
  after: string[];
  message?: { to?: string; toRole?: string; body: string };
}

export const EXTRA_LEADS: LabLead[] = [
  { key: 'data-lead', role: 'team-lead', name: 'Data Lead', team: 'Data', planTitle: 'Data module plan', planFile: 'docs/plans/data.md', after: ['arch'],
    plan: '# Data plan\n\n- csv, stats, querystring, jsonpath, lru, priority queue, schema\n- every module ships with node:test coverage\n' },
  { key: 'sim-lead', role: 'game', name: 'Simulation Lead', team: 'Simulation', planTitle: 'Simulation module plan', planFile: 'docs/plans/simulation.md', after: ['arch'],
    plan: '# Simulation plan\n\n- vector2 → integrator (depends on vector2)\n- matrix, collision, seeded rng, state machine, pathfinding\n- timeline depends on ui/easing\n' },
];

const T = (imports: string, body: string) => String.raw`import { test } from 'node:test';
import assert from 'node:assert/strict';
` + imports + '\n\n' + body + '\n';

export const EXTRA_MODULES: LabModule[] = [
  // ───────── Data team ─────────
  {
    key: 'csv', role: 'backend', name: 'CSV Agent', team: 'Data', reportsTo: 'data-lead', title: 'CSV parser', after: ['data-plan'],
    file: 'src/data/csv.js', testFile: 'tests/csv.test.js',
    code: String.raw`export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function toObjects(rows) {
  const [header, ...rest] = rows;
  return rest.map((r) => Object.fromEntries(header.map((k, i) => [k, r[i]])));
}
`,
    test: T(String.raw`import { parseCsv, toObjects } from '../src/data/csv.js';`, String.raw`test('parses quoted fields with commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('a,b\n1,"x, ""y"""\n'), [['a', 'b'], ['1', 'x, "y"']]);
});
test('maps rows to objects', () => assert.deepEqual(toObjects(parseCsv('id,name\n7,Ada')), [{ id: '7', name: 'Ada' }]));`),
  },
  {
    key: 'stats', role: 'ml', name: 'Statistics Agent', team: 'Data', reportsTo: 'data-lead', title: 'Descriptive statistics', after: ['data-plan'],
    file: 'src/data/stats.js', testFile: 'tests/stats.test.js',
    code: String.raw`export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function stddev(xs) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
export function percentile(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  const i = (p / 100) * (s.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
`,
    test: T(String.raw`import { mean, median, stddev, percentile } from '../src/data/stats.js';`, String.raw`test('mean and median', () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});
test('stddev and percentiles', () => {
  assert.equal(stddev([2, 4, 4, 4, 5, 5, 7, 9]), 2);
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5], 100), 5);
});`),
  },
  {
    key: 'qs', role: 'api', name: 'Query Agent', team: 'Data', reportsTo: 'data-lead', title: 'Query-string codec', after: ['data-plan'],
    file: 'src/data/querystring.js', testFile: 'tests/querystring.test.js',
    code: String.raw`export function parse(qs) {
  const out = {};
  for (const part of qs.replace(/^\?/, '').split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    const key = decodeURIComponent(k);
    const val = decodeURIComponent(v.replace(/\+/g, ' '));
    out[key] = key in out ? [].concat(out[key], val) : val;
  }
  return out;
}

export function stringify(obj) {
  return Object.entries(obj)
    .flatMap(([k, v]) => [].concat(v).map((x) => encodeURIComponent(k) + '=' + encodeURIComponent(x)))
    .join('&');
}
`,
    test: T(String.raw`import { parse, stringify } from '../src/data/querystring.js';`, String.raw`test('parses repeated keys, plus-spaces and escapes', () => {
  assert.deepEqual(parse('?a=1&b=hello+world&a=2&c=%26'), { a: ['1', '2'], b: 'hello world', c: '&' });
});
test('stringifies arrays and escapes', () => assert.equal(stringify({ q: 'a b', t: ['x', 'y'] }), 'q=a%20b&t=x&t=y'));`),
  },
  {
    key: 'jsonpath', role: 'backend', name: 'JSON Path Agent', team: 'Data', reportsTo: 'data-lead', title: 'Deep get/set by path', after: ['data-plan'],
    file: 'src/data/jsonpath.js', testFile: 'tests/jsonpath.test.js',
    code: String.raw`const tokens = (path) => path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);

export function get(obj, path, fallback) {
  let cur = obj;
  for (const t of tokens(path)) {
    if (cur == null) return fallback;
    cur = cur[t];
  }
  return cur === undefined ? fallback : cur;
}

export function set(obj, path, value) {
  const ts = tokens(path);
  let cur = obj;
  ts.forEach((t, i) => {
    if (i === ts.length - 1) cur[t] = value;
    else {
      if (cur[t] == null) cur[t] = /^\d+$/.test(ts[i + 1]) ? [] : {};
      cur = cur[t];
    }
  });
  return obj;
}
`,
    test: T(String.raw`import { get, set } from '../src/data/jsonpath.js';`, String.raw`test('reads nested paths with array indexes', () => {
  assert.equal(get({ a: { b: [{ c: 5 }] } }, 'a.b[0].c'), 5);
  assert.equal(get({}, 'x.y', 'fallback'), 'fallback');
});
test('creates intermediate arrays and objects', () => {
  const o = set({}, 'a.list[1].v', 3);
  assert.ok(Array.isArray(o.a.list));
  assert.equal(get(o, 'a.list[1].v'), 3);
});`),
  },
  {
    key: 'lru', role: 'performance', name: 'Cache Agent', team: 'Data', reportsTo: 'data-lead', title: 'LRU cache', after: ['data-plan'],
    file: 'src/data/lru.js', testFile: 'tests/lru.test.js',
    code: String.raw`export class LRUCache {
  #max;
  #map = new Map();
  constructor(max) {
    this.#max = max;
  }
  get(key) {
    if (!this.#map.has(key)) return undefined;
    const v = this.#map.get(key);
    this.#map.delete(key);
    this.#map.set(key, v);
    return v;
  }
  set(key, value) {
    this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.#max) this.#map.delete(this.#map.keys().next().value);
    return this;
  }
  has(key) {
    return this.#map.has(key);
  }
  get size() {
    return this.#map.size;
  }
}
`,
    test: T(String.raw`import { LRUCache } from '../src/data/lru.js';`, String.raw`test('evicts the least recently used entry', () => {
  const c = new LRUCache(2);
  c.set('a', 1).set('b', 2);
  c.get('a');
  c.set('c', 3);
  assert.equal(c.has('b'), false);
  assert.equal(c.has('a'), true);
  assert.equal(c.size, 2);
});`),
  },
  {
    key: 'pq', role: 'backend', name: 'Queue Agent', team: 'Data', reportsTo: 'data-lead', title: 'Binary-heap priority queue', after: ['data-plan'],
    file: 'src/data/priorityQueue.js', testFile: 'tests/priorityQueue.test.js',
    code: String.raw`export class PriorityQueue {
  #h = [];
  #cmp;
  constructor(cmp = (a, b) => a - b) {
    this.#cmp = cmp;
  }
  get size() {
    return this.#h.length;
  }
  push(x) {
    const h = this.#h;
    h.push(x);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.#cmp(h[i], h[p]) >= 0) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }
  pop() {
    const h = this.#h;
    if (!h.length) return undefined;
    const top = h[0];
    const last = h.pop();
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.#cmp(h[l], h[m]) < 0) m = l;
        if (r < h.length && this.#cmp(h[r], h[m]) < 0) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}
`,
    test: T(String.raw`import { PriorityQueue } from '../src/data/priorityQueue.js';`, String.raw`const drain = (q) => { const out = []; while (q.size) out.push(q.pop()); return out; };
test('pops in ascending order', () => {
  const q = new PriorityQueue();
  for (const x of [5, 1, 4, 2, 3]) q.push(x);
  assert.deepEqual(drain(q), [1, 2, 3, 4, 5]);
});
test('supports custom comparators', () => {
  const q = new PriorityQueue((a, b) => b.p - a.p);
  for (const p of [1, 9, 4]) q.push({ p });
  assert.deepEqual(drain(q).map((x) => x.p), [9, 4, 1]);
});`),
  },
  {
    key: 'schema', role: 'database', name: 'Schema Agent', team: 'Data', reportsTo: 'data-lead', title: 'Schema validator', after: ['data-plan'],
    file: 'src/data/schema.js', testFile: 'tests/schema.test.js',
    code: String.raw`export function validate(value, schema, path = '$') {
  const errors = [];
  const t = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (schema.type && schema.type !== t) return [path + ': expected ' + schema.type + ', got ' + t];
  if (schema.type === 'object') {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(path + '.' + k + ': required');
    for (const [k, s] of Object.entries(schema.properties ?? {})) if (k in value) errors.push(...validate(value[k], s, path + '.' + k));
  }
  if (schema.type === 'array' && schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items, path + '[' + i + ']')));
  if (schema.type === 'string' && schema.minLength && value.length < schema.minLength) errors.push(path + ': shorter than ' + schema.minLength);
  if (schema.type === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.push(path + ': below ' + schema.minimum);
  return errors;
}
`,
    test: T(String.raw`import { validate } from '../src/data/schema.js';`, String.raw`const user = {
  type: 'object',
  required: ['name', 'age'],
  properties: { name: { type: 'string', minLength: 2 }, age: { type: 'number', minimum: 0 }, tags: { type: 'array', items: { type: 'string' } } },
};
test('accepts valid documents', () => assert.deepEqual(validate({ name: 'Ada', age: 36, tags: ['x'] }, user), []));
test('reports every violation with a path', () => {
  assert.deepEqual(validate({ name: 'A', age: -1, tags: [1] }, user), ['$.name: shorter than 2', '$.age: below 0', '$.tags[0]: expected string, got number']);
  assert.ok(validate({}, user).includes('$.name: required'));
});`),
  },

  // ───────── Simulation team ─────────
  {
    key: 'vector', role: '3d', name: 'Vector Agent', team: 'Simulation', reportsTo: 'sim-lead', title: '2D vector math', after: ['sim-plan'],
    file: 'src/sim/vector2.js', testFile: 'tests/vector2.test.js',
    message: { to: 'Physics Agent', body: 'vector2 is ready ({{commit}}): add/sub/scale/dot/length/normalize.' },
    code: String.raw`export const vec = (x, y) => ({ x, y });
export const add = (a, b) => vec(a.x + b.x, a.y + b.y);
export const sub = (a, b) => vec(a.x - b.x, a.y - b.y);
export const scale = (a, s) => vec(a.x * s, a.y * s);
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const length = (a) => Math.hypot(a.x, a.y);
export const normalize = (a) => {
  const l = length(a);
  return l ? scale(a, 1 / l) : vec(0, 0);
};
`,
    test: T(String.raw`import { add, dot, length, normalize, vec } from '../src/sim/vector2.js';`, String.raw`test('vector arithmetic', () => {
  assert.deepEqual(add(vec(1, 2), vec(3, 4)), vec(4, 6));
  assert.equal(length(vec(3, 4)), 5);
  assert.equal(dot(vec(1, 0), vec(0, 1)), 0);
  assert.ok(Math.abs(length(normalize(vec(7, -3))) - 1) < 1e-12);
});`),
  },
  {
    key: 'matrix', role: 'graphics', name: 'Matrix Agent', team: 'Simulation', reportsTo: 'sim-lead', title: 'Matrix operations', after: ['sim-plan'],
    file: 'src/sim/matrix.js', testFile: 'tests/matrix.test.js',
    code: String.raw`export const identity = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
export const transpose = (m) => m[0].map((_, j) => m.map((r) => r[j]));
export function multiply(a, b) {
  if (a[0].length !== b.length) throw new Error('dimension mismatch');
  return a.map((r) => b[0].map((_, j) => r.reduce((s, v, k) => s + v * b[k][j], 0)));
}
`,
    test: T(String.raw`import { identity, multiply, transpose } from '../src/sim/matrix.js';`, String.raw`test('multiplies matrices', () => {
  assert.deepEqual(multiply([[1, 2], [3, 4]], identity(2)), [[1, 2], [3, 4]]);
  assert.deepEqual(multiply([[1, 2], [3, 4]], [[5, 6], [7, 8]]), [[19, 22], [43, 50]]);
  assert.throws(() => multiply([[1, 2]], [[1, 2]]), /dimension/);
});
test('transposes', () => assert.deepEqual(transpose([[1, 2, 3]]), [[1], [2], [3]]));`),
  },
  {
    key: 'collision', role: 'physics', name: 'Collision Agent', team: 'Simulation', reportsTo: 'sim-lead', title: 'Collision detection', after: ['sim-plan'],
    file: 'src/sim/collision.js', testFile: 'tests/collision.test.js',
    code: String.raw`export const aabbIntersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const circleIntersects = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r;
export const pointInRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
`,
    test: T(String.raw`import { aabbIntersects, circleIntersects, pointInRect } from '../src/sim/collision.js';`, String.raw`test('boxes, circles and points', () => {
  assert.equal(aabbIntersects({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 }), true);
  assert.equal(aabbIntersects({ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 }), false);
  assert.equal(circleIntersects({ x: 0, y: 0, r: 1 }, { x: 1.5, y: 0, r: 1 }), true);
  assert.equal(pointInRect({ x: 5, y: 5 }, { x: 0, y: 0, w: 4, h: 4 }), false);
});`),
  },
  {
    key: 'rng', role: 'game', name: 'RNG Agent', team: 'Simulation', reportsTo: 'sim-lead', title: 'Seeded random numbers', after: ['sim-plan'],
    file: 'src/sim/rng.js', testFile: 'tests/rng.test.js',
    code: String.raw`export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randInt = (rand, min, max) => min + Math.floor(rand() * (max - min + 1));
export function shuffle(rand, xs) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
`,
    test: T(String.raw`import { mulberry32, randInt, shuffle } from '../src/sim/rng.js';`, String.raw`test('same seed, same sequence', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});
test('ranges and permutations', () => {
  const r = mulberry32(7);
  for (let i = 0; i < 1000; i++) { const n = randInt(r, 1, 6); assert.ok(n >= 1 && n <= 6); }
  assert.deepEqual(shuffle(r, [1, 2, 3, 4, 5]).sort(), [1, 2, 3, 4, 5]);
});`),
  },
  {
    key: 'integrator', role: 'physics', name: 'Physics Agent', team: 'Simulation', reportsTo: 'sim-lead', title: 'Physics integrator (uses vector2)', after: ['sim-plan', 'vector'],
    file: 'src/sim/integrator.js', testFile: 'tests/integrator.test.js',
    message: { to: 'Vector Agent', body: 'Pulled vector2 from main — integrator built on it ({{commit}}).' },
    code: String.raw`import { add, scale, vec } from './vector2.js';

export function step(body, dt, gravity = vec(0, -9.81)) {
  const v = add(body.v, scale(gravity, dt));
  return { ...body, v, p: add(body.p, scale(v, dt)) };
}

export function simulate(body, dt, steps, gravity) {
  let b = body;
  for (let i = 0; i < steps; i++) b = step(b, dt, gravity);
  return b;
}
`,
    test: T(String.raw`import { simulate } from '../src/sim/integrator.js';
import { vec } from '../src/sim/vector2.js';`, String.raw`test('free fall approximates ½gt²', () => {
  const b = simulate({ p: vec(0, 0), v: vec(0, 0) }, 0.001, 1000);
  assert.ok(Math.abs(b.p.y + 4.905) < 0.01, 'y=' + b.p.y);
});
test('constant velocity without gravity', () => {
  const b = simulate({ p: vec(0, 0), v: vec(10, 0) }, 0.01, 100, vec(0, 0));
  assert.ok(Math.abs(b.p.x - 10) < 1e-9);
});`),
  },
  {
    key: 'fsm', role: 'game', name: 'State Machine Agent', team: 'Simulation', reportsTo: 'sim-lead', title: 'Finite state machine', after: ['sim-plan'],
    file: 'src/sim/stateMachine.js', testFile: 'tests/stateMachine.test.js',
    code: String.raw`export function createMachine(config) {
  let state = config.initial;
  const listeners = [];
  return {
    get state() {
      return state;
    },
    can(event) {
      return Boolean(config.states[state]?.on?.[event]);
    },
    send(event) {
      const next = config.states[state]?.on?.[event];
      if (!next) return false;
      const prev = state;
      state = next;
      for (const l of listeners) l(prev, next, event);
      return true;
    },
    subscribe(fn) {
      listeners.push(fn);
    },
  };
}
`,
    test: T(String.raw`import { createMachine } from '../src/sim/stateMachine.js';`, String.raw`test('drives a match lifecycle', () => {
  const m = createMachine({ initial: 'kickoff', states: { kickoff: { on: { START: 'play' } }, play: { on: { GOAL: 'goal', WHISTLE: 'fulltime' } }, goal: { on: { RESTART: 'kickoff' } }, fulltime: {} } });
  const seen = [];
  m.subscribe((from, to) => seen.push(from + '>' + to));
  assert.equal(m.send('GOAL'), false);
  assert.equal(m.send('START'), true);
  assert.equal(m.send('GOAL'), true);
  assert.equal(m.send('RESTART'), true);
  assert.equal(m.state, 'kickoff');
  assert.deepEqual(seen, ['kickoff>play', 'play>goal', 'goal>kickoff']);
});`),
  },
  {
    key: 'path', role: 'ai', name: 'Pathfinding Agent', team: 'Simulation', reportsTo: 'sim-lead', title: 'Grid pathfinding (BFS)', after: ['sim-plan'],
    file: 'src/sim/pathfinding.js', testFile: 'tests/pathfinding.test.js',
    code: String.raw`export function shortestPath(grid, start, goal) {
  const h = grid.length;
  const w = grid[0].length;
  const key = (p) => p[0] + ',' + p[1];
  const prev = new Map([[key(start), null]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    if (cur[0] === goal[0] && cur[1] === goal[1]) {
      const path = [];
      for (let p = cur; p; p = prev.get(key(p))) path.unshift(p);
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [cur[0] + dx, cur[1] + dy];
      if (n[0] < 0 || n[1] < 0 || n[0] >= w || n[1] >= h || grid[n[1]][n[0]] === 1 || prev.has(key(n))) continue;
      prev.set(key(n), cur);
      queue.push(n);
    }
  }
  return null;
}
`,
    test: T(String.raw`import { shortestPath } from '../src/sim/pathfinding.js';`, String.raw`test('routes around walls', () => {
  const grid = [[0, 1, 0], [0, 1, 0], [0, 0, 0]];
  const path = shortestPath(grid, [0, 0], [2, 0]);
  assert.equal(path.length, 7);
  assert.deepEqual(path.at(-1), [2, 0]);
});
test('returns null when unreachable', () => assert.equal(shortestPath([[0, 1, 0]], [0, 0], [2, 0]), null));`),
  },
  {
    key: 'timeline', role: 'animation', name: 'Timeline Agent', team: 'Simulation', reportsTo: 'sim-lead', title: 'Keyframe timeline (uses ui/easing)', after: ['sim-plan', 'anim'],
    file: 'src/sim/timeline.js', testFile: 'tests/timeline.test.js',
    message: { to: 'Animation Agent', body: 'Building keyframes on easeInOutQuad — thanks for the fix ({{commit}}).' },
    code: String.raw`import { easeInOutQuad, linear } from '../ui/easing.js';

export function tween(from, to, t, ease = linear) {
  const k = Math.max(0, Math.min(1, t));
  return from + (to - from) * ease(k);
}

export function keyframes(frames, t) {
  if (t <= frames[0].t) return frames[0].v;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (t <= b.t) return tween(a.v, b.v, (t - a.t) / (b.t - a.t), easeInOutQuad);
  }
  return frames[frames.length - 1].v;
}
`,
    test: T(String.raw`import { keyframes, tween } from '../src/sim/timeline.js';`, String.raw`test('tweens linearly by default', () => assert.equal(tween(0, 10, 0.5), 5));
test('keyframes ease between frames', () => {
  const frames = [{ t: 0, v: 0 }, { t: 1, v: 100 }];
  assert.equal(keyframes(frames, 0.75), 87.5);
  assert.equal(keyframes(frames, 2), 100);
});`),
  },

  // ───────── Engineering: frontend additions ─────────
  {
    key: 'color', role: 'designer', name: 'Color Agent', team: 'Engineering', reportsTo: 'fe-lead', title: 'Colour conversion & mixing', after: ['fe-plan'],
    file: 'src/ui/color.js', testFile: 'tests/color.test.js',
    code: String.raw`export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (rgb) => '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
`,
    test: T(String.raw`import { hexToRgb, mix, rgbToHex } from '../src/ui/color.js';`, String.raw`test('round-trips hex colours', () => {
  assert.deepEqual(hexToRgb('#ff8000'), [255, 128, 0]);
  assert.deepEqual(hexToRgb('#fff'), [255, 255, 255]);
  assert.equal(rgbToHex([255, 128, 0]), '#ff8000');
});
test('mixes colours', () => assert.equal(rgbToHex(mix([0, 0, 0], [255, 255, 255], 0.5)), '#808080'));`),
  },
  {
    key: 'wrap', role: 'frontend', name: 'Typography Agent', team: 'Engineering', reportsTo: 'fe-lead', title: 'Text wrapping & truncation', after: ['fe-plan'],
    file: 'src/ui/text.js', testFile: 'tests/text.test.js',
    code: String.raw`export function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if ((line + ' ' + word).length <= width) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
export const truncate = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + '…');
`,
    test: T(String.raw`import { truncate, wrap } from '../src/ui/text.js';`, String.raw`test('wraps on word boundaries', () => assert.deepEqual(wrap('the quick brown fox jumps', 10), ['the quick', 'brown fox', 'jumps']));
test('truncates with an ellipsis', () => assert.equal(truncate('abcdef', 4), 'abc…'));`),
  },
  {
    key: 'i18n', role: 'frontend', name: 'i18n Agent', team: 'Engineering', reportsTo: 'fe-lead', title: 'Pluralisation & list formatting', after: ['fe-plan'],
    file: 'src/ui/i18n.js', testFile: 'tests/i18n.test.js',
    code: String.raw`export const plural = (n, forms) => (n === 1 ? forms.one : forms.other);
export const format = (n, forms) => n + ' ' + plural(n, forms);
export const listFormat = (items) => (items.length <= 1 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]);
`,
    test: T(String.raw`import { format, listFormat } from '../src/ui/i18n.js';`, String.raw`test('plural forms', () => {
  const agents = { one: 'agent', other: 'agents' };
  assert.equal(format(1, agents), '1 agent');
  assert.equal(format(50, agents), '50 agents');
});
test('list formatting', () => assert.equal(listFormat(['a', 'b', 'c']), 'a, b and c'));`),
  },
  {
    key: 'grid', role: 'frontend', name: 'Layout Agent', team: 'Engineering', reportsTo: 'fe-lead', title: 'Grid layout engine', after: ['fe-plan'],
    file: 'src/ui/grid.js', testFile: 'tests/grid.test.js',
    code: String.raw`export function gridPositions(count, cols, cell, gap = 0) {
  return Array.from({ length: count }, (_, i) => ({ x: (i % cols) * (cell.w + gap), y: Math.floor(i / cols) * (cell.h + gap) }));
}
export function gridSize(count, cols, cell, gap = 0) {
  const rows = Math.ceil(count / cols);
  const c = Math.min(count, cols);
  return { w: c * cell.w + (c - 1) * gap, h: rows * cell.h + (rows - 1) * gap };
}
`,
    test: T(String.raw`import { gridPositions, gridSize } from '../src/ui/grid.js';`, String.raw`test('places cells row-major with gaps', () => assert.deepEqual(gridPositions(5, 2, { w: 10, h: 5 }, 2)[3], { x: 12, y: 7 }));
test('computes the bounding size', () => assert.deepEqual(gridSize(5, 2, { w: 10, h: 5 }, 2), { w: 22, h: 19 }));`),
  },

  // ───────── Engineering: backend additions ─────────
  {
    key: 'ratelimit', role: 'backend', name: 'Rate Limit Agent', team: 'Engineering', reportsTo: 'be-lead', title: 'Token-bucket rate limiter', after: ['be-plan'],
    file: 'src/api/rateLimit.js', testFile: 'tests/rateLimit.test.js',
    code: String.raw`export class TokenBucket {
  constructor(capacity, refillPerSec, now = () => Date.now()) {
    this.capacity = capacity;
    this.rate = refillPerSec;
    this.now = now;
    this.tokens = capacity;
    this.last = now();
  }
  take(n = 1) {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
`,
    test: T(String.raw`import { TokenBucket } from '../src/api/rateLimit.js';`, String.raw`test('limits bursts and refills over time', () => {
  let t = 0;
  const b = new TokenBucket(2, 1, () => t);
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), false);
  t = 1000;
  assert.equal(b.take(), true);
});`),
  },
  {
    key: 'retry', role: 'backend', name: 'Resilience Agent', team: 'Engineering', reportsTo: 'be-lead', title: 'Retry with exponential backoff', after: ['be-plan'],
    file: 'src/api/retry.js', testFile: 'tests/retry.test.js',
    code: String.raw`export const backoffDelays = (attempts, baseMs = 100, capMs = 10000) => Array.from({ length: attempts }, (_, i) => Math.min(capMs, baseMs * 2 ** i));

export async function retry(fn, { attempts = 3, sleep = async () => {} } = {}) {
  const delays = backoffDelays(attempts);
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await sleep(delays[i]);
    }
  }
  throw lastError;
}
`,
    test: T(String.raw`import { backoffDelays, retry } from '../src/api/retry.js';`, String.raw`test('caps exponential delays', () => assert.deepEqual(backoffDelays(5, 100, 1000), [100, 200, 400, 800, 1000]));
test('retries until success and sleeps between attempts', async () => {
  const slept = [];
  const r = await retry(async (i) => { if (i < 2) throw new Error('flaky'); return 'ok'; }, { attempts: 3, sleep: async (ms) => slept.push(ms) });
  assert.equal(r, 'ok');
  assert.deepEqual(slept, [100, 200]);
});
test('gives up after the last attempt', async () => {
  await assert.rejects(retry(async () => { throw new Error('down'); }, { attempts: 2 }), /down/);
});`),
  },
  {
    key: 'semver', role: 'devops', name: 'Versioning Agent', team: 'Engineering', reportsTo: 'be-lead', title: 'Semantic version comparison', after: ['be-plan'],
    file: 'src/api/semver.js', testFile: 'tests/semver.test.js',
    code: String.raw`export function parse(v) {
  const m = String(v).match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/);
  if (!m) throw new Error('invalid version: ' + v);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null };
}
export function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}
export const sort = (versions) => [...versions].sort(compare);
`,
    test: T(String.raw`import { compare, parse, sort } from '../src/api/semver.js';`, String.raw`test('compares numerically, pre-releases first', () => {
  assert.equal(compare('1.2.3', '1.10.0'), -1);
  assert.equal(compare('2.0.0', '2.0.0-beta'), 1);
  assert.deepEqual(sort(['1.0.0', '0.9.9', '1.0.0-rc.1']), ['0.9.9', '1.0.0-rc.1', '1.0.0']);
});
test('rejects invalid versions', () => assert.throws(() => parse('x'), /invalid/));`),
  },
  {
    key: 'events', role: 'api', name: 'Events Agent', team: 'Engineering', reportsTo: 'be-lead', title: 'Typed event emitter', after: ['be-plan'],
    file: 'src/api/emitter.js', testFile: 'tests/emitter.test.js',
    code: String.raw`export class Emitter {
  #handlers = new Map();
  on(evt, fn) {
    if (!this.#handlers.has(evt)) this.#handlers.set(evt, new Set());
    this.#handlers.get(evt).add(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) {
    this.#handlers.get(evt)?.delete(fn);
  }
  once(evt, fn) {
    const off = this.on(evt, (...args) => {
      off();
      fn(...args);
    });
    return off;
  }
  emit(evt, ...args) {
    const hs = [...(this.#handlers.get(evt) ?? [])];
    for (const h of hs) h(...args);
    return hs.length;
  }
}
`,
    test: T(String.raw`import { Emitter } from '../src/api/emitter.js';`, String.raw`test('on, once and off', () => {
  const e = new Emitter();
  const got = [];
  const off = e.on('merge', (b) => got.push('on:' + b));
  e.once('merge', (b) => got.push('once:' + b));
  assert.equal(e.emit('merge', 'a'), 2);
  off();
  assert.equal(e.emit('merge', 'b'), 0);
  assert.deepEqual(got, ['on:a', 'once:a']);
});`),
  },

  // ───────── AI additions ─────────
  {
    key: 'fuzzy', role: 'ai', name: 'Fuzzy Match Agent', team: 'AI', reportsTo: 'ai-lead', title: 'Levenshtein fuzzy matching', after: ['ai-plan'],
    file: 'src/ai/levenshtein.js', testFile: 'tests/levenshtein.test.js',
    code: String.raw`export function distance(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
export const closest = (word, candidates) => candidates.reduce((best, c) => (distance(word, c) < distance(word, best) ? c : best));
`,
    test: T(String.raw`import { closest, distance } from '../src/ai/levenshtein.js';`, String.raw`test('edit distance', () => {
  assert.equal(distance('kitten', 'sitting'), 3);
  assert.equal(distance('', 'abc'), 3);
  assert.equal(distance('merge', 'merge'), 0);
});
test('finds the closest candidate', () => assert.equal(closest('agnt', ['angle', 'agent', 'merge']), 'agent'));`),
  },
  {
    key: 'trie', role: 'ml', name: 'Autocomplete Agent', team: 'AI', reportsTo: 'ai-lead', title: 'Trie autocomplete', after: ['ai-plan'],
    file: 'src/ai/trie.js', testFile: 'tests/trie.test.js',
    code: String.raw`const node = () => ({ children: new Map(), end: false });

export class Trie {
  #root = node();
  insert(word) {
    let n = this.#root;
    for (const ch of word) {
      if (!n.children.has(ch)) n.children.set(ch, node());
      n = n.children.get(ch);
    }
    n.end = true;
    return this;
  }
  has(word) {
    return Boolean(this.#find(word)?.end);
  }
  complete(prefix, limit = 10) {
    const out = [];
    const walk = (n, acc) => {
      if (out.length >= limit) return;
      if (n.end) out.push(acc);
      for (const [ch, child] of [...n.children].sort(([a], [b]) => a.localeCompare(b))) walk(child, acc + ch);
    };
    const start = this.#find(prefix);
    if (start) walk(start, prefix);
    return out;
  }
  #find(s) {
    let n = this.#root;
    for (const ch of s) {
      n = n.children.get(ch);
      if (!n) return null;
    }
    return n;
  }
}
`,
    test: T(String.raw`import { Trie } from '../src/ai/trie.js';`, String.raw`test('completes prefixes in order', () => {
  const t = new Trie().insert('agent').insert('agency').insert('age').insert('merge');
  assert.deepEqual(t.complete('age'), ['age', 'agency', 'agent']);
  assert.equal(t.has('agen'), false);
  assert.equal(t.has('merge'), true);
});`),
  },
  {
    key: 'diff', role: 'ai', name: 'Diff Agent', team: 'AI', reportsTo: 'ai-lead', title: 'LCS line diff', after: ['ai-plan'],
    file: 'src/ai/diff.js', testFile: 'tests/diff.test.js',
    code: String.raw`export function diffLines(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  const dp = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      ops.push(' ' + x[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push('-' + x[i++]);
    else ops.push('+' + y[j++]);
  }
  while (i < x.length) ops.push('-' + x[i++]);
  while (j < y.length) ops.push('+' + y[j++]);
  return ops;
}
`,
    test: T(String.raw`import { diffLines } from '../src/ai/diff.js';`, String.raw`test('produces a minimal line diff', () => assert.deepEqual(diffLines('a\nb\nc', 'a\nc\nd'), [' a', '-b', ' c', '+d']));
test('identical inputs have no changes', () => assert.deepEqual(diffLines('x', 'x'), [' x']));`),
  },
];

/** Cross-team regression suite written by the Regression Agent (QA). */
export const REGRESSION_TEST = String.raw`import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toObjects } from '../src/data/csv.js';
import { mean } from '../src/data/stats.js';
import { LRUCache } from '../src/data/lru.js';
import { vec } from '../src/sim/vector2.js';
import { simulate } from '../src/sim/integrator.js';
import { aabbIntersects } from '../src/sim/collision.js';
import { TokenBucket } from '../src/api/rateLimit.js';
import { distance } from '../src/ai/levenshtein.js';
import { keyframes } from '../src/sim/timeline.js';

test('data → stats pipeline', () => {
  const rows = toObjects(parseCsv('agent,score\na,3\nb,5\nc,7\n'));
  assert.equal(mean(rows.map((r) => Number(r.score))), 5);
});
test('simulation is deterministic and collides', () => {
  const b = simulate({ p: vec(0, 0), v: vec(1, 0) }, 0.01, 100, vec(0, 0));
  assert.ok(Math.abs(b.p.x - 1) < 1e-9);
  assert.ok(aabbIntersects({ x: b.p.x - 0.5, y: -0.5, w: 1, h: 1 }, { x: 1, y: 0, w: 1, h: 1 }));
});
test('caching and rate limiting', () => {
  const c = new LRUCache(1);
  c.set('k', 1);
  let t = 0;
  const bucket = new TokenBucket(1, 1, () => t);
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), false);
  t = 1000;
  assert.equal(bucket.take(), true);
  assert.equal(c.get('k'), 1);
});
test('fuzzy matching and eased animation', () => {
  assert.equal(distance('merge', 'merge'), 0);
  assert.equal(keyframes([{ t: 0, v: 0 }, { t: 1, v: 100 }], 0.75), 87.5);
});
`;

export const SECRETS_SCANNER = String.raw`import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const patterns = [/sk-ant-[\w-]{10,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /ghp_[A-Za-z0-9]{30,}/];
const files = [...walk('src'), ...walk('tests')];
const hits = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const p of patterns) if (p.test(text)) hits.push(f + ': matches ' + p);
}
console.log(hits.length ? hits.join('\n') : 'no secrets found in ' + files.length + ' files');
process.exit(hits.length ? 1 : 0);
`;
