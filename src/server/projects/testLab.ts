import type { ScriptStep } from '../../shared/types.js';
import type { Services } from '../services.js';

export const TEST_LAB_NAME = 'NEXUS TEST LAB';

/**
 * Built-in sample project. ~22 scripted (LLM-free) agents build a small real JavaScript
 * toolkit in parallel worktrees. Everything that happens is real: files, `node --test`
 * runs, commits, merges, a genuine bug that fails its tests (→ retry → auto-spawned
 * debugger → fix → recovery), a security-sensitive merge that waits for human approval,
 * and messages that carry real commit hashes. Short `sleep` steps pace the run so a
 * human can follow it; they produce no output.
 */

const w = (path: string, content: string): ScriptStep => ({ type: 'write', path, content });
const run = (command: string): ScriptStep => ({ type: 'run', command });
const commit = (message: string): ScriptStep => ({ type: 'commit', message });
const say = (body: string, to?: string, toRole?: string): ScriptStep => ({ type: 'message', body, to, toRole });
const pace = (ms: number): ScriptStep => ({ type: 'sleep', ms });

const FILES = {
  requirements: `# NEXUS Kit — Requirements\n\nA dependency-free toolkit used to exercise the NEXUS multi-agent workspace.\n\n| Module | Owner | Acceptance |\n|---|---|---|\n| core/result | Architect | ok/err helpers, tested |\n| ui/format | UI Agent | currency + table formatting |\n| ui/easing | Animation Agent | standard easing curves, continuous at 0.5 |\n| ui/contrast | Accessibility Agent | WCAG contrast ratio |\n| db/store | Database Agent | indexed in-memory store |\n| api/router | API Agent | method + path params routing |\n| security/sanitize | Security Agent | HTML escaping, identifier validation |\n| auth/token | Auth Agent | HMAC tokens with expiry (security review required) |\n| ai/* | AI team | tokenizer, similarity, evaluation |\n`,
  research: `# Research notes\n\n- Test runner: \`node --test\` (built in, zero deps, TAP output parsed by NEXUS).\n- Tokens: HMAC-SHA256 via node:crypto, constant-time comparison with timingSafeEqual.\n- Contrast: WCAG 2.x relative luminance formula.\n`,
  architecture: `# Architecture\n\n\`\`\`\nsrc/core      shared result helpers\nsrc/ui        formatting, easing, contrast\nsrc/db        storage\nsrc/api       routing\nsrc/security  sanitising\nsrc/auth      tokens\nsrc/ai        tokenizer, similarity, evaluation\n\`\`\`\n\nEvery module is an ES module with a colocated test in \`tests/\`.\n`,
  result: `export const ok = (value) => ({ ok: true, value });\nexport const err = (error) => ({ ok: false, error });\nexport function unwrap(r) {\n  if (!r.ok) throw new Error(String(r.error));\n  return r.value;\n}\n`,
  resultTest: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ok, err, unwrap } from '../src/core/result.js';\n\ntest('ok unwraps', () => assert.equal(unwrap(ok(3)), 3));\ntest('err throws', () => assert.throws(() => unwrap(err('boom')), /boom/));\n`,
  format: `export function formatCurrency(cents, currency = 'USD') {\n  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);\n}\n\nexport function padTable(rows) {\n  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));\n  return rows.map((r) => r.map((c, i) => String(c).padEnd(widths[i])).join(' | ')).join('\\n');\n}\n`,
  formatTest: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { formatCurrency, padTable } from '../src/ui/format.js';\n\ntest('formats cents as currency', () => assert.equal(formatCurrency(123456), '$1,234.56'));\ntest('pads table columns', () => assert.equal(padTable([['id', 'name'], [1, 'Ada']]), 'id | name\\n1  | Ada '));\n`,
  // A REAL bug: the second half of easeInOutQuad is wrong. Its own tests catch it.
  easingBuggy: `export const linear = (t) => t;\nexport const easeInQuad = (t) => t * t;\nexport const easeOutQuad = (t) => t * (2 - t);\nexport const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * t);\n`,
  easingFixed: `export const linear = (t) => t;\nexport const easeInQuad = (t) => t * t;\nexport const easeOutQuad = (t) => t * (2 - t);\nexport const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);\n`,
  easingTest: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { easeInOutQuad, easeInQuad, easeOutQuad, linear } from '../src/ui/easing.js';\n\ntest('endpoints', () => {\n  for (const f of [linear, easeInQuad, easeOutQuad, easeInOutQuad]) {\n    assert.equal(f(0), 0);\n    assert.equal(f(1), 1);\n  }\n});\ntest('easeInOutQuad is symmetric', () => assert.ok(Math.abs(easeInOutQuad(0.75) - 0.875) < 1e-9));\ntest('easeInOutQuad is continuous at 0.5', () => assert.ok(Math.abs(easeInOutQuad(0.4999) - easeInOutQuad(0.5001)) < 1e-3));\n`,
  contrast: `const channel = (c) => {\n  const s = c / 255;\n  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;\n};\nexport function luminance([r, g, b]) {\n  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);\n}\nexport function contrastRatio(a, b) {\n  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);\n  return (hi + 0.05) / (lo + 0.05);\n}\nexport const meetsAA = (a, b) => contrastRatio(a, b) >= 4.5;\n`,
  contrastTest: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { contrastRatio, meetsAA } from '../src/ui/contrast.js';\n\ntest('black on white is 21:1', () => assert.equal(Math.round(contrastRatio([0, 0, 0], [255, 255, 255])), 21));\ntest('light grey on white fails AA', () => assert.equal(meetsAA([200, 200, 200], [255, 255, 255]), false));\n`,
  store: `export class Store {\n  #rows = new Map();\n  #indexes = new Map();\n  constructor(indexed = []) {\n    for (const f of indexed) this.#indexes.set(f, new Map());\n  }\n  insert(row) {\n    if (row.id == null) throw new Error('row.id required');\n    this.#rows.set(row.id, row);\n    for (const [f, idx] of this.#indexes) {\n      const k = row[f];\n      if (!idx.has(k)) idx.set(k, new Set());\n      idx.get(k).add(row.id);\n    }\n    return row;\n  }\n  get(id) {\n    return this.#rows.get(id);\n  }\n  find(field, value) {\n    const idx = this.#indexes.get(field);\n    if (idx) return [...(idx.get(value) ?? [])].map((id) => this.#rows.get(id));\n    return [...this.#rows.values()].filter((r) => r[field] === value);\n  }\n  get size() {\n    return this.#rows.size;\n  }\n}\n`,
  storeTest: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { Store } from '../src/db/store.js';\n\ntest('insert, get and indexed find', () => {\n  const s = new Store(['team']);\n  s.insert({ id: 1, team: 'ui' });\n  s.insert({ id: 2, team: 'api' });\n  s.insert({ id: 3, team: 'ui' });\n  assert.equal(s.get(2).team, 'api');\n  assert.deepEqual(s.find('team', 'ui').map((r) => r.id), [1, 3]);\n  assert.equal(s.size, 3);\n});\ntest('requires id', () => assert.throws(() => new Store().insert({}), /id/));\n`,
  router: `export class Router {\n  #routes = [];\n  add(method, pattern, handler) {\n    const keys = [];\n    const re = new RegExp('^' + pattern.replace(/:(\\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');\n    this.#routes.push({ method, re, keys, handler });\n    return this;\n  }\n  handle(method, path) {\n    for (const r of this.#routes) {\n      if (r.method !== method) continue;\n      const m = path.match(r.re);\n      if (m) return r.handler(Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])));\n    }\n    return { status: 404 };\n  }\n}\n`,
  routerTest: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { Router } from '../src/api/router.js';\nimport { Store } from '../src/db/store.js';\n\ntest('routes GET /users/:id to the store', () => {\n  const users = new Store();\n  users.insert({ id: '7', name: 'Grace' });\n  const r = new Router().add('GET', '/users/:id', ({ id }) => ({ status: 200, body: users.get(id) }));\n  assert.deepEqual(r.handle('GET', '/users/7'), { status: 200, body: { id: '7', name: 'Grace' } });\n  assert.equal(r.handle('POST', '/users/7').status, 404);\n});\n`,
  sanitize: `const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };\nexport const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => MAP[c]);\nexport const isSafeIdentifier = (s) => /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(s);\n`,
  sanitizeTest: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { escapeHtml, isSafeIdentifier } from '../src/security/sanitize.js';\n\ntest('escapes HTML', () => assert.equal(escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;'));\ntest('rejects unsafe identifiers', () => {\n  assert.equal(isSafeIdentifier('user_name'), true);\n  assert.equal(isSafeIdentifier('../etc'), false);\n});\n`,
  token: `import { createHmac, timingSafeEqual } from 'node:crypto';\n\nconst b64 = (s) => Buffer.from(s).toString('base64url');\n\nexport function sign(payload, secret, ttlSec = 3600, now = Date.now()) {\n  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSec }));\n  const sig = createHmac('sha256', secret).update(body).digest('base64url');\n  return body + '.' + sig;\n}\n\nexport function verify(token, secret, now = Date.now()) {\n  const [body, sig] = String(token).split('.');\n  if (!body || !sig) return null;\n  const expected = createHmac('sha256', secret).update(body).digest();\n  const given = Buffer.from(sig, 'base64url');\n  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;\n  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());\n  return payload.exp * 1000 > now ? payload : null;\n}\n`,
  tokenTest: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sign, verify } from '../src/auth/token.js';\n\ntest('round-trips a payload', () => assert.equal(verify(sign({ sub: 'ada' }, 'k'), 'k').sub, 'ada'));\ntest('rejects tampering and wrong keys', () => {\n  const t = sign({ sub: 'ada' }, 'k');\n  assert.equal(verify(t, 'other'), null);\n  assert.equal(verify(t.slice(0, -2) + 'xx', 'k'), null);\n});\ntest('expires', () => assert.equal(verify(sign({}, 'k', 1, 0), 'k', 5000), null));\n`,
  tokenizer: `export const tokenize = (text) => String(text).toLowerCase().match(/[a-z0-9]+/g) ?? [];\nexport function termFrequency(tokens) {\n  const tf = new Map();\n  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);\n  return tf;\n}\n`,
  tokenizerTest: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { tokenize, termFrequency } from '../src/ai/tokenizer.js';\n\ntest('tokenizes words', () => assert.deepEqual(tokenize('Hello, NEXUS agents!'), ['hello', 'nexus', 'agents']));\ntest('counts terms', () => assert.equal(termFrequency(['a', 'b', 'a']).get('a'), 2));\n`,
  similarity: `export function cosine(a, b) {\n  let dot = 0, na = 0, nb = 0;\n  for (const [k, v] of a) { dot += v * (b.get(k) ?? 0); na += v * v; }\n  for (const v of b.values()) nb += v * v;\n  return na && nb ? dot / Math.sqrt(na * nb) : 0;\n}\n`,
  similarityTest: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { cosine } from '../src/ai/similarity.js';\n\ntest('identical vectors have similarity 1', () => {\n  const v = new Map([['a', 1], ['b', 2]]);\n  assert.ok(Math.abs(cosine(v, v) - 1) < 1e-9);\n});\ntest('orthogonal vectors have similarity 0', () => assert.equal(cosine(new Map([['a', 1]]), new Map([['b', 1]])), 0));\n`,
  // Depends on two other agents' merged work (tokenizer + similarity).
  evaluation: `import { tokenize, termFrequency } from './tokenizer.js';\nimport { cosine } from './similarity.js';\n\nexport function rank(query, docs) {\n  const q = termFrequency(tokenize(query));\n  return docs.map((d, i) => ({ i, score: cosine(q, termFrequency(tokenize(d))) })).sort((a, b) => b.score - a.score);\n}\n\nexport function precisionAtK(ranked, relevant, k) {\n  const top = ranked.slice(0, k).map((r) => r.i);\n  return top.filter((i) => relevant.includes(i)).length / k;\n}\n`,
  evaluationTest: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { rank, precisionAtK } from '../src/ai/eval.js';\n\ntest('ranks relevant documents first', () => {\n  const docs = ['merge queue tests', 'football physics', 'git merge conflicts'];\n  const ranked = rank('git merge', docs);\n  assert.equal(ranked[0].i, 2);\n  assert.equal(precisionAtK(ranked, [0, 2], 2), 1);\n});\n`,
  integration: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { formatCurrency } from '../src/ui/format.js';\nimport { easeInOutQuad } from '../src/ui/easing.js';\nimport { meetsAA } from '../src/ui/contrast.js';\nimport { Router } from '../src/api/router.js';\nimport { Store } from '../src/db/store.js';\nimport { escapeHtml } from '../src/security/sanitize.js';\nimport { rank } from '../src/ai/eval.js';\n\ntest('modules from six agents work together', () => {\n  const products = new Store(['tag']);\n  products.insert({ id: 'p1', name: '<Ball>', cents: 1999, tag: 'sport' });\n  const api = new Router().add('GET', '/products/:id', ({ id }) => {\n    const p = products.get(id);\n    return { status: 200, html: escapeHtml(p.name) + ' ' + formatCurrency(p.cents) };\n  });\n  assert.equal(api.handle('GET', '/products/p1').html, '&lt;Ball&gt; $19.99');\n  assert.equal(easeInOutQuad(0.5), 0.5);\n  assert.equal(meetsAA([0, 0, 0], [255, 255, 255]), true);\n  assert.equal(rank('sport ball', ['tennis', 'sport ball'])[0].i, 1);\n});\n`,
  bench: `import { Store } from '../src/db/store.js';\nimport { cosine } from '../src/ai/similarity.js';\n\nexport function benchStore(n = 20000) {\n  const s = new Store(['bucket']);\n  const t0 = performance.now();\n  for (let i = 0; i < n; i++) s.insert({ id: i, bucket: i % 16 });\n  const found = s.find('bucket', 3).length;\n  return { n, found, ms: performance.now() - t0 };\n}\n\nexport function benchCosine(n = 2000) {\n  const v = new Map(Array.from({ length: 200 }, (_, i) => ['t' + i, i]));\n  const t0 = performance.now();\n  for (let i = 0; i < n; i++) cosine(v, v);\n  return { n, ms: performance.now() - t0 };\n}\n\nif (import.meta.url === 'file://' + process.argv[1]) console.log(JSON.stringify({ store: benchStore(), cosine: benchCosine() }));\n`,
  perfTest: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { benchStore, benchCosine } from '../scripts/bench.js';\n\ntest('store inserts 20k indexed rows under 1s', () => {\n  const r = benchStore();\n  assert.equal(r.found, 1250);\n  assert.ok(r.ms < 1000, 'took ' + r.ms + 'ms');\n});\ntest('cosine similarity stays fast', () => assert.ok(benchCosine().ms < 1000));\n`,
  build: `import { createHash } from 'node:crypto';\nimport { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\n\nconst walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));\nconst modules = walk('src').filter((f) => f.endsWith('.js')).sort();\nconst manifest = modules.map((f) => ({ file: f, bytes: statSync(f).size, sha256: createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 16) }));\nmkdirSync('dist', { recursive: true });\nwriteFileSync('dist/manifest.json', JSON.stringify({ name: 'nexus-kit', modules: manifest }, null, 2));\nconsole.log('built ' + manifest.length + ' modules → dist/manifest.json');\n`,
  lint: `import { readdirSync, readFileSync, statSync } from 'node:fs';\nimport { join } from 'node:path';\n\nconst walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));\nlet problems = 0;\nfor (const f of walk('src').filter((x) => x.endsWith('.js'))) {\n  const src = readFileSync(f, 'utf8');\n  if (/\\t/.test(src)) { console.error(f + ': tab character'); problems++; }\n  if (/[ ]+$/m.test(src)) { console.error(f + ': trailing whitespace'); problems++; }\n  if (!/export /.test(src)) { console.error(f + ': no exports'); problems++; }\n}\nconsole.log(problems ? problems + ' problem(s)' : 'lint clean');\nprocess.exit(problems ? 1 : 0);\n`,
  packageJson: `{\n  "name": "nexus-kit",\n  "version": "0.1.0",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "test": "node --test",\n    "lint": "node scripts/lint.js",\n    "build": "node scripts/build.js",\n    "bench": "node scripts/bench.js"\n  }\n}\n`,
  readme: `# NEXUS Kit\n\nBuilt in parallel by the NEXUS TEST LAB agent workforce — every module on its own branch,\nverified by \`node --test\`, merged through the NEXUS merge queue.\n\n\`\`\`bash\nnpm test        # unit + integration tests\nnpm run lint    # style checks\nnpm run build   # dist/manifest.json\nnpm run bench   # micro-benchmarks\n\`\`\`\n\nModules: core/result, ui/format, ui/easing, ui/contrast, db/store, api/router,\nsecurity/sanitize, auth/token, ai/tokenizer, ai/similarity, ai/eval.\n`,
};

