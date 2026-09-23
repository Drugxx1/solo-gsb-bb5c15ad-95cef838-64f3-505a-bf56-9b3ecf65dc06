'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/foldEngine.js');

const STEPS_2x2 = [
  { axis: 'v', line: 1, dir: 'r' },
  { axis: 'h', line: 1, dir: 'd' }
];

test('页边映射：前置条件——非法折/非单叠/坏网格均停止计算', () => {
  // 合法单叠
  assert.equal(E.edgeMapping(2, 2, {}, STEPS_2x2).ok, true);
  assert.equal(E.edgeEligibility(2, 2, {}, STEPS_2x2).ok, true);

  // 非单叠：2×3 只折一次仍是 4 个叠层
  let r = E.edgeMapping(2, 3, {}, [{ axis: 'v', line: 1, dir: 'r' }]);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not_single_stack');
  assert.equal(r.stackCount, 4);

  // 非法折叠（厚度冲突）
  r = E.edgeMapping(1, 3, {}, [
    { axis: 'v', line: 1, dir: 'r' },
    { axis: 'v', line: 2, dir: 'l' }
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'thickness');
  assert.equal(r.stepIndex, 1);
  assert.deepEqual(r.conflicts, ['2,0', '1,0']);

  // 网格非法
  r = E.edgeMapping(0, 2, {}, []);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'bad_grid');
});

test('页边映射：1×1 未折叠单叠——上下边可映射，书脊/前口为 null', () => {
  const r = E.edgeMapping(1, 1, {}, []);
  assert.equal(r.ok, true);
  assert.equal(r.leafCount, 1);
  assert.equal(r.depth, 1);
  assert.equal(r.capacity, 2);
  assert.equal(r.finalCell, '0,0');
  assert.equal(r.spine.axis, 'none');
  assert.equal(r.spine.side, null);
  assert.equal(r.spine.fold, null);
  assert.equal(r.spine.outwardDir, null);
  assert.equal(r.spine.foreDir, null);
  assert.equal(r.faces.length, 2);
  for (const f of r.faces) {
    assert.equal(f.edges.top.edge, 'top');
    assert.equal(f.edges.bottom.edge, 'bottom');
    assert.equal(f.edges.spine.edge, null);
    assert.equal(f.edges.fore.edge, null);
    assert.equal(f.upright, true);
    assert.equal(f.cell, '0,0');
  }
});

test('页边映射：1×2 竖折（脊在左）正反两面书脊边左右镜像，上/下边不变', () => {
  const r = E.edgeMapping(
    1, 2,
    { '0,0': { front: '4', back: '1' }, '1,0': { front: '2', back: '3' } },
    [{ axis: 'v', line: 1, dir: 'r' }]);
  assert.equal(r.ok, true);
  assert.equal(r.faces.length, 4);
  assert.equal(r.spine.axis, 'vertical');
  assert.equal(r.spine.side, 'left');
  assert.deepEqual(r.spine.outwardDir, { x: -1, y: 0 });
  assert.deepEqual(r.spine.foreDir, { x: 1, y: 0 });
  assert.deepEqual(r.spine.fold, { axis: 'v', line: 1, dir: 'r' });
  assert.equal(r.spine.foldIndex, 0);

  const get = (origin, face) => r.faces.find((f) => f.origin === origin && f.face === face);
  // 封面（slot1）：0,0 反面，正立，脊=左原始边
  const cover = r.faces[0];
  assert.equal(cover.slot, 1);
  assert.equal(cover.origin, '0,0');
  assert.equal(cover.face, 'back');
  assert.equal(cover.position, 'upper');
  assert.equal(cover.layer, 1);
  assert.equal(cover.depth, 2);
  assert.equal(cover.faceUp, true);
  assert.equal(cover.upright, true);
  assert.equal(cover.label, '1');
  assert.equal(cover.edges.top.edge, 'top');
  assert.equal(cover.edges.bottom.edge, 'bottom');
  assert.equal(cover.edges.spine.edge, 'left');
  assert.equal(cover.edges.fore.edge, 'right');

  // slot2：1,0 正面，脊=左
  const s2 = get('1,0', 'front');
  assert.equal(s2.slot, 2);
  assert.equal(s2.edges.spine.edge, 'left');
  assert.equal(s2.edges.fore.edge, 'right');
  // slot3：1,0 反面，反面长边镜像 → 脊=右
  const s3 = get('1,0', 'back');
  assert.equal(s3.position, 'lower');
  assert.equal(s3.faceUp, false);
  assert.equal(s3.edges.spine.edge, 'right');
  assert.equal(s3.edges.fore.edge, 'left');
  // 封底（slot4）：0,0 正面，脊=右
  const back = r.faces[3];
  assert.equal(back.slot, 4);
  assert.equal(back.origin, '0,0');
  assert.equal(back.face, 'front');
  assert.equal(back.label, '4');
  assert.equal(back.edges.spine.edge, 'right');
  assert.equal(back.edges.fore.edge, 'left');

  // 竖折不改变上下方向：所有面上下边保持原始上下边
  for (const f of r.faces) {
    assert.equal(f.edges.top.edge, 'top');
    assert.equal(f.edges.bottom.edge, 'bottom');
  }
});

test('页边映射：竖折向左时书脊在右缘，方向与右折相反', () => {
  const r = E.edgeMapping(1, 2, {}, [{ axis: 'v', line: 1, dir: 'l' }]);
  assert.equal(r.spine.side, 'right');
  assert.deepEqual(r.spine.outwardDir, { x: 1, y: 0 });
  const cover = r.faces[0];
  assert.equal(cover.edges.spine.edge, 'right');
  assert.equal(cover.edges.fore.edge, 'left');
});

