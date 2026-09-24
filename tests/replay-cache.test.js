'use strict';
/*
 * 逐步折叠回放缓存（createReplayCache）单元测试：
 *   - 各步位置 / 朝向 / 叠层与无缓存 replay 完全一致
 *   - 往返拖动复用已算前缀（不重推演）
 *   - 网格 / 步骤 / 标注变化时只保留仍有效前缀
 *   - 方案身份（历史只读版本 / 草稿 / 载入新档）不同绝不串用
 *   - 非法折叠保留最后一个合法前缀与冲突纸格，往返拖动结果一致
 */
const test = require('node:test');
const assert = require('node:assert');
const E = require('../public/foldEngine.js');

// 2×2 骑马钉折帖：v1 向右折 + h1 向下折，收成 8 面单叠
const FOLD_V1 = { axis: 'v', line: 1, dir: 'r' };
const FOLD_H1 = { axis: 'h', line: 1, dir: 'd' };
const PLAN = () => ({
  rows: 2, cols: 2, labels: {}, steps: [
    { ...FOLD_V1 }, { ...FOLD_H1 }
  ]
});

function snapshotState(state) {
  return {
    stacks: Object.fromEntries(Object.entries(state.stacks)
      .map(([k, ids]) => [k, ids.slice()])),
    panels: Object.fromEntries(Object.entries(state.panels).map(([id, p]) =>
      [id, {
        cx: p.cx, cy: p.cy, front: p.front, back: p.back,
        frame: {
          x: { ...p.frame.x }, y: { ...p.frame.y }, n: { ...p.frame.n }
        }
      }]))
  };
}

test('逐步缓存：每一步都与直接 replay 同状态（位置/朝向/叠层/页码）', () => {
  const cache = E.createReplayCache();
  const plan = PLAN();
  plan.labels = { '0,0': { front: '4', back: '5' }, '1,1': { front: '7', back: '2' } };
  for (let upto = 0; upto <= plan.steps.length; upto++) {
    const got = cache.get(plan, upto);
    const want = E.replay(plan.rows, plan.cols, plan.labels, plan.steps, upto);
    assert.deepEqual(snapshotState(got.state), snapshotState(want.state));
    assert.equal(got.error, want.error);
  }
});

test('往返拖动：后续 upto 直接复用，实际推演数不再增加', () => {
  const cache = E.createReplayCache();
  const plan = PLAN();
  cache.get(plan, 2);
  assert.equal(cache.stats().computedFolds, 2);
  assert.equal(cache.stats().depth, 2);
  // 拖回 0、1，再拖到 2：全部命中已算状态
  for (const upto of [0, 1, 2, 1, 0, 2]) {
    const got = cache.get(plan, upto);
    const want = E.replay(plan.rows, plan.cols, {}, plan.steps, upto);
    assert.deepEqual(snapshotState(got.state), snapshotState(want.state));
  }
  assert.equal(cache.stats().computedFolds, 2, '往返拖动不应触发任何额外推演');
});

test('追加步骤：只推演新增折叠，旧前缀复用', () => {
  const cache = E.createReplayCache();
  const plan = PLAN();
  cache.get(plan, 2);
  assert.equal(cache.stats().computedFolds, 2);
  plan.steps.push(FOLD_V1);   // 2×2 两折后单叠，第三折非法（该侧无面片）——仅用于观察截断
  const got = cache.get(plan, 3);
  assert.equal(cache.stats().computedFolds, 2, '第三步非法时不产生新状态，推演数不变');
  assert.ok(got.error, '第三折应被标记为非法');
  assert.equal(got.error.stepIndex, 2);
});

test('步骤在中间改变：保留有效前缀，后缀重算', () => {
  const cache = E.createReplayCache();
  const plan = PLAN();
  cache.get(plan, 2);
  assert.equal(cache.stats().computedFolds, 2);

  // 把第一步方向改反（仍合法）：第 0 步保留，第 1 步起重算
  const changed = {
    rows: 2, cols: 2, labels: {}, steps: [
      { axis: 'v', line: 1, dir: 'l' },   // 原 dir 'r'
      { ...FOLD_H1 }
    ]
  };
  // 用同一 plan 对象承载“编辑”（模拟截断/重排），改 steps[0]
  plan.steps[0] = changed.steps[0];
  const got = cache.get(plan, 2);
  const want = E.replay(2, 2, {}, plan.steps, 2);
  assert.deepEqual(snapshotState(got.state), snapshotState(want.state));
  assert.equal(cache.stats().computedFolds, 4,
    '第 0 步几何签名改变：前缀截断到第 0 步，两步后缀全部重推演（2 + 2）');
  assert.equal(cache.stats().depth, 2);
});