interface LabAgent {
  key: string;
  role: string;
  name: string;
  team: string;
  lead?: boolean;
  reportsTo?: string;
}

interface LabTask {
  key: string;
  agent: string;
  title: string;
  description: string;
  after: string[];
  priority?: number;
  approval?: boolean;
  script: ScriptStep[];
  recovery?: ScriptStep[];
}

const AGENTS: LabAgent[] = [
  { key: 'pm', role: 'project-manager', name: 'Product Manager', team: 'Product', lead: true },
  { key: 'research', role: 'research', name: 'Research Agent', team: 'Product', reportsTo: 'pm' },
  { key: 'docs', role: 'docs', name: 'Documentation Agent', team: 'Product', reportsTo: 'pm' },
  { key: 'architect', role: 'architect', name: 'Architect', team: 'Engineering', lead: true },
  { key: 'fe-lead', role: 'team-lead', name: 'Frontend Lead', team: 'Engineering', reportsTo: 'architect' },
  { key: 'ui', role: 'frontend', name: 'UI Agent', team: 'Engineering', reportsTo: 'fe-lead' },
  { key: 'anim', role: 'animation', name: 'Animation Agent', team: 'Engineering', reportsTo: 'fe-lead' },
  { key: 'a11y', role: 'designer', name: 'Accessibility Agent', team: 'Engineering', reportsTo: 'fe-lead' },
  { key: 'be-lead', role: 'team-lead', name: 'Backend Lead', team: 'Engineering', reportsTo: 'architect' },
  { key: 'api', role: 'api', name: 'API Agent', team: 'Engineering', reportsTo: 'be-lead' },
  { key: 'db', role: 'database', name: 'Database Agent', team: 'Engineering', reportsTo: 'be-lead' },
  { key: 'sec', role: 'security', name: 'Security Agent', team: 'Engineering', reportsTo: 'be-lead' },
  { key: 'auth', role: 'backend', name: 'Auth Agent', team: 'Engineering', reportsTo: 'be-lead' },
  { key: 'ai-lead', role: 'team-lead', name: 'AI Lead', team: 'AI', lead: true },
  { key: 'ai', role: 'ai', name: 'AI Agent', team: 'AI', reportsTo: 'ai-lead' },
  { key: 'ml', role: 'ml', name: 'ML Agent', team: 'AI', reportsTo: 'ai-lead' },
  { key: 'eval', role: 'ai', name: 'Evaluation Agent', team: 'AI', reportsTo: 'ai-lead' },
  { key: 'test', role: 'test', name: 'Test Agent', team: 'QA', lead: true },
  { key: 'perf', role: 'performance', name: 'Performance Agent', team: 'QA', reportsTo: 'test' },
  { key: 'review', role: 'reviewer', name: 'Code Reviewer', team: 'QA', reportsTo: 'test' },
  { key: 'devops', role: 'devops', name: 'DevOps Agent', team: 'DevOps', lead: true },
];

