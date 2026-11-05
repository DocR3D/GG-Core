// src/domain/config/template.utils.spec.ts

import { interpolateTemplate } from './template.utils';

describe('interpolateTemplate', () => {
  it('replaces single and multiple variables correctly', () => {
    const tpl = '{tag} Match configuré sur {map} ! Score: {ct}-{t}';
    const res = interpolateTemplate(tpl, {
      tag: '[GG-LAN]',
      map: 'de_dust2',
      ct: 8,
      t: 4,
    });
    expect(res).toBe('[GG-LAN] Match configuré sur de_dust2 ! Score: 8-4');
  });

  it('leaves unknown variables unchanged', () => {
    const tpl = '{tag} Bonjour {who}, inconnu: {unknown}';
    const res = interpolateTemplate(tpl, { tag: '[GG]', who: 'Garitos' });
    expect(res).toBe('[GG] Bonjour Garitos, inconnu: {unknown}');
  });

  it('handles null and undefined values by replacing with empty string', () => {
    const tpl = 'Hello {name}!';
    expect(interpolateTemplate(tpl, { name: null })).toBe('Hello !');
    expect(interpolateTemplate(tpl, { name: undefined })).toBe('Hello !');
  });

  it('handles empty template or empty params', () => {
    expect(interpolateTemplate('', { tag: '[GG]' })).toBe('');
    expect(interpolateTemplate('{tag}', {})).toBe('{tag}');
  });
});
