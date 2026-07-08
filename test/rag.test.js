const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chunkMarkdown, cosine, search, cleanDoc } = require('../lib/rag');

const DOC = [
  '---', 'title: Test', '---',
  '# RPM Filter',
  '',
  'The RPM filter uses bidirectional DShot telemetry to create notch filters at motor rotation frequencies. ' +
  'It requires compatible ESC firmware such as Bluejay or BLHeli_32, and dshot_bidir must be enabled. '.repeat(3),
  '',
  '## Requirements',
  '',
  'Enable bidirectional DShot with set dshot_bidir = ON and verify motor poles are set correctly for your motors. '.repeat(3),
].join('\n');

test('cleanDoc strips frontmatter and MDX noise', () => {
  const cleaned = cleanDoc('---\ntitle: x\n---\nimport Thing from "x";\n<Widget prop="1" />\nreal text ![img](a.png) here');
  assert.ok(!cleaned.includes('title: x'));
  assert.ok(!cleaned.includes('import Thing'));
  assert.ok(!cleaned.includes('<Widget'));
  assert.ok(cleaned.includes('real text'));
});

test('chunkMarkdown carries heading context and respects min size', () => {
  const chunks = chunkMarkdown(cleanDoc(DOC));
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].heading, 'RPM Filter');
  assert.equal(chunks[chunks.length - 1].heading, 'Requirements');
  for (const c of chunks) assert.ok(c.text.length >= 200);
});

test('cosine similarity behaves', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.ok(cosine([1, 2, 3], [1, 2, 3]) > 0.999);
  assert.equal(cosine([0, 0], [1, 1]), 0);
});

test('search returns top-k by similarity with sources', () => {
  const index = {
    chunks: [
      { source: 'a.md', heading: 'A', text: 'aaa', embedding: [1, 0, 0] },
      { source: 'b.md', heading: 'B', text: 'bbb', embedding: [0, 1, 0] },
      { source: 'c.md', heading: 'C', text: 'ccc', embedding: [0.9, 0.1, 0] },
    ],
  };
  const results = search(index, [1, 0, 0], 2);
  assert.equal(results.length, 2);
  assert.equal(results[0].source, 'a.md');
  assert.equal(results[1].source, 'c.md');
  assert.ok(results[0].score > results[1].score);
  assert.deepEqual(search({ chunks: [] }, [1], 2), []);
  assert.deepEqual(search(index, null, 2), []);
});
