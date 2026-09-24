'use strict';
/*
 * 逐步回放缓存（createReplayCache）单元测试：
 *  - 语义与 replay() 完全一致（含非法步截断与冲突纸格）；
 *  - 往返拖动 / 播放复用已算步骤（不再重复折叠）；
 *  - 网格 / 页码 / 折叠步骤变化时只保留仍有效的前缀；
 *  - 草稿与历史版本只读视图（scope）互不串用缓存。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/foldEngine.js');

const L = (obj) => Object.fromEntries(
  Object.entries(obj).map(([k, [f, b]]) => [k, { front: f, back: b }]));

const LABELS_2x2 = L({
  '0,0': ['4', '5'], '1,0': ['6', '3'],
  '0,1': ['8', '1'], '1,1': ['7', '2']
});
// 2×2 四步全合法折法（先竖后横再竖再横，均等厚）
const STEPS_2x2 = [
  { axis: 'v', line: 1, dir: 'r' },
  { axis: 'h', line: 1, dir: 'd' }
];

/** 比较两个回放结果：状态（含页码）与错误完全一致。 */
function assertSameResult(a, b) {
  if (!a.error || !b.error) assert.equal(a.error, b.error);
  else {
    assert.equal(a.error.stepIndex, b.error.stepIndex);
    assert.equal(a.error.code, b.error.code);
    assert.equal(a.error.message, b.error.message);
    assert.deepEqual(a.error.conflicts, b.error.conflicts);
  }
  assert.equal(E.stateKey(a.state), E.stateKey(b.state));
  assert.deepEqual(JSON.stringify(E.pageSequence(a.state)), JSON.stringify(E.pageSequence(b.state)));
  // 页码（labels 烘焙在面片上）也须一致
  for (const id of Object.keys(a.state.panels)) {
    assert.equal(a.state.panels[id].front, b.state.panels[id].front);
    assert.equal(a.state.panels[id].back, b.state.panels[id].back);
  }
}

test('回放缓存：逐步结果与 replay() 一致，同一步返回同一状态对象', () => {
  const cache = E.createReplayCache();
  for (let upto = 0; upto <= STEPS_2x2.length; upto++) {
    const want = E.replay(2, 2, LABELS_2x2, STEPS_2x2, upto);
    const got = cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, upto, 'draft');
    assertSameResult(got, want);
  }
  // 画布与阅读顺序共享同一份步状态：同一步多次取回同一对象
  const s1 = cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, 1, 'draft').state;
  const s2 = cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, 1, 'draft').state;
  assert.equal(s1, s2);
});

test('回放缓存：往返拖动复用已算步骤，不再重复折叠', () => {
  const cache = E.createReplayCache();
  cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, STEPS_2x2.length, 'draft');
  const done = cache.stats();
  assert.equal(done.applies, 2);   // 两步各折叠一次
  // 往返拖动（含 0 与末步）不再触发任何新的折叠/校验
  for (const upto of [0, 1, 2, 1, 0, 2, 2, 1]) {
    cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, upto, 'draft');
  }
  const after = cache.stats();
  assert.equal(after.applies, done.applies);
  assert.equal(after.validates, done.validates);
  assert.equal(after.resets, done.resets);
});

// 2×4 三步全合法折法：竖折两次再横折一次，最终收成 8 层单叠
const STEPS_2x4 = [
  { axis: 'v', line: 2, dir: 'r' },
  { axis: 'v', line: 3, dir: 'r' },
  { axis: 'h', line: 1, dir: 'd' }
];

test('回放缓存：追加步骤只增量计算新步，截断不重算', () => {
  // 先确认三步全合法
  assert.equal(E.replay(2, 4, {}, STEPS_2x4).error, null);

  const cache = E.createReplayCache();
  // 纯追加：先回放前两步，再追加第三步 —— 只新算追加的一步
  cache.replayTo(2, 4, {}, STEPS_2x4.slice(0, 2), 2, 'draft');
  const two = cache.stats().applies;
  assert.equal(two, 2);
  const r3 = cache.replayTo(2, 4, {}, STEPS_2x4, 3, 'draft');
  assert.equal(r3.error, null);
  assert.equal(cache.stats().applies, two + 1);
  assertSameResult(r3, E.replay(2, 4, {}, STEPS_2x4, 3));

  // 截断到 1 步：全部复用，不再折叠
  const before = cache.stats().applies;
  cache.replayTo(2, 4, {}, STEPS_2x4.slice(0, 1), 1, 'draft');
  assert.equal(cache.stats().applies, before);
  // 再恢复完整序列：只补算被截掉的后缀两步
  cache.replayTo(2, 4, {}, STEPS_2x4, 3, 'draft');
  assert.equal(cache.stats().applies, before + 2);
});

