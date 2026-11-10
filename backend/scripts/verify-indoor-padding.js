const assert = require('node:assert/strict');
const { indoorViewOptions, variantFor } = require('../src/renderOptions');
const f = (left, right, bottom, top, res) => ({ indoor: true, bounds: { left, right, bottom, top, res } });
assert.equal(typeof indoorViewOptions, 'function', 'indoorViewOptions must calculate padding');
const sample = [f(20, 100, -70, 0, .1)];
const before = JSON.stringify(sample);
const view = indoorViewOptions(sample);
assert.deepEqual(view, { coordBounds: { left: 20, right: 100, bottom: -70, top: 0 }, xlim: [16, 104], ylim: [-74, 4], renderPolicy: 'indoor-padding-v1' });
assert.deepEqual(indoorViewOptions([f(0, 2, 0, 1, 1)]).xlim, [-2, 4]);
assert.deepEqual(indoorViewOptions([f(0, 2, 0, 1, 1)]).ylim, [-2, 3]);
const layers = [f(-10, 10, -20, 0, .1), f(0, 30, -10, 10, 2)];
const batch = indoorViewOptions(layers);
assert.deepEqual(batch.xlim, [-14, 34]);
assert.deepEqual(batch.ylim, [-24, 14]);
assert.deepEqual(indoorViewOptions([...layers].reverse()), batch);
assert.deepEqual(indoorViewOptions(sample), view);
assert.equal(JSON.stringify(sample), before);
for (const field of ['left', 'right', 'bottom', 'top', 'res']) {
  for (const value of [NaN, Infinity, -Infinity, null, '1']) {
    assert.throws(() => indoorViewOptions([{ bounds: { ...sample[0].bounds, [field]: value } }]), /室内/);
  }
}
for (const bad of [[], [{}], [f(0, 0, 0, 1, 1)], [f(2, 1, 0, 1, 1)], [f(0, 1, 0, 0, 1)], [f(0, 1, 0, 1, 0)], [f(0, 1, 0, 1, -1)], [f(-1e308, 1e308, 0, 1, 1)]]) assert.throws(() => indoorViewOptions(bad), /室内/);
const figure = { ...sample[0], ...view };
const key = variantFor(figure, view.coordBounds, 'abs');
assert.match(key, /^ip1_[a-f0-9]{16}$/);
assert.notEqual(variantFor({ ...figure, xlim: [16.0001, 104] }, view.coordBounds, 'abs'), key);
assert.notEqual(variantFor({ ...figure, coordBounds: { ...view.coordBounds, left: 20.0001 } }, view.coordBounds, 'abs'), key);
assert.notEqual(variantFor(figure, view.coordBounds, 'rel-ll'), key);
assert.equal(variantFor(sample[0], sample[0].bounds, 'abs'), '', 'legacy cache stays unchanged');
assert.equal(variantFor({ bounds: sample[0].bounds }, sample[0].bounds, 'rel-center'), 'rel-center');
console.log('PASS indoor padding: union, validation, precision, immutable bounds, legacy cache');