const TASKS: LabTask[] = [
  { key: 'req', agent: 'pm', title: 'Write requirements', description: 'Module list, owners and acceptance criteria.', after: [], priority: 8,
    script: [w('docs/REQUIREMENTS.md', FILES.requirements), pace(600), commit('docs: requirements and acceptance criteria'), say('Requirements published on {{branch}} ({{commit}}). Architect, over to you.', undefined, 'architect')] },
  { key: 'research', agent: 'research', title: 'Research test runner & crypto', description: 'Evaluate node:test and node:crypto for the toolkit.', after: [], priority: 6,
    script: [w('docs/RESEARCH.md', FILES.research), pace(900), commit('docs: research notes'), say('Recommendation: node --test and HMAC-SHA256 with timingSafeEqual.', undefined, 'backend')] },
  { key: 'arch', agent: 'architect', title: 'Architecture & core scaffold', description: 'Module layout and shared core/result helpers with tests.', after: ['req'], priority: 9,
    script: [w('docs/ARCHITECTURE.md', FILES.architecture), w('src/core/result.js', FILES.result), w('tests/result.test.js', FILES.resultTest), pace(600), run('node --test tests/result.test.js'), commit('feat(core): result helpers and architecture'), { type: 'message', team: true, body: 'Architecture merged soon ({{commit}}). Leads: plan your modules against docs/ARCHITECTURE.md.' }] },
  { key: 'fe-plan', agent: 'fe-lead', title: 'Frontend module plan', description: 'Split UI work: formatting, easing, contrast.', after: ['arch'], priority: 7,
    script: [w('docs/plans/frontend.md', '# Frontend plan\n\n- ui/format → UI Agent\n- ui/easing → Animation Agent\n- ui/contrast → Accessibility Agent\n'), pace(500), commit('docs: frontend plan'), say('UI, Animation, Accessibility: your modules are assigned. Tests colocated in tests/.', 'UI Agent')] },
  { key: 'be-plan', agent: 'be-lead', title: 'Backend module plan', description: 'Split backend work: store, router, sanitize, auth.', after: ['arch'], priority: 7,
    script: [w('docs/plans/backend.md', '# Backend plan\n\n- db/store → Database Agent\n- api/router → API Agent (depends on store)\n- security/sanitize → Security Agent\n- auth/token → Auth Agent (security review before merge)\n'), pace(500), commit('docs: backend plan')] },
  { key: 'ai-plan', agent: 'ai-lead', title: 'AI module plan', description: 'Tokenizer, similarity, evaluation.', after: ['arch'], priority: 7,
    script: [w('docs/plans/ai.md', '# AI plan\n\n- ai/tokenizer → AI Agent\n- ai/similarity → ML Agent\n- ai/eval → Evaluation Agent (needs both merged)\n'), pace(500), commit('docs: ai plan')] },
  { key: 'ui', agent: 'ui', title: 'Currency & table formatting', description: 'src/ui/format.js with tests.', after: ['fe-plan'],
    script: [say('API endpoint /users/:id is missing — what shape will it return?', 'API Agent'), w('src/ui/format.js', FILES.format), w('tests/format.test.js', FILES.formatTest), pace(800), run('node --test tests/format.test.js'), commit('feat(ui): currency and table formatting')] },
  { key: 'anim', agent: 'anim', title: 'Easing curves', description: 'src/ui/easing.js: linear, quad in/out/in-out.', after: ['fe-plan'],
    script: [w('src/ui/easing.js', FILES.easingBuggy), w('tests/easing.test.js', FILES.easingTest), pace(700), run('node --test tests/easing.test.js'), commit('feat(ui): easing curves')],
    // Debugger: reproduce the failure first, then apply the minimal fix and prove it.
    recovery: [{ type: 'run', command: 'node --test tests/easing.test.js', allowFailure: true }, pace(600), w('src/ui/easing.js', FILES.easingFixed), run('node --test tests/easing.test.js'), commit('fix(ui): correct second half of easeInOutQuad'), say('Root cause: easeInOutQuad used 1-2(1-t)t for t≥0.5 (discontinuous). Fixed in {{commit}}.', 'Animation Agent')] },
  { key: 'a11y', agent: 'a11y', title: 'WCAG contrast utilities', description: 'src/ui/contrast.js with AA checks.', after: ['fe-plan'],
    script: [w('src/ui/contrast.js', FILES.contrast), w('tests/contrast.test.js', FILES.contrastTest), pace(900), run('node --test tests/contrast.test.js'), commit('feat(ui): WCAG contrast ratio')] },
  { key: 'db', agent: 'db', title: 'Indexed in-memory store', description: 'src/db/store.js with secondary indexes.', after: ['be-plan'], priority: 6,
    script: [w('src/db/store.js', FILES.store), w('tests/store.test.js', FILES.storeTest), pace(700), run('node --test tests/store.test.js'), commit('feat(db): indexed in-memory store'), say('Store merged-ready ({{commit}}): insert/get/find with indexes.', 'API Agent')] },
  { key: 'api', agent: 'api', title: 'Router with path params', description: 'src/api/router.js backed by the store.', after: ['be-plan', 'db'],
    script: [w('src/api/router.js', FILES.router), w('tests/router.test.js', FILES.routerTest), pace(700), run('node --test tests/router.test.js'), commit('feat(api): router with path params'), say('Endpoint /users/:id implemented. Commit {{commit}}. Returns {status, body}.', 'UI Agent')] },
  { key: 'sec', agent: 'sec', title: 'Sanitisation helpers', description: 'HTML escaping and identifier validation.', after: ['be-plan'],
    script: [w('src/security/sanitize.js', FILES.sanitize), w('tests/sanitize.test.js', FILES.sanitizeTest), pace(600), run('node --test tests/sanitize.test.js'), commit('feat(security): sanitisation helpers')] },
  { key: 'auth', agent: 'auth', title: 'Signed tokens (security review)', description: 'HMAC tokens with expiry. Merge requires human approval.', after: ['be-plan'], approval: true,
    script: [w('src/auth/token.js', FILES.token), w('tests/token.test.js', FILES.tokenTest), pace(800), run('node --test tests/token.test.js'), commit('feat(auth): HMAC tokens with expiry'), say('Auth tokens ready ({{commit}}) — this merge needs a human security approval.', undefined, 'security')] },
  { key: 'tok', agent: 'ai', title: 'Tokenizer', description: 'src/ai/tokenizer.js.', after: ['ai-plan'],
    script: [w('src/ai/tokenizer.js', FILES.tokenizer), w('tests/tokenizer.test.js', FILES.tokenizerTest), pace(600), run('node --test tests/tokenizer.test.js'), commit('feat(ai): tokenizer and term frequency')] },
  { key: 'sim', agent: 'ml', title: 'Cosine similarity', description: 'src/ai/similarity.js.', after: ['ai-plan'],
    script: [w('src/ai/similarity.js', FILES.similarity), w('tests/similarity.test.js', FILES.similarityTest), pace(700), run('node --test tests/similarity.test.js'), commit('feat(ai): cosine similarity')] },
  { key: 'eval', agent: 'eval', title: 'Ranking evaluation', description: 'src/ai/eval.js — imports tokenizer + similarity from main.', after: ['tok', 'sim'],
    script: [say('Pulling tokenizer + similarity from main.', 'AI Lead'), w('src/ai/eval.js', FILES.evaluation), w('tests/eval.test.js', FILES.evaluationTest), pace(600), run('node --test tests/eval.test.js'), commit('feat(ai): ranking and precision@k')] },
  { key: 'int', agent: 'test', title: 'Integration tests', description: 'Cross-module test across six agents’ work.', after: ['ui', 'anim', 'a11y', 'api', 'sec', 'eval'], priority: 7,
    script: [w('tests/integration.test.js', FILES.integration), pace(600), run('node --test'), commit('test: cross-module integration'), { type: 'message', team: true, body: 'Integration tests started on main + {{branch}} — all modules green locally.' }] },
  { key: 'perf', agent: 'perf', title: 'Benchmarks & perf budget', description: 'scripts/bench.js and perf tests.', after: ['db', 'sim'],
    script: [w('scripts/bench.js', FILES.bench), w('tests/perf.test.js', FILES.perfTest), pace(600), run('node scripts/bench.js'), run('node --test tests/perf.test.js'), commit('perf: benchmarks with budgets')] },
  { key: 'review', agent: 'review', title: 'Code review of main', description: 'Read-only review: run the suite and inspect history.', after: ['int'],
    script: [run('git log --oneline -n 25'), run('npm test'), say('Review complete: suite green on {{branch}}; no blocking issues found.', 'Test Agent')] },
  { key: 'ops', agent: 'devops', title: 'Lint, build & release scripts', description: 'package.json scripts, lint and build manifest.', after: ['int', 'perf'], priority: 6,
    script: [w('package.json', FILES.packageJson), w('scripts/lint.js', FILES.lint), w('scripts/build.js', FILES.build), w('.gitignore', 'node_modules/\ndist/\n'), pace(500), run('npm run lint'), run('npm run build'), commit('build: lint, build and bench scripts'), { type: 'message', team: true, body: 'Build pipeline ready ({{commit}}): npm run lint && npm run build.' }] },
  { key: 'readme', agent: 'docs', title: 'Project README', description: 'Document the toolkit.', after: ['ops'], priority: 4,
    script: [w('README.md', FILES.readme), pace(500), commit('docs: README')] },
];