test('截断步骤：前缀复用，变短后的缓存深度收缩', () => {
  const cache = E.createReplayCache();
  const plan = PLAN();
  cache.get(plan, 2);
  plan.steps.pop();
  const got = cache.get(plan, 1);
  const want = E.replay(2, 2, {}, plan.steps, 1);
  assert.deepEqual(snapshotState(got.state), snapshotState(want.state));
  assert.equal(cache.stats().depth, 1);
  assert.equal(cache.stats().computedFolds, 2, '截断不触发重推演');
  // 再追加新步：只推演新步
  plan.steps.push({ axis: 'h', line: 1, dir: 'u' });
  cache.get(plan, 2);
  assert.equal(cache.stats().computedFolds, 3, '只新增 1 次推演');
  const want2 = E.replay(2, 2, {}, plan.steps, 2);
  assert.deepEqual(snapshotState(cache.get(plan, 2).state), snapshotState(want2.state));
});

test('网格变化：缓存整体作废并按新网格重建', () => {
  const cache = E.createReplayCache();
  const plan = PLAN();
  cache.get(plan, 2);
  assert.equal(cache.stats().depth, 2);

  plan.rows = 1; plan.cols = 3;
  plan.steps = [{ axis: 'v', line: 1, dir: 'r' }];
  const got = cache.get(plan, 1);
  const want = E.replay(1, 3, {}, plan.steps, 1);
  assert.deepEqual(snapshotState(got.state), snapshotState(want.state));
  assert.equal(cache.stats().depth, 1);
  assert.equal(cache.stats().computedFolds, 1, '换网格后计数器随整体作废归零，新方案推演 1 次');
});

test('页码标注变化：几何前缀全部复用，各步显示新页码', () => {
  const cache = E.createReplayCache();
  const plan = PLAN();
  cache.get(plan, 2);
  // 原地改同一 labels 对象（前端 commitEditor 的写法）
  plan.labels['0,0'] = { front: '4', back: '5' };
  const computed = cache.stats().computedFolds;
  for (let upto = 0; upto <= 2; upto++) {
    const got = cache.get(plan, upto);
    const want = E.replay(2, 2, plan.labels, plan.steps, upto);
    assert.deepEqual(snapshotState(got.state), snapshotState(want.state));
    // 0,0 片在每一步都带新页码
    const p = got.state.panels['0,0'];
    assert.equal(p.front, '4');
    assert.equal(p.back, '5');
  }
  assert.equal(cache.stats().computedFolds, computed, '改标注不应重推演几何');
  // 删除标注后同样即时反映
  delete plan.labels['0,0'];
  const p = cache.get(plan, 2).state.panels['0,0'];
  assert.equal(p.front, '');
  assert.equal(p.back, '');
});

test('非法折叠：保留最后合法步与冲突位置，往返拖动结果一致', () => {
  const cache = E.createReplayCache();
  // 1×3：第 1 折 v1 向右（合法，2 层），第 2 折 v2 向左（1 层压 2 层，厚度冲突）
  const plan = {
    rows: 1, cols: 3, labels: {}, steps: [
      { axis: 'v', line: 1, dir: 'r' },
      { axis: 'v', line: 2, dir: 'l' }
    ]
  };
  // upto=2 遇到非法步：返回第 1 步状态 + 错误
  const r2 = cache.get(plan, 2);
  assert.ok(r2.error);
  assert.equal(r2.error.stepIndex, 1);
  assert.equal(r2.error.code, 'thickness');
  assert.deepEqual(r2.error.conflicts, ['2,0', '1,0']);
  const stalled = snapshotState(r2.state);
  const wantStalled = snapshotState(E.replay(1, 3, {}, plan.steps, 2).state);
  assert.deepEqual(stalled, wantStalled);
  assert.equal(cache.stats().breaksAt, 1);

  // 拖到非法步之后（upto=2）再拖回 0/1，再拖到 2：状态与错误逐次一致
  for (const upto of [0, 1, 2, 2, 1, 0, 2]) {
    const r = cache.get(plan, upto);
    const want = E.replay(1, 3, {}, plan.steps, upto);
    assert.deepEqual(snapshotState(r.state), snapshotState(want.state), `upto=${upto}`);
    assert.deepEqual(r.error, want.error, `upto=${upto} 错误一致`);
  }
  // 缓存的非法步状态：2 层叠于 1,0，2,0 仍为单层
  const s = cache.get(plan, 2).state;
  assert.deepEqual(s.stacks['1,0'].length, 2);
  assert.deepEqual(s.stacks['2,0'].length, 1);

  // 修正非法步骤：该 1×3 方案在第 1 折后不存在合法续折（两侧厚度天然不等），
  // 用同一 plan 对象改为另一套合法两步折法（竖线 1 左折）后错误应被清除、后缀重算。
  // 1×2 网格 + v1 向左折是合法单叠：网格同时改变（触发整体重建）。
  plan.rows = 1; plan.cols = 2;
  plan.steps = [{ axis: 'v', line: 1, dir: 'l' }];
  const fixed = cache.get(plan, 1);
  assert.equal(fixed.error, null);
  assert.equal(cache.stats().breaksAt, null);
  const wantFixed = E.replay(1, 2, {}, plan.steps, 1);
  assert.deepEqual(snapshotState(fixed.state), snapshotState(wantFixed.state));
});

