'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// 使用独立临时数据目录，避免污染开发环境
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-edge-'));
process.env.DATA_DIR = tmpData;
const app = require('../server.js');

const STEPS = [
  { axis: 'v', line: 1, dir: 'r' },
  { axis: 'h', line: 1, dir: 'd' }
];

let server, base;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpData, { recursive: true, force: true });
});

async function post(p, body) {
  const resp = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: resp.status, json: await resp.json() };
}

test('POST /api/edge-mapping：合法折帖返回书脊（末次折线）与逐面四边映射', async () => {
  const { status, json } = await post('/api/edge-mapping', {
    rows: 2, cols: 2, labels: {}, steps: STEPS
  });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.faces.length, 8);
  assert.equal(json.leafCount, 4);
  assert.equal(json.depth, 4);
  assert.equal(json.capacity, 8);
  assert.equal(json.finalCell, '1,1');
  assert.equal(json.spine.axis, 'horizontal');
  assert.equal(json.spine.side, 'top');
  assert.equal(json.spine.foldIndex, 1);
  assert.deepEqual(json.spine.fold, { axis: 'h', line: 1, dir: 'd' });
  for (const f of json.faces) {
    assert.match(f.origin, /^\d+,\d+$/);
    assert.ok(f.face === 'front' || f.face === 'back');
    for (const side of ['top', 'bottom']) {
      assert.ok(['top', 'bottom', 'left', 'right'].includes(f.edges[side].edge));
    }
    for (const side of ['spine', 'fore']) {
      assert.ok(['top', 'bottom', 'left', 'right'].includes(f.edges[side].edge));
    }
  }
  // 倒置槽位（1,2,7,8）成品上边对应原始下边
  for (const slot of [1, 2, 7, 8]) {
    assert.equal(json.faces[slot - 1].upright, false);
    assert.equal(json.faces[slot - 1].edges.top.edge, 'bottom');
  }
});

test('POST /api/edge-mapping：1×2 竖折脊正反面书脊边镜像；页码与槽位带出', async () => {
  const r = await post('/api/edge-mapping', {
    rows: 1, cols: 2,
    labels: { '0,0': { front: '4', back: '1' }, '1,0': { front: '2', back: '3' } },
    steps: [{ axis: 'v', line: 1, dir: 'r' }]
  });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.spine.side, 'left');
  assert.deepEqual(r.json.spine.outwardDir, { x: -1, y: 0 });
  assert.deepEqual(r.json.faces.map((f) => f.label), ['1', '2', '3', '4']);
  assert.equal(r.json.faces[0].edges.spine.edge, 'left');
  assert.equal(r.json.faces[3].edges.spine.edge, 'right');
  // 同叶 1,0 正/反书脊边相反
  const f2 = r.json.faces[1], f3 = r.json.faces[2];
  assert.equal(f2.origin, '1,0');
  assert.equal(f3.origin, '1,0');
  assert.notEqual(f2.edges.spine.edge, f3.edges.spine.edge);
});

test('POST /api/edge-mapping：1×1 未折叠单叠可计算，书脊/前口为 null', async () => {
  const r = await post('/api/edge-mapping', { rows: 1, cols: 1, labels: {}, steps: [] });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.spine.axis, 'none');
  assert.equal(r.json.spine.side, null);
  assert.equal(r.json.faces.length, 2);
  assert.equal(r.json.faces[0].edges.top.edge, 'top');
  assert.equal(r.json.faces[0].edges.spine.edge, null);
  assert.equal(r.json.faces[0].edges.fore.edge, null);
});

test('POST /api/edge-mapping：未收成单叠返回 not_single_stack', async () => {
  const r = await post('/api/edge-mapping', {
    rows: 2, cols: 3, labels: {},
    steps: [{ axis: 'v', line: 1, dir: 'r' }]
  });
  assert.equal(r.json.ok, false);
  assert.equal(r.json.error.code, 'not_single_stack');
});

test('POST /api/edge-mapping：非法折叠返回步号/冲突码，不产出 faces', async () => {
  const r = await post('/api/edge-mapping', {
    rows: 1, cols: 3, labels: {},
    steps: [
      { axis: 'v', line: 1, dir: 'r' },
      { axis: 'v', line: 2, dir: 'l' }
    ]
  });
  assert.equal(r.json.ok, false);
  assert.equal(r.json.error.code, 'thickness');
  assert.equal(r.json.error.stepIndex, 1);
  assert.deepEqual(r.json.error.conflicts, ['2,0', '1,0']);
  assert.equal(r.json.faces, undefined);
});

test('POST /api/edge-mapping：方案非法返回 400 bad_plan', async () => {
  const r = await post('/api/edge-mapping', { rows: 2, cols: 2, steps: [{ axis: 'z' }] });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'bad_plan');
});

test('POST /api/edge-mapping：只读，不改动方案存档（无持久化副作用）', async () => {
  const before = fs.readdirSync(tmpData).filter((f) => f.endsWith('.json')).length;
  await post('/api/edge-mapping', { rows: 1, cols: 2, labels: {},
    steps: [{ axis: 'v', line: 1, dir: 'r' }] });
  const after = fs.readdirSync(tmpData).filter((f) => f.endsWith('.json')).length;
  assert.equal(after, before);
});