test('页边映射：2×2 先竖后横——倒置面四边随坐标框 180° 变换，书脊取末次横折', () => {
  const r = E.edgeMapping(2, 2, {}, STEPS_2x2);
  assert.equal(r.spine.axis, 'horizontal');
  assert.equal(r.spine.side, 'top');
  assert.deepEqual(r.spine.outwardDir, { x: 0, y: -1 });
  assert.equal(r.spine.foldIndex, 1);
  assert.equal(r.finalCell, '1,1');

  // 倒置槽位 1,2,7,8：成品上边对应原始下边，且脊（成品上缘）对应原始下边
  const invertedSlots = [1, 2, 7, 8];
  for (const slot of invertedSlots) {
    const f = r.faces[slot - 1];
    assert.equal(f.upright, false);
    assert.equal(f.edges.top.edge, 'bottom');
    assert.equal(f.edges.bottom.edge, 'top');
    assert.equal(f.edges.spine.edge, 'bottom');
    assert.equal(f.edges.fore.edge, 'top');
  }
  // 正立槽位 3..6：上边=原始上边，脊（成品上缘）=原始上边
  for (const slot of [3, 4, 5, 6]) {
    const f = r.faces[slot - 1];
    assert.equal(f.upright, true);
    assert.equal(f.edges.top.edge, 'top');
    assert.equal(f.edges.bottom.edge, 'bottom');
    assert.equal(f.edges.spine.edge, 'top');
    assert.equal(f.edges.fore.edge, 'bottom');
  }
});

test('页边映射：水平末折向上时书脊在下缘', () => {
  const r = E.edgeMapping(2, 1, {}, [{ axis: 'h', line: 1, dir: 'u' }]);
  assert.equal(r.spine.axis, 'horizontal');
  assert.equal(r.spine.side, 'bottom');
  assert.deepEqual(r.spine.outwardDir, { x: 0, y: 1 });
});

test('页边映射：每个原始纸格恰出现正/反两行，槽位 1..2N 连续且层序一致', () => {
  const r = E.edgeMapping(2, 2, {}, STEPS_2x2);
  assert.deepEqual(r.faces.map((f) => f.slot), [1, 2, 3, 4, 5, 6, 7, 8]);
  const origins = {};
  for (const f of r.faces) {
    assert.match(f.origin, /^\d+,\d+$/);
    assert.ok(f.face === 'front' || f.face === 'back');
    assert.ok(f.layer >= 1 && f.layer <= f.depth);
    assert.equal(f.depth, 4);
    origins[f.origin] = origins[f.origin] || { front: 0, back: 0 };
    origins[f.origin][f.face]++;
    // 边向量为 0/±1；横折脊下四边退化为上/下两类（竖折脊则为左/右两类）
    const mapped = new Set(Object.values(f.edges).map((e) => e.edge));
    assert.ok(mapped.size === 2 || mapped.size === 4);
    const names = ['top', 'bottom', 'left', 'right'];
    for (const k of Object.keys(f.edges)) {
      const e = f.edges[k];
      assert.ok(names.includes(e.edge));
      assert.ok([0, 1, -1].includes(e.dirX));
      assert.ok([0, 1, -1].includes(e.dirY));
    }
  }
  assert.deepEqual(Object.keys(origins).sort(), ['0,0', '0,1', '1,0', '1,1']);
  for (const k of Object.keys(origins)) {
    assert.equal(origins[k].front, 1);
    assert.equal(origins[k].back, 1);
  }
});

test('页边映射：正反面同叶在竖折脊下书脊原始边左右相反（按面片坐标框镜像）', () => {
  // 2×2 末折为横折时左右不交换；改纯竖折 1×4 两折，末折仍竖 → 正/反书脊边镜像
  const steps = [
    { axis: 'v', line: 2, dir: 'r' },
    { axis: 'v', line: 3, dir: 'l' }
  ];
  const r = E.edgeMapping(1, 4, {}, steps);
  assert.equal(r.spine.axis, 'vertical');
  for (const origin of ['0,0', '1,0', '2,0', '3,0']) {
    const fr = r.faces.find((f) => f.origin === origin && f.face === 'front');
    const bk = r.faces.find((f) => f.origin === origin && f.face === 'back');
    assert.notEqual(fr.edges.spine.edge, bk.edges.spine.edge,
      `${origin} 正/反面书脊原始边应左右相反`);
    const opp = { left: 'right', right: 'left' };
    assert.equal(fr.edges.spine.edge, opp[bk.edges.spine.edge]);
    // 上/下边与面别无关
    assert.equal(fr.edges.top.edge, bk.edges.top.edge);
  }
});

test('页边映射：结果与阅读顺序槽位一致（label 对齐 pageSequence）', () => {
  const labels = {
    '0,0': { front: '4', back: '5' }, '1,0': { front: '6', back: '3' },
    '0,1': { front: '8', back: '1' }, '1,1': { front: '7', back: '2' }
  };
  const r = E.edgeMapping(2, 2, labels, STEPS_2x2);
  const { state } = E.replay(2, 2, labels, STEPS_2x2);
  const seq = E.pageSequence(state).stacks[0].sequence;
  assert.deepEqual(r.faces.map((f) => f.label), seq);
  // 封面/封底
  assert.equal(r.faces[0].label, '3');
  assert.equal(r.faces[7].label, '6');
});

test('页边映射：纯函数，不改写 labels/steps', () => {
  const labels = { '0,0': { front: '1', back: '2' } };
  const steps = STEPS_2x2.map((s) => ({ ...s }));
  const snapL = JSON.stringify(labels);
  const snapS = JSON.stringify(steps);
  E.edgeMapping(2, 2, labels, steps);
  assert.equal(JSON.stringify(labels), snapL);
  assert.equal(JSON.stringify(steps), snapS);
});
