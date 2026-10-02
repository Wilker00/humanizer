import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAutomationClip,
  evaluateAutomationAt,
  insertAutomationPoint,
  removeAutomationPoint,
  setAutomationTension,
  computeClipCrossfade,
  crossfadeGainAt
} from '../engine/automation.js';
import {
  createSidechainRoute,
  addSidechainRoute,
  removeSidechainRoute,
  getSidechainSources,
  swapFxSlots,
  moveFxSlotUp,
  moveFxSlotDown
} from '../engine/track-fx-graph.js';

test('Automation: insert and remove points maintain sorted order and minimum count', () => {
  const clip = createAutomationClip({
    points: [
      { x: 0, y: 0, tension: 0 },
      { x: 1, y: 1, tension: 0 }
    ]
  });
  assert.equal(clip.points.length, 2);

  insertAutomationPoint(clip, 0.5, 0.75, 0.3);
  assert.equal(clip.points.length, 3);
  assert.equal(clip.points[1].x, 0.5);
  assert.equal(clip.points[1].y, 0.75);
  assert.equal(clip.points[1].tension, 0.3);

  // Remove middle point
  removeAutomationPoint(clip, 1);
  assert.equal(clip.points.length, 2);

  // Cannot remove below 2
  removeAutomationPoint(clip, 0);
  assert.equal(clip.points.length, 2, 'Should refuse to go below 2 points');
});

test('Automation: tension update clamps to [-1, 1]', () => {
  const clip = createAutomationClip();
  setAutomationTension(clip, 0, 5.0);
  assert.equal(clip.points[0].tension, 1);

  setAutomationTension(clip, 0, -3.0);
  assert.equal(clip.points[0].tension, -1);
});

test('Crossfade: overlapping clips produce fade envelopes with equal-power gain', () => {
  const clipA = { id: 'a', startBar: 0, lengthBars: 4 };
  const clipB = { id: 'b', startBar: 3, lengthBars: 4 };

  const { clipAFade, clipBFade, overlapBars } = computeClipCrossfade(clipA, clipB, 0.5);
  assert.equal(overlapBars, 1);
  assert.ok(clipAFade, 'clipA should have a fade');
  assert.ok(clipBFade, 'clipB should have a fade');
  assert.equal(clipAFade.type, 'fadeOut');
  assert.equal(clipBFade.type, 'fadeIn');

  // Before overlap, clipA is full
  assert.equal(crossfadeGainAt(2, clipAFade), 1.0);
  // After fade, clipA is silent
  assert.equal(crossfadeGainAt(3.5, clipAFade), 0.0);

  // clipB before overlap is silent
  assert.equal(crossfadeGainAt(2, clipBFade), 0.0);
  // After fade completes, clipB is full
  assert.equal(crossfadeGainAt(3.5, clipBFade), 1.0);
});

test('Crossfade: non-overlapping clips produce no fades', () => {
  const clipA = { id: 'a', startBar: 0, lengthBars: 2 };
  const clipB = { id: 'b', startBar: 4, lengthBars: 2 };

  const { clipAFade, clipBFade, overlapBars } = computeClipCrossfade(clipA, clipB);
  assert.equal(clipAFade, null);
  assert.equal(clipBFade, null);
  assert.equal(overlapBars, 0);
});

test('Sidechain: create, add, query, and remove sidechain routes', () => {
  let routes = [];

  routes = addSidechainRoute(routes, 'kick-track', 'bass-track', 0.8);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].source, 'kick-track');
  assert.equal(routes[0].dest, 'bass-track');
  assert.equal(routes[0].sidechainOnly, true);
  assert.equal(routes[0].amount, 0.8);

  // Query sources for bass
  const sources = getSidechainSources(routes, 'bass-track');
  assert.equal(sources.length, 1);
  assert.equal(sources[0].source, 'kick-track');

  // Update existing route
  routes = addSidechainRoute(routes, 'kick-track', 'bass-track', 0.5);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].amount, 0.5);

  // Remove
  routes = removeSidechainRoute(routes, 'kick-track', 'bass-track');
  assert.equal(routes.length, 0);
});

test('FX Slots: swap, move up, and move down reorder the insert chain', () => {
  const chain = [
    { type: 'eq', name: 'EQ' },
    { type: 'compress', name: 'Comp' },
    { type: 'reverb', name: 'Reverb' }
  ];

  swapFxSlots(chain, 0, 2);
  assert.equal(chain[0].name, 'Reverb');
  assert.equal(chain[2].name, 'EQ');

  moveFxSlotUp(chain, 1);
  assert.equal(chain[0].name, 'Comp');
  assert.equal(chain[1].name, 'Reverb');

  moveFxSlotDown(chain, 0);
  assert.equal(chain[0].name, 'Reverb');
  assert.equal(chain[1].name, 'Comp');

  // Out of bounds is safe
  moveFxSlotUp(chain, 0);
  assert.equal(chain[0].name, 'Reverb', 'Move up on index 0 should be no-op');
});
