import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/features/authFiles/components/AuthFileDetailsSheet.tsx', 'utf8');
const styles = readFileSync(
  'src/features/authFiles/components/AuthFileDetailsSheet.module.scss',
  'utf8'
);

describe('auth file details sheet layout', () => {
  test('keeps raw file data collapsed below the editable fields', () => {
    const fields = source.indexOf('className={styles.fields}');
    const raw = source.indexOf('<details className={styles.rawBlock}>');
    expect(fields).toBeGreaterThan(-1);
    expect(raw).toBeGreaterThan(fields);
    expect(source).not.toMatch(/<details[^>]*\bopen\b/);
  });

  test('shows invalid downloaded content uncollapsed, since it explains the error', () => {
    const invalid = source.indexOf("t('auth_files.prefix_proxy_invalid_content_label')");
    expect(invalid).toBeGreaterThan(-1);
    expect(invalid).toBeLessThan(source.indexOf('<details className={styles.rawBlock}>'));
  });

  test('pairs related short fields and stacks them on narrow sheets', () => {
    expect(source.match(/className=\{styles\.fieldRow\}/g)).toHaveLength(2);
    expect(styles).toMatch(/\.fieldRow \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
  });
});