export async function seedTestLab(s: Services): Promise<string> {
  const existing = s.projects.list().find((p) => p.name === TEST_LAB_NAME);
  if (existing) return existing.id;
  const project = await s.projects.create({
    name: TEST_LAB_NAME,
    description: '22 scripted agents build a real toolkit in parallel worktrees — real tests, merges, a real bug, a debugger and an approval gate.',
    objective: 'Build NEXUS Kit: a tested, dependency-free JavaScript toolkit, with every module developed on its own agent branch.',
    settings: {
      defaultRuntime: 'scripted',
      maxConcurrentTasks: 6,
      testCommand: 'npm test',
      lintCommand: 'npm run lint --if-present',
      buildCommand: 'npm run build --if-present',
      integrationCommand: 'npm test',
      maxTaskAttempts: 2,
      autoDebug: true,
      autoMerge: true,
    },
    files: {
      'package.json': '{\n  "name": "nexus-kit",\n  "version": "0.0.0",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "test": "node --test"\n  }\n}\n',
      'README.md': '# NEXUS Kit\n\nScaffold — the agents will fill this in.\n',
      '.gitignore': 'node_modules/\n',
    },
  });
  const orch = await s.orchestrator.ensureOrchestrator(project.id);
  const teamIds = new Map<string, string>();
  for (const name of Array.from(new Set(AGENTS.map((a) => a.team)))) teamIds.set(name, s.teams.create(project.id, { name }).id);
  const ids = new Map<string, string>();
  for (const a of AGENTS) {
    const agent = await s.agents.spawn(project.id, {
      roleId: a.role,
      name: a.name,
      teamId: teamIds.get(a.team) ?? null,
      parentId: a.reportsTo ? ids.get(a.reportsTo) : orch.id,
      runtime: 'scripted',
      quiet: true,
    });
    ids.set(a.key, agent.id);
    if (a.lead) s.teams.update(teamIds.get(a.team)!, { leadAgentId: agent.id });
  }
  const taskIds = new Map<string, string>();
  for (const t of TASKS) {
    const task = s.tasks.create(
      project.id,
      {
        title: t.title,
        description: t.description,
        assignedAgentId: ids.get(t.agent)!,
        roleHint: AGENTS.find((a) => a.key === t.agent)!.role,
        dependsOn: t.after.map((k) => taskIds.get(k)!),
        priority: t.priority ?? 5,
        requiresApproval: t.approval,
        script: t.script,
        recovery: t.recovery ?? null,
      },
      { maxAttempts: 2 },
    );
    taskIds.set(t.key, task.id);
  }
  s.messages.system(project.id, `NEXUS TEST LAB ready: ${AGENTS.length + 1} agents, ${TASKS.length} tasks. Press RUN to start the workforce.`, { meta: { event: 'seed' } });
  return project.id;
}