test('非法步被截断移除后：break 清除，缩短的前缀仍可复用', () => {
  const cache = E.createReplayCache();
  const plan = {
    rows: 1, cols: 3, labels: {}, steps: [
      { axis: 'v', line: 1, dir: 'r' },
      { axis: 'v', line: 2, dir: 'l' }
    ]
  };
  cache.get(plan, 2);
  assert.equal(cache.stats().breaksAt, 1);
  plan.steps.pop();
  const r = cache.get(plan, 1);
  assert.equal(r.error, null);
  assert.equal(cache.stats().breaksAt, null);
  assert.equal(cache.stats().depth, 1);
});

test('非法步原地改为合法折：旧错误码/冲突位置不沿用，后缀重算', () => {
  const cache = E.createReplayCache();
  // 2×2：v1 向右折合法；第 2 步若为 v1 向左折则非法（折线两侧已无右侧纸瓣），
  // 改为 h1 向下折即收成单叠（合法）。
  const plan = {
    rows: 2, cols: 2, labels: {}, steps: [
      { axis: 'v', line: 1, dir: 'r' },
      { axis: 'v', line: 1, dir: 'l' }
    ]
  };
  const bad = cache.get(plan, 2);
  assert.ok(bad.error);
  assert.equal(bad.error.stepIndex, 1);
  assert.equal(bad.error.code, 'contour');

  plan.steps[1] = { axis: 'h', line: 1, dir: 'd' };
  const good = cache.get(plan, 2);
  assert.equal(good.error, null, '改正后的折法合法，不应沿用 contour 旧错误');
  const want = E.replay(2, 2, {}, plan.steps, 2);
  assert.deepEqual(snapshotState(good.state), snapshotState(want.state));
  assert.equal(cache.stats().breaksAt, null);

  // 往返拖动结果仍与直接 replay 一致
  for (const upto of [0, 1, 2, 1, 2]) {
    const r = cache.get(plan, upto);
    const w = E.replay(2, 2, {}, plan.steps, upto);
    assert.deepEqual(snapshotState(r.state), snapshotState(w.state));
    assert.deepEqual(r.error, w.error);
  }
});

test('方案身份隔离：历史只读版本与草稿（不同 plan 对象）绝不串用缓存', () => {
  const cache = E.createReplayCache();
  const draft = {
    rows: 1, cols: 2, labels: { '0,0': { front: 'A', back: 'B' } },
    steps: [{ axis: 'v', line: 1, dir: 'r' }]
  };
  const version = {
    rows: 1, cols: 2, labels: { '0,0': { front: 'X', back: 'Y' } },
    steps: [{ axis: 'v', line: 1, dir: 'r' }]
  };

  const draftGot = cache.get(draft, 1);
  assert.equal(draftGot.state.panels['0,0'].front, 'A');
  // 切换到历史版本：几何签名虽相同，但 plan 对象不同 → 重建，显示版本页码
  const verGot = cache.get(version, 1);
  assert.equal(verGot.state.panels['0,0'].front, 'X');
  assert.deepEqual(snapshotState(verGot.state),
    snapshotState(E.replay(1, 2, version.labels, version.steps, 1).state));
  // 返回草稿：再次重建，页码恢复为草稿
  const back = cache.get(draft, 1);
  assert.equal(back.state.panels['0,0'].front, 'A');
  // 叠层顺序也必须是各自方案的结果（本例几何一致，但缓存不得跨对象共享状态引用）
  assert.notStrictEqual(back.state, verGot.state);

  // 步骤数不同的两个方案对象：不得把长方案的缓存状态当作短方案结果
  const longer = {
    rows: 2, cols: 2, labels: {},
    steps: [{ ...FOLD_V1 }, { ...FOLD_H1 }]
  };
  const longGot = cache.get(longer, 2);
  assert.equal(Object.keys(longGot.state.stacks).length, 1);
  // 再回到只有 1 步的草稿：upto 不能误报单叠
  const oneStep = cache.get(draft, 1);
  assert.equal(Object.keys(oneStep.state.stacks).length, 1, '1×2 一折后也为单叠');
  const zeroStep = cache.get(draft, 0);
  assert.equal(Object.keys(zeroStep.state.stacks).length, 2, '草稿第 0 步应有 2 个格位');
});

test('reset()：显式清空后从头推演', () => {
  const cache = E.createReplayCache();
  const plan = PLAN();
  cache.get(plan, 2);
  assert.equal(cache.stats().depth, 2);
  cache.reset();
  assert.deepEqual(cache.stats(), { depth: 0, computedFolds: 0, breaksAt: null });
  cache.get(plan, 1);
  assert.equal(cache.stats().computedFolds, 1);
});

test('upto 越界/缺省钳制与 replay 行为一致', () => {
  const cache = E.createReplayCache();
  const plan = PLAN();
  assert.deepEqual(snapshotState(cache.get(plan, 99).state),
    snapshotState(E.replay(2, 2, {}, plan.steps).state));
  assert.deepEqual(snapshotState(cache.get(plan, -3).state),
    snapshotState(E.replay(2, 2, {}, plan.steps, 0).state));
  assert.deepEqual(snapshotState(cache.get(plan).state),
    snapshotState(E.replay(2, 2, {}, plan.steps, 2).state));
});
