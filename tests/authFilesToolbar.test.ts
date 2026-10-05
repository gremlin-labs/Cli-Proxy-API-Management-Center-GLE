import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import {
  AuthFilesToolbar,
  type AuthFilesToolbarProps,
} from '@/features/authFiles/components/AuthFilesToolbar';

const noop = () => {};

const render = (overrides: Partial<AuthFilesToolbarProps> = {}) =>
  renderToStaticMarkup(
    createElement(AuthFilesToolbar, {
      search: '',
      onSearchChange: noop,
      statusFilterMode: 'all',
      statusFilterOptions: [{ value: 'all', label: 'All' }],
      onStatusFilterChange: noop,
      sortMode: 'default',
      sortOptions: [{ value: 'default', label: 'Default' }],
      onSortModeChange: noop,
      pageSizeInput: '9',
      onPageSizeInputChange: noop,
      onPageSizeCommit: noop,
      compactMode: false,
      onCompactModeChange: noop,
      deleteLabel: 'Delete all',
      deleteDisabled: false,
      deleteLoading: false,
      onDelete: noop,
      ...overrides,
    })
  );

describe('AuthFilesToolbar clear filters', () => {
  const label = i18n.t('auth_files.clear_filters_button');

  test('offers a clear action only while search or status filtering is active', () => {
    expect(render({ onClearFilters: noop, hasActiveFilters: false })).not.toContain(label);
    expect(render({ onClearFilters: noop, hasActiveFilters: true })).toContain(label);
  });

  test('omits the action when the page provides no clear handler', () => {
    expect(render({ hasActiveFilters: true })).not.toContain(label);
  });

  test('is translated in every locale', async () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru']) {
      const messages = (await import(`@/i18n/locales/${locale}.json`)).default as {
        auth_files: Record<string, string>;
      };
      expect(messages.auth_files.clear_filters_button?.trim()).toBeTruthy();
    }
  });
});