test('回放缓存：中间修改步骤只重算其后的后缀', () => {
  // 把第 2 步改成横折（仍全合法）：前缀 [第1步] 保留，后两步重算
  const edited = [
    STEPS_2x4[0],
    { axis: 'h', line: 1, dir: 'd' },
    { axis: 'v', line: 3, dir: 'r' }
  ];
  assert.equal(E.replay(2, 4, {}, edited).error, null);

  const cache = E.createReplayCache();
  cache.replayTo(2, 4, {}, STEPS_2x4, 3, 'draft');
  const before = cache.stats().applies;   // 3

  const r = cache.replayTo(2, 4, {}, edited, 3, 'draft');
  assert.equal(r.error, null);
  assert.equal(cache.stats().applies, before + 2);
  assertSameResult(r, E.replay(2, 4, {}, edited, 3));
});

test('回放缓存：页码或网格变化时整体重算', () => {
  const cache = E.createReplayCache();
  cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, 2, 'draft');
  const s0 = cache.stats();

  // 页码变化：前缀不再有效，全部重算
  const labels2 = L({ '0,0': ['1', '1'] });
  cache.replayTo(2, 2, labels2, STEPS_2x2, 2, 'draft');
  const s1 = cache.stats();
  assert.equal(s1.resets, s0.resets + 1);
  assert.equal(s1.applies, s0.applies + 2);

  // 网格变化：同样整体重算
  cache.replayTo(1, 2, {}, [{ axis: 'v', line: 1, dir: 'r' }], 1, 'draft');
  const s2 = cache.stats();
  assert.equal(s2.resets, s1.resets + 1);
  assert.equal(s2.applies, s1.applies + 1);
});

test('回放缓存：历史版本只读视图与草稿不串用缓存', () => {
  const cache = E.createReplayCache();
  cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, 2, 'draft');
  const draftDone = cache.stats();

  // 切到只读版本视图（同一几何内容也必须整体重算，不串用草稿缓存）
  cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, 2, 'view:2');
  const inView = cache.stats();
  assert.equal(inView.resets, draftDone.resets + 1);
  assert.equal(inView.applies, draftDone.applies + 2);

  // 视图内往返拖动：复用视图自己的缓存
  cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, 0, 'view:2');
  cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, 2, 'view:2');
  assert.equal(cache.stats().applies, inView.applies);

  // 返回草稿：再次整体重算（不串用视图缓存，也不记得旧草稿缓存）
  cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, 2, 'draft');
  const back = cache.stats();
  assert.equal(back.resets, inView.resets + 1);
  assert.equal(back.applies, inView.applies + 2);
});

test('回放缓存：非法折叠保留前一合法步与原有冲突，往返拖动结果一致', () => {
  // 1×3：第一步合法，第二步厚度冲突，第三步（凑数）不会被执行
  const steps = [
    { axis: 'v', line: 1, dir: 'r' },
    { axis: 'v', line: 2, dir: 'l' },   // 1 层压向 2 层：厚度冲突
    { axis: 'v', line: 1, dir: 'r' }
  ];
  const cache = E.createReplayCache();
  const want = E.replay(1, 3, {}, steps, 3);
  assert.equal(want.error.code, 'thickness');

  const hit = cache.replayTo(1, 3, {}, steps, 3, 'draft');
  assertSameResult(hit, want);
  assert.equal(hit.error.stepIndex, 1);
  assert.deepEqual(hit.error.conflicts, ['2,0', '1,0']);

  // 非法步上的状态 = 前一合法步的状态（同一对象）
  const legal = cache.replayTo(1, 3, {}, steps, 1, 'draft');
  assert.equal(legal.error, null);
  assert.equal(hit.state, legal.state);

  // 越过非法步请求更深回放：仍是同一个错误与冲突
  const beyond = cache.replayTo(1, 3, {}, steps, 3, 'draft');
  assert.deepEqual(beyond.error, hit.error);
  assert.equal(beyond.state, hit.state);

  // 往返拖动后结果一致：冲突位置与状态对象不变
  cache.replayTo(1, 3, {}, steps, 0, 'draft');
  cache.replayTo(1, 3, {}, steps, 1, 'draft');
  const again = cache.replayTo(1, 3, {}, steps, 2, 'draft');
  assert.deepEqual(again.error, hit.error);
  assert.equal(again.state, hit.state);

  // 调用方改写返回的错误不会污染缓存
  again.error.conflicts.push('9,9');
  again.error.code = 'contour';
  const clean = cache.replayTo(1, 3, {}, steps, 2, 'draft');
  assert.equal(clean.error.code, 'thickness');
  assert.deepEqual(clean.error.conflicts, ['2,0', '1,0']);
});

