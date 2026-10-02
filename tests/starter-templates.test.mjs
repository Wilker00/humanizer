import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_TEMPLATES, createProjectFromTemplate } from '../engine/starter-templates.js';
import { validateProject } from '../engine/project-format.js';
import { createZipArchive, generateDemoBlurb, generateSharePackReadme } from '../engine/export-tools.js';

test('Starter templates: all 8 templates exist and validate under schema v3', () => {
  assert.ok(Array.isArray(STARTER_TEMPLATES), 'STARTER_TEMPLATES should be an array');
  assert.ok(STARTER_TEMPLATES.length >= 8, `Expected at least 8 starter templates, got ${STARTER_TEMPLATES.length}`);

  for (const tpl of STARTER_TEMPLATES) {
    assert.ok(tpl.id, `Template must have an id: ${JSON.stringify(tpl)}`);
    assert.ok(tpl.name, `Template must have a name: ${tpl.id}`);
    assert.ok(tpl.bpm >= 40 && tpl.bpm <= 240, `Template bpm invalid: ${tpl.bpm}`);
    assert.ok(tpl.key, `Template key missing: ${tpl.id}`);
    assert.ok(tpl.melody?.length > 0, `Template melody missing notes: ${tpl.id}`);
    assert.ok(Object.keys(tpl.drums || {}).length > 0, `Template drums missing: ${tpl.id}`);

    const project = createProjectFromTemplate(tpl);
    assert.equal(project.schemaVersion, 3, `Project must have schemaVersion 3: ${tpl.id}`);
    assert.ok(project.melodyAdded, `Project must have melody committed: ${tpl.id}`);
    assert.ok(project.drumsAdded, `Project must have drums committed: ${tpl.id}`);
    assert.ok(project.chordAdded, `Project must have chords committed: ${tpl.id}`);
    assert.ok(project.tracks?.length >= 4, `Project must have at least 4 tracks: ${tpl.id}`);
    assert.ok(project.sections?.length >= 2, `Project must have at least 2 sections: ${tpl.id}`);

    const validated = validateProject(project);
    assert.equal(validated.schemaVersion, 3);
  }
});

test('Share pack tools: ZIP archive generation, pitch blurb, and README', async () => {
  const tpl = STARTER_TEMPLATES[0];
  const project = createProjectFromTemplate(tpl);

  // Test pitch blurb
  const blurb = generateDemoBlurb(project);
  assert.ok(typeof blurb === 'string');
  assert.ok(blurb.includes(project.name), 'Blurb should mention project name');
  assert.ok(blurb.includes(String(project.bpm)), 'Blurb should mention BPM');
  assert.ok(blurb.includes(project.key), 'Blurb should mention Key');

  // Test README
  const readme = generateSharePackReadme(project);
  assert.ok(typeof readme === 'string');
  assert.ok(readme.includes('Audio & Project Share Pack'));
  assert.ok(readme.includes(project.name));

  // Test ZIP archive creator
  const testFiles = [
    { name: 'README.txt', data: new TextEncoder().encode(readme) },
    { name: 'project.json', data: new TextEncoder().encode(JSON.stringify(project)) },
    { name: 'test.bin', data: new Uint8Array([1, 2, 3, 4, 5]) }
  ];

  const zipBytes = createZipArchive(testFiles);
  assert.ok(zipBytes instanceof Uint8Array, 'Output must be Uint8Array');
  assert.ok(zipBytes.length > 50, 'ZIP file must have data');

  // Standard ZIP signature: 'PK\x03\x04' (0x50, 0x4B, 0x03, 0x04)
  assert.equal(zipBytes[0], 0x50);
  assert.equal(zipBytes[1], 0x4B);
  assert.equal(zipBytes[2], 0x03);
  assert.equal(zipBytes[3], 0x04);
});
