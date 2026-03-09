import * as assert from 'assert';

import { parseHunks } from '../git/gitOps';

suite('gitOps Test Suite', () => {
  suite('parseHunks', () => {
    test('returns an empty array for empty input', () => {
      assert.deepStrictEqual(parseHunks(''), []);
      assert.deepStrictEqual(parseHunks('   \n  '), []);
    });

    test('parses multiple hunks across multiple files', () => {
      const diff = [
        'diff --git a/src/alpha.ts b/src/alpha.ts',
        'index 1111111..2222222 100644',
        '--- a/src/alpha.ts',
        '+++ b/src/alpha.ts',
        '@@ -1,3 +1,3 @@',
        '-const status = false;',
        '+const status = true;',
        ' export default status;',
        '@@ -10,2 +10,3 @@',
        ' export function format() {',
        '+  return "formatted";',
        ' }',
        'diff --git a/src/beta.ts b/src/beta.ts',
        'index 3333333..4444444 100644',
        '--- a/src/beta.ts',
        '+++ b/src/beta.ts',
        '@@ -5,2 +5,2 @@',
        '-return oldValue;',
        '+return newValue;',
      ].join('\n');

      const hunks = parseHunks(diff);

      assert.strictEqual(hunks.length, 3);
      assert.strictEqual(hunks[0].filePath, 'src/alpha.ts');
      assert.strictEqual(hunks[0].index, 0);
      assert.strictEqual(hunks[0].hunkHeader, '@@ -1,3 +1,3 @@');
      assert.ok(hunks[0].fileHeader.includes('diff --git a/src/alpha.ts b/src/alpha.ts'));
      assert.ok(hunks[0].content.includes('+const status = true;'));

      assert.strictEqual(hunks[1].filePath, 'src/alpha.ts');
      assert.strictEqual(hunks[1].index, 1);
      assert.strictEqual(hunks[1].hunkHeader, '@@ -10,2 +10,3 @@');
      assert.ok(hunks[1].content.includes('+  return "formatted";'));

      assert.strictEqual(hunks[2].filePath, 'src/beta.ts');
      assert.strictEqual(hunks[2].index, 0);
      assert.strictEqual(hunks[2].hunkHeader, '@@ -5,2 +5,2 @@');
      assert.ok(hunks[2].fileHeader.includes('diff --git a/src/beta.ts b/src/beta.ts'));
    });

    test('ignores sections without hunk headers', () => {
      const diff = [
        'diff --git a/assets/logo.png b/assets/logo.png',
        'new file mode 100644',
        'index 0000000..1234567',
        'Binary files /dev/null and b/assets/logo.png differ',
        'diff --git a/src/feature.ts b/src/feature.ts',
        'index 7654321..abcdef0 100644',
        '--- a/src/feature.ts',
        '+++ b/src/feature.ts',
        '@@ -1,1 +1,2 @@',
        ' export const ready = true;',
        '+export const enabled = true;',
      ].join('\n');

      const hunks = parseHunks(diff);

      assert.strictEqual(hunks.length, 1);
      assert.strictEqual(hunks[0].filePath, 'src/feature.ts');
      assert.ok(!hunks.some((h) => h.filePath === 'assets/logo.png'));
    });
  });
});