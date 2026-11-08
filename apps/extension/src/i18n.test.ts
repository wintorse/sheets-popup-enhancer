import { describe, expect, it } from 'vitest';
import { localeFor } from './i18n';
describe('interface locale', () => {
  it.each([
    ['ja-JP', 'ja'],
    ['en-US', 'en'],
    ['es', 'es'],
    ['es-MX', 'es'],
    ['fr', 'fr'],
    ['fr-CA', 'fr'],
    ['id', 'id'],
    ['id-ID', 'id'],
    ['pt', 'pt_BR'],
    ['pt-BR', 'pt_BR'],
    ['pt_BR', 'pt_BR'],
    ['pt-PT', 'en'],
    ['ru', 'ru'],
    ['ru-RU', 'ru'],
    ['de', 'de'],
    ['de-DE', 'de'],
    ['ar', 'ar'],
    ['ar-SA', 'ar'],
    ['zh-CN', 'zh_CN'],
    ['zh-Hans-SG', 'zh_CN'],
    ['zh-Hant-HK', 'zh_TW'],
    ['zh-TW', 'zh_TW'],
    ['ko-KR', 'ko'],
    ['it', 'en'],
  ])('maps %s to %s', (input, expected) => {
    expect(localeFor(input)).toBe(expected);
  });
});