test('回放缓存：stepStatuses 逐步标记非法步（相对最后合法状态）', () => {
  const steps = [
    { axis: 'v', line: 1, dir: 'r' },   // 合法
    { axis: 'v', line: 2, dir: 'l' },   // 厚度冲突（非法）
    { axis: 'v', line: 2, dir: 'l' }    // 相对最后合法状态仍非法
  ];
  const cache = E.createReplayCache();
  const statuses = cache.stepStatuses(1, 3, {}, steps, 'draft');
  assert.equal(statuses.length, 3);
  assert.equal(statuses[0], null);
  assert.equal(statuses[1].code, 'thickness');
  assert.equal(statuses[2].code, 'thickness');

  // 与手工“跳过非法步”链一致
  let st = E.initialState(1, 3, {});
  const manual = steps.map((s) => {
    const err = E.validateFold(st, s);
    if (!err) st = E.applyFold(st, s);
    return err;
  });
  assert.deepEqual(statuses.map((e) => (e ? e.code : null)), manual.map((e) => (e ? e.code : null)));

  // 全部合法时 statuses 全为 null，且与 replayTo 共用缓存（不重复折叠）
  const ok = E.createReplayCache();
  ok.replayTo(2, 2, LABELS_2x2, STEPS_2x2, 2, 'draft');
  const a0 = ok.stats().applies;
  const st2 = ok.stepStatuses(2, 2, LABELS_2x2, STEPS_2x2, 'draft');
  assert.deepEqual(st2, [null, null]);
  assert.equal(ok.stats().applies, a0);
});

test('回放缓存：步骤变化后 stepStatuses 前缀同样失效重算', () => {
  const cache = E.createReplayCache();
  const steps = [
    { axis: 'v', line: 1, dir: 'r' },
    { axis: 'h', line: 1, dir: 'd' }
  ];
  cache.stepStatuses(2, 2, LABELS_2x2, steps, 'draft');
  const v0 = cache.stats().validates;
  // 尾部追加：只校验新步
  cache.stepStatuses(2, 2, LABELS_2x2, steps.concat([{ axis: 'v', line: 1, dir: 'l' }]), 'draft');
  assert.equal(cache.stats().validates, v0 + 1);
  // 页码变化：全部重算
  cache.stepStatuses(2, 2, {}, steps, 'draft');
  assert.equal(cache.stats().validates, v0 + 1 + 2);
});

test('回放缓存：随机方案与 replay() 逐步对照', () => {
  // 可复现的伪随机序列
  let seed = 20260924;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const ri = (n) => Math.floor(rnd() * n);

  for (let round = 0; round < 30; round++) {
    const rows = 1 + ri(4);
    const cols = 1 + ri(4);
    const labels = {};
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (rnd() < 0.6) labels[`${x},${y}`] = { front: String(ri(50)), back: String(ri(50)) };
      }
    }
    const candidates = E.candidateSteps(rows, cols);
    const steps = [];
    const nSteps = ri(7);
    for (let i = 0; i < nSteps && candidates.length; i++) {
      steps.push(candidates[ri(candidates.length)]);
    }
    const cache = E.createReplayCache();
    // 随机往返访问若干次，每步都与 replay() 对照
    for (let visit = 0; visit < 12; visit++) {
      const upto = ri(steps.length + 1);
      const got = cache.replayTo(rows, cols, labels, steps, upto, 'draft');
      const want = E.replay(rows, cols, labels, steps, upto);
      assertSameResult(got, want);
    }
    // 中途改写一步（模拟编辑），再继续对照
    if (steps.length && candidates.length) {
      const at = ri(steps.length);
      steps[at] = candidates[ri(candidates.length)];
      for (let visit = 0; visit < 6; visit++) {
        const upto = ri(steps.length + 1);
        assertSameResult(cache.replayTo(rows, cols, labels, steps, upto, 'draft'),
          E.replay(rows, cols, labels, steps, upto));
      }
    }
  }
});

test('回放缓存：upto 缺省为全部步骤，越界自动钳制', () => {
  const cache = E.createReplayCache();
  const full = cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, null, 'draft');
  assert.equal(full.error, null);
  assertSameResult(full, E.replay(2, 2, LABELS_2x2, STEPS_2x2));
  const clamped = cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, 99, 'draft');
  assert.equal(clamped.state, full.state);
  const neg = cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, -3, 'draft');
  assertSameResult(neg, E.replay(2, 2, LABELS_2x2, STEPS_2x2, 0));
});

test('回放缓存：reset 后整体重算', () => {
  const cache = E.createReplayCache();
  cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, 2, 'draft');
  const s0 = cache.stats();
  cache.reset();
  assert.equal(cache.stats().cachedSteps, 0);
  cache.replayTo(2, 2, LABELS_2x2, STEPS_2x2, 2, 'draft');
  const s1 = cache.stats();
  assert.equal(s1.resets, s0.resets + 1);
  assert.equal(s1.applies, s0.applies + 2);
});
