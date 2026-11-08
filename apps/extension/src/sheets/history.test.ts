import { describe, expect, it } from 'vitest';
import { isPartialHistory, parseHistory, readFormulaBar, unwrapValue } from './history';

// Synthetic DOM fixtures based on the selectors/structures supported by the previous extension.
// These are not snapshots captured from a live Sheets account.
const label = (text: string) => `<span class="docs-blame-bold-text">${text}</span>`;
function parse(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return parseHistory(root);
}

describe('history adapter', () => {
  it.each([
    [label('置換:') + '「以前の値」' + label('から') + '「新しい値」', '以前の値', '新しい値'],
    [
      label('Replaced') + ' "old value" ' + label('with') + ' "new value"',
      'old value',
      'new value',
    ],
    [label('已用') + ' “新值” ' + label('替换') + ' “旧值”', '旧值', '新值'],
    [label('Replaced') + ' "" ' + label('with') + ' "new"', '', 'new'],
    [
      label('Replaced') + ' "  keep spaces  " ' + label('with') + ' "a\nb"',
      '  keep spaces  ',
      'a\nb',
    ],
    [
      `${label('置換:')}<span class="waffle-blameview-formula-text">=IF(A1="", "", 1)</span>${label('から')}<span class="waffle-blameview-formula-text">=IF(A1="", "", 2)</span>`,
      '=IF(A1="", "", 1)',
      '=IF(A1="", "", 2)',
    ],
    [
      '<span class="docs-blame-bold-text">已用 <span class="docs-blame-bold-text">“新值”</span> 替换 “旧值”</span>',
      '旧值',
      '新值',
    ],
  ])('preserves old/new order and values: %s', (html, oldText, newText) => {
    expect(parse(html)).toEqual({ ok: true, change: { kind: 'replace', oldText, newText } });
  });
  it.each([
    ['追加:', 'add'],
    ['Added:', 'add'],
    ['已添加', 'add'],
    ['削除:', 'delete'],
    ['Deleted:', 'delete'],
    ['已删除', 'delete'],
  ])('recognizes %s', (action, kind) => {
    const result = parse(label(action) + ' "value"');
    expect(result).toEqual({
      ok: true,
      change: {
        kind,
        oldText: kind === 'delete' ? 'value' : '',
        newText: kind === 'add' ? 'value' : '',
      },
    });
  });
  // Synthetic full histories: a recognized separator must also have a matching action label.
  it.each([
    ['Sustituido:', 'por'],
    ['Substituído:', 'por'],
    ['Valeur', 'remplacée par'],
    ['Mengganti:', 'dengan'],
    ['Заменено:', 'на'],
    ['Ersetzt:', 'durch'],
    ['تمّ استبدال:', 'بالقيمة'],
  ])('requires the replacement label for %s', (action, separator) => {
    const values = ' "old" ' + label(separator) + ' "new"';
    expect(parse(label(action) + values)).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: 'old', newText: 'new' },
    });
    expect(parse(label('Unknown action:') + values).ok).toBe(false);
  });
  it('does not mutate the original DOM', () => {
    const root = document.createElement('div');
    root.innerHTML = label('Added:') + ' "&lt;img src=x&gt;"';
    const original = root.innerHTML;
    expect(parseHistory(root)).toMatchObject({ ok: true, change: { newText: '<img src=x>' } });
    expect(root.innerHTML).toBe(original);
  });
  it.each([
    label('Remplacé') + ' "ancien" ' + label('par') + ' "nouveau"',
    label('Replaced') + ' "old" ' + label('with'),
    label('Added:') + '<span>unexpected nesting</span>',
    label('Replaced') +
      ' "first" <span class="waffle-blameview-formula-text">=A1</span>' +
      label('with') +
      ' "new"',
  ])('leaves unknown and ambiguous structures unsupported: %s', (html) =>
    expect(parse(html).ok).toBe(false),
  );
  it('only strips one matching pair of presentation quotes', () => {
    expect(unwrapValue('「「内側」」')).toBe('「内側」');
    expect(unwrapValue('"mismatched」')).toBe('"mismatched」');
  });
});

describe('English partial history', () => {
  // Based on real English Sheets markup; data is synthetic and contains no personal information.
  const examples = [
    [
      label('Replaced:') +
        ' "banana" ' +
        label('with') +
        ' "orange", ' +
        label('within') +
        ' "apple banana citrus"',
      'apple banana citrus',
      'apple orange citrus',
    ],
    [
      label('Added:') + ' "sweet", ' + label('within') + ' "apple orange citrus"',
      'apple orange citrus',
      'apple orange sweet citrus',
    ],
    [
      label('Deleted:') + ' "sweet", ' + label('within') + ' "apple orange sweet citrus"',
      'apple orange sweet citrus',
      'apple orange citrus',
    ],
    [
      label('Replaced:') +
        ' "amet, consectetur elit." ' +
        label('with') +
        ' "amet.", ' +
        label('Added:') +
        ' "minim", ' +
        label('within') +
        ' "Lorem ipsum dolor sit amet, consectetur elit.\nUt enim ad veniam, quis exercitation ex consequat."',
      'Lorem ipsum dolor sit amet, consectetur elit.\nUt enim ad veniam, quis exercitation ex consequat.',
      'Lorem ipsum dolor sit amet.\nUt enim ad minim veniam, quis exercitation ex consequat.',
    ],
  ];
  it.each(examples)(
    'reconstructs partial descriptions and verifies the current value',
    (html, oldText, newText) => {
      const root = document.createElement('div');
      root.innerHTML = html;
      expect(parseHistory(root, { latest: true, currentValue: newText })).toEqual({
        ok: true,
        change: { kind: 'replace', oldText, newText },
      });
      expect(parseHistory(root, { latest: false, currentValue: newText }).ok).toBe(false);
      expect(parseHistory(root, { latest: true, currentValue: 'inconsistent' }).ok).toBe(false);
      expect(parseHistory(root, { latest: true }).ok).toBe(false);
    },
  );
  it('retains surrounding spaces and newlines inside presentation quotes', () => {
    const root = document.createElement('div');
    root.innerHTML = label('Replaced:') + ' " old\n" ' + label('with') + ' " new\n\n"';
    expect(parseHistory(root)).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: ' old\n', newText: ' new\n\n' },
    });
  });
  it('rejects unrecognized or contradictory operations', () => {
    const root = document.createElement('div');
    root.innerHTML = label('Added:') + ' "sweet", ' + label('within') + ' "apple citrus"';
    expect(parseHistory(root, { latest: true, currentValue: 'apple sour citrus' }).ok).toBe(false);
    expect(parseHistory(root, { latest: true, currentValue: 'apple sweet other citrus' }).ok).toBe(
      false,
    );
  });
  it('uses the displayed summary when Sheets collapses repeated spaces', () => {
    // Synthetic text modeled on an observed English Sheets history; not a live capture.
    const root = document.createElement('div');
    root.innerHTML = label('Added:') + ' "Xred blue", ' + label('within') + ' "red blueX"';
    const original = root.innerHTML;
    expect(parseHistory(root, { latest: true, currentValue: 'red  blueXred blueX' })).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: 'red blueX', newText: 'red  blueXred blueX' },
    });
    expect(parseHistory(root, { latest: false, currentValue: 'red  blueXred blueX' }).ok).toBe(
      false,
    );
    expect(parseHistory(root, { latest: true, currentValue: 'red  greenXred blueX' }).ok).toBe(
      false,
    );
    expect(parseHistory(root, { latest: true, currentValue: 'red\nblueXred blueX' }).ok).toBe(
      false,
    );
    expect(root.innerHTML).toBe(original);
  });
  it.each(['apple  orange cirtus', 'apple orange cirtus'])(
    'preserves the spaces in the displayed within value: %s',
    (oldText) => {
      // Synthetic fixture based on user-provided English markup; not a live capture.
      const root = document.createElement('div');
      root.innerHTML =
        label('Added:') + ' "citrusapple orange", ' + label('within') + ` "${oldText}"`;
      expect(
        parseHistory(root, {
          latest: true,
          currentValue: 'apple  orange citrusapple orange cirtus',
        }),
      ).toEqual({
        ok: true,
        change: { kind: 'replace', oldText, newText: 'apple  orange citrusapple orange cirtus' },
      });
    },
  );
  it('uses the displayed summary when spaces adjacent to the addition are ambiguous', () => {
    const root = document.createElement('div');
    root.innerHTML = label('Added:') + ' "Xred blue", ' + label('within') + ' "red blue X"';
    expect(parseHistory(root, { latest: true, currentValue: 'red  blue Xred blue X' })).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: 'red blue X', newText: 'red  blue Xred blue X' },
    });
  });
});

describe('formula bar values', () => {
  it.each([
    ['abc<br>', 'abc'],
    ['abc<br><br>', 'abc\n'],
    ['abc<br><br><br>', 'abc\n\n'],
    ['<br>', ''],
    [' abc <br>', ' abc '],
    ['alpha<br>beta<br>', 'alpha\nbeta'],
  ])('reads %s with its editing sentinel', (html, value) => {
    const root = document.createElement('div');
    root.className = 'cell-input';
    root.innerHTML = html;
    expect(readFormulaBar(root)).toBe(value);
  });
  it('rejects unexpected structures', () => {
    const root = document.createElement('div');
    root.className = 'cell-input';
    root.innerHTML = '<span>text</span><br>';
    expect(readFormulaBar(root)).toBeUndefined();
    root.innerHTML = 'text';
    expect(readFormulaBar(root)).toBeUndefined();
  });
});

describe('Arabic history', () => {
  // Synthetic fixtures modeled on observed C21 and E21 markup; not live captures.
  it('parses a latest composite history and rejects inconsistent or older values', () => {
    const root = document.createElement('div');
    root.innerHTML =
      label('تمّ استبدال:') +
      ' "brown fox" ' +
      label('بالقيمة') +
      ' "fox", ' +
      label('تمّت إضافة:') +
      ' "swift", ' +
      label('خلال') +
      ' "The brown fox\njumps over logs. "';
    const oldText = 'The brown fox\njumps over logs. ';
    const newText = 'The fox\njumps over swift logs. ';
    expect(parseHistory(root, { latest: true, currentValue: newText })).toEqual({
      ok: true,
      change: { kind: 'replace', oldText, newText },
    });
    expect(parseHistory(root, { latest: false, currentValue: newText }).ok).toBe(false);
    expect(parseHistory(root, { latest: true, currentValue: 'unrelated' }).ok).toBe(false);
    root.innerHTML = root.innerHTML.replace('تمّت إضافة:', 'Added:');
    expect(parseHistory(root, { latest: true, currentValue: newText }).ok).toBe(false);
  });
  it.each([
    ['تمّ حذف:', 'delete'],
    ['تمّت إضافة:', 'add'],
  ] as const)('parses a formula action: %s', (action, kind) => {
    const root = document.createElement('div');
    root.innerHTML = label(action) + ' "<span class="waffle-blameview-formula-text">=TRUE</span>"';
    const change =
      kind === 'delete'
        ? { kind, oldText: '=TRUE', newText: '' }
        : { kind, oldText: '', newText: '=TRUE' };
    expect(parseHistory(root)).toEqual({ ok: true, change });
  });
  it('parses standalone replacement and rejects an unknown action', () => {
    const root = document.createElement('div');
    root.innerHTML = label('تمّ استبدال:') + ' "قديم" ' + label('بالقيمة') + ' "جديد"';
    expect(parseHistory(root)).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: 'قديم', newText: 'جديد' },
    });
    root.innerHTML = root.innerHTML.replace('تمّ استبدال:', 'غير معروف:');
    expect(parseHistory(root).ok).toBe(false);
  });
});

describe('German history', () => {
  // Synthetic fixtures modeled on observed C21 and E21 markup; not live captures.
  it('parses a latest composite history and rejects inconsistent or older values', () => {
    const root = document.createElement('div');
    root.innerHTML =
      label('Ersetzt:') +
      ' "brown fox" ' +
      label('durch') +
      ' "fox", ' +
      label('Hinzugefügt:') +
      ' "swift", ' +
      label('innerhalb von') +
      ' "The brown fox\njumps over logs. "';
    const oldText = 'The brown fox\njumps over logs. ';
    const newText = 'The fox\njumps over swift logs. ';
    expect(parseHistory(root, { latest: true, currentValue: newText })).toEqual({
      ok: true,
      change: { kind: 'replace', oldText, newText },
    });
    expect(parseHistory(root, { latest: false, currentValue: newText }).ok).toBe(false);
    expect(parseHistory(root, { latest: true, currentValue: 'unrelated' }).ok).toBe(false);
    root.innerHTML = root.innerHTML.replace('Hinzugefügt:', 'Added:');
    expect(parseHistory(root, { latest: true, currentValue: newText }).ok).toBe(false);
  });
  it.each([
    ['Gelöscht:', 'delete'],
    ['Hinzugefügt:', 'add'],
  ] as const)('parses a formula action: %s', (action, kind) => {
    const root = document.createElement('div');
    root.innerHTML = label(action) + ' "<span class="waffle-blameview-formula-text">=WAHR</span>"';
    const change =
      kind === 'delete'
        ? { kind, oldText: '=WAHR', newText: '' }
        : { kind, oldText: '', newText: '=WAHR' };
    expect(parseHistory(root)).toEqual({ ok: true, change });
  });
  it('parses standalone replacement and rejects an unknown action', () => {
    const root = document.createElement('div');
    root.innerHTML = label('Ersetzt:') + ' "alt" ' + label('durch') + ' "neu"';
    expect(parseHistory(root)).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: 'alt', newText: 'neu' },
    });
    root.innerHTML = root.innerHTML.replace('Ersetzt:', 'Unbekannt:');
    expect(parseHistory(root).ok).toBe(false);
  });
});

describe('Russian history', () => {
  // Synthetic fixtures modeled on observed C21 and E21 markup; not live captures.
  it('parses a latest composite history and rejects inconsistent or older values', () => {
    const root = document.createElement('div');
    root.innerHTML =
      label('Заменено:') +
      ' "brown fox" ' +
      label('на') +
      ' "fox", ' +
      label('Добавлено:') +
      ' "swift", ' +
      label('исходный текст:') +
      ' "The brown fox\njumps over logs. "';
    const oldText = 'The brown fox\njumps over logs. ';
    const newText = 'The fox\njumps over swift logs. ';
    expect(parseHistory(root, { latest: true, currentValue: newText })).toEqual({
      ok: true,
      change: { kind: 'replace', oldText, newText },
    });
    expect(parseHistory(root, { latest: false, currentValue: newText }).ok).toBe(false);
    expect(parseHistory(root, { latest: true, currentValue: 'unrelated' }).ok).toBe(false);
    root.innerHTML = root.innerHTML.replace('Добавлено:', 'Added:');
    expect(parseHistory(root, { latest: true, currentValue: newText }).ok).toBe(false);
  });
  it.each([
    ['Удалено:', 'delete'],
    ['Добавлено:', 'add'],
  ] as const)('parses a formula action: %s', (action, kind) => {
    const root = document.createElement('div');
    root.innerHTML =
      label(action) + ' "<span class="waffle-blameview-formula-text">=ИСТИНА</span>"';
    const change =
      kind === 'delete'
        ? { kind, oldText: '=ИСТИНА', newText: '' }
        : { kind, oldText: '', newText: '=ИСТИНА' };
    expect(parseHistory(root)).toEqual({ ok: true, change });
  });
  it('parses standalone replacement and rejects an unknown action', () => {
    const root = document.createElement('div');
    root.innerHTML = label('Заменено:') + ' "старое" ' + label('на') + ' "новое"';
    expect(parseHistory(root)).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: 'старое', newText: 'новое' },
    });
    root.innerHTML = root.innerHTML.replace('Заменено:', 'Неизвестно:');
    expect(parseHistory(root).ok).toBe(false);
  });
});

describe('Brazilian Portuguese history', () => {
  // Synthetic fixtures modeled on observed C21 and E21 markup; not live captures.
  it('parses a latest composite history and rejects inconsistent or older values', () => {
    const root = document.createElement('div');
    root.innerHTML =
      label('Substituído:') +
      ' "brown fox" ' +
      label('por') +
      ' "fox", ' +
      label('Adicionado:') +
      ' "swift", ' +
      label('período:') +
      ' "The brown fox\njumps over logs. "';
    const oldText = 'The brown fox\njumps over logs. ';
    const newText = 'The fox\njumps over swift logs. ';
    expect(parseHistory(root, { latest: true, currentValue: newText })).toEqual({
      ok: true,
      change: { kind: 'replace', oldText, newText },
    });
    expect(parseHistory(root, { latest: false, currentValue: newText }).ok).toBe(false);
    expect(parseHistory(root, { latest: true, currentValue: 'unrelated' }).ok).toBe(false);
    root.innerHTML = root.innerHTML.replace('Adicionado:', 'Añadido:');
    expect(parseHistory(root, { latest: true, currentValue: newText }).ok).toBe(false);
  });
  it.each([
    ['Excluído:', 'delete'],
    ['Adicionado:', 'add'],
  ] as const)('parses a formula action: %s', (action, kind) => {
    const root = document.createElement('div');
    root.innerHTML =
      label(action) + ' "<span class="waffle-blameview-formula-text">=VERDADEIRO</span>"';
    const change =
      kind === 'delete'
        ? { kind, oldText: '=VERDADEIRO', newText: '' }
        : { kind, oldText: '', newText: '=VERDADEIRO' };
    expect(parseHistory(root)).toEqual({ ok: true, change });
  });
  it('parses standalone replacement and rejects an unknown action', () => {
    const root = document.createElement('div');
    root.innerHTML = label('Substituído:') + ' "antigo" ' + label('por') + ' "novo"';
    expect(parseHistory(root)).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: 'antigo', newText: 'novo' },
    });
    root.innerHTML = root.innerHTML.replace('Substituído:', 'Desconhecido:');
    expect(parseHistory(root).ok).toBe(false);
  });
});

describe('Indonesian history', () => {
  // Synthetic fixtures modeled on observed C21 and E21 markup; not live captures.
  it('parses a latest composite history and rejects inconsistent or older values', () => {
    const root = document.createElement('div');
    root.innerHTML =
      label('Mengganti:') +
      ' "brown fox" ' +
      label('dengan') +
      ' "fox", ' +
      label('Menambahkan:') +
      ' "swift", ' +
      label('dalam') +
      ' "The brown fox\njumps over logs. "';
    const oldText = 'The brown fox\njumps over logs. ';
    const newText = 'The fox\njumps over swift logs. ';
    expect(parseHistory(root, { latest: true, currentValue: newText })).toEqual({
      ok: true,
      change: { kind: 'replace', oldText, newText },
    });
    expect(parseHistory(root, { latest: false, currentValue: newText }).ok).toBe(false);
    expect(parseHistory(root, { latest: true, currentValue: 'unrelated' }).ok).toBe(false);
    root.innerHTML = root.innerHTML.replace('Menambahkan:', 'Added:');
    expect(parseHistory(root, { latest: true, currentValue: newText }).ok).toBe(false);
  });
  it.each([
    ['Menghapus:', 'delete'],
    ['Menambahkan:', 'add'],
  ] as const)('parses a formula action: %s', (action, kind) => {
    const root = document.createElement('div');
    root.innerHTML = label(action) + ' "<span class="waffle-blameview-formula-text">=TRUE</span>"';
    const change =
      kind === 'delete'
        ? { kind, oldText: '=TRUE', newText: '' }
        : { kind, oldText: '', newText: '=TRUE' };
    expect(parseHistory(root)).toEqual({ ok: true, change });
  });
  it('parses standalone replacement and rejects an unknown action', () => {
    const root = document.createElement('div');
    root.innerHTML = label('Mengganti:') + ' "lama" ' + label('dengan') + ' "baru"';
    expect(parseHistory(root)).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: 'lama', newText: 'baru' },
    });
    root.innerHTML = root.innerHTML.replace('Mengganti:', 'Tidak dikenal:');
    expect(parseHistory(root).ok).toBe(false);
  });
});

describe('French history', () => {
  // Synthetic fixtures modeled on observed C21 and E21 markup; not live captures.
  it('parses a latest composite history, preserving the old multiline value', () => {
    const root = document.createElement('div');
    root.innerHTML =
      label('Valeur') +
      ' "brown fox" ' +
      label('remplacée par') +
      ' "fox", ' +
      label('Valeur ajoutée') +
      '&nbsp;: "swift", ' +
      label('période') +
      ' "The brown fox\njumps over logs. "';
    const oldText = 'The brown fox\njumps over logs. ';
    const newText = 'The fox\njumps over swift logs. ';
    expect(parseHistory(root, { latest: true, currentValue: newText })).toEqual({
      ok: true,
      change: { kind: 'replace', oldText, newText },
    });
    expect(parseHistory(root, { latest: false, currentValue: newText }).ok).toBe(false);
    expect(parseHistory(root, { latest: true, currentValue: 'unrelated' }).ok).toBe(false);
    root.innerHTML = root.innerHTML.replace('Valeur ajoutée', 'Added:');
    expect(parseHistory(root, { latest: true, currentValue: newText }).ok).toBe(false);
  });
  it.each([
    ['Valeur supprimée', 'delete'],
    ['Valeur ajoutée', 'add'],
  ] as const)('parses a formula action: %s', (action, kind) => {
    const root = document.createElement('div');
    root.innerHTML =
      label(action) + '&nbsp;: "<span class="waffle-blameview-formula-text">=VRAI</span>"';
    const change =
      kind === 'delete'
        ? { kind, oldText: '=VRAI', newText: '' }
        : { kind, oldText: '', newText: '=VRAI' };
    expect(parseHistory(root)).toEqual({ ok: true, change });
    root.innerHTML = root.innerHTML.replace('&nbsp;:', '');
    expect(parseHistory(root).ok).toBe(false);
  });
  it('parses standalone replacements and rejects unknown labels', () => {
    const root = document.createElement('div');
    root.innerHTML = label('Valeur') + ' "ancien" ' + label('remplacée par') + ' "nouveau"';
    expect(parseHistory(root)).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: 'ancien', newText: 'nouveau' },
    });
    root.innerHTML = root.innerHTML.replace('Valeur', 'Inconnu');
    expect(parseHistory(root).ok).toBe(false);
  });
});

describe('Spanish history', () => {
  // Synthetic fixtures based on user-provided markup; not a live capture.
  it('parses a latest replacement and addition within the original value', () => {
    const root = document.createElement('div');
    root.innerHTML =
      label('Sustituido:') +
      ' "amet, consectetur elit." ' +
      label('por') +
      ' "amet.", ' +
      label('Añadido:') +
      ' "minim", ' +
      label('en') +
      ' "Lorem ipsum dolor sit amet, consectetur elit.\nUt enim ad veniam, quis exercitation ex consequat. "';
    const oldText =
      'Lorem ipsum dolor sit amet, consectetur elit.\nUt enim ad veniam, quis exercitation ex consequat. ';
    const newText =
      'Lorem ipsum dolor sit amet.\nUt enim ad minim veniam, quis exercitation ex consequat. ';
    expect(parseHistory(root, { latest: true, currentValue: newText })).toEqual({
      ok: true,
      change: { kind: 'replace', oldText, newText },
    });
    expect(parseHistory(root, { latest: false, currentValue: newText }).ok).toBe(false);
    expect(parseHistory(root, { latest: true, currentValue: 'otro valor' }).ok).toBe(false);
  });
  it('parses a deleted formula and rejects ambiguous actions', () => {
    const root = document.createElement('div');
    root.innerHTML =
      label('Eliminado:') + ' "<span class="waffle-blameview-formula-text">=VERDADERO</span>"';
    expect(parseHistory(root)).toEqual({
      ok: true,
      change: { kind: 'delete', oldText: '=VERDADERO', newText: '' },
    });
    root.innerHTML = label('Desconocido:') + ' "antiguo" ' + label('por') + ' "nuevo"';
    expect(parseHistory(root).ok).toBe(false);
  });
  it.each([
    [label('Añadido:') + ' "nuevo"', { kind: 'add', oldText: '', newText: 'nuevo' }],
    [
      label('Sustituido:') + ' "antes" ' + label('por') + ' "después"',
      { kind: 'replace', oldText: 'antes', newText: 'después' },
    ],
  ])('parses standalone Spanish actions', (html, change) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(parseHistory(root)).toEqual({ ok: true, change });
  });
});

describe('Japanese partial history', () => {
  it('matches an addition whose line breaks are flattened in the history', () => {
    // Synthetic fixture based on the reported Japanese DOM; not a live capture.
    const root = document.createElement('div');
    root.innerHTML =
      label('追加しました:') +
      ' "または通信エラー。 エラー処理を行う。", ' +
      label('期間') +
      ' "API の応答がエラー"';
    const before = 'API の応答がエラー';
    const after = 'API の応答がエラー または通信エラー。\nエラー処理を行う。';
    expect(parseHistory(root, { latest: true, currentValue: after })).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: before, newText: after },
    });
    expect(parseHistory(root, { latest: false, currentValue: after }).ok).toBe(false);
    expect(
      parseHistory(root, {
        latest: true,
        currentValue: 'API の応答がエラー または通信エラー。\n別の処理を行う。',
      }).ok,
    ).toBe(false);
    expect(
      parseHistory(root, {
        latest: true,
        currentValue: 'APIの応答がエラー または通信エラー。\nエラー処理を行う。',
      }).ok,
    ).toBe(false);
  });
  // Synthetic values with structures observed in the Japanese Sheets UI.
  const cases = [
    [
      label('置き換えました:') +
        ' "banana" ' +
        label('から') +
        ' "orange", ' +
        label('期間') +
        ' "apple banana citrus"',
      'apple banana citrus',
      'apple orange citrus',
    ],
    [
      label('追加しました:') + ' "sweet", ' + label('期間') + ' "apple orange citrus"',
      'apple orange citrus',
      'apple orange sweet citrus',
    ],
    [
      label('削除しました:') + ' "sweet", ' + label('期間') + ' "apple orange sweet citrus"',
      'apple orange sweet citrus',
      'apple orange citrus',
    ],
    [
      label('置き換えました:') +
        ' "amet, consectetur elit." ' +
        label('から') +
        ' "amet.", ' +
        label('追加しました:') +
        ' "minim", ' +
        label('期間') +
        ' "Lorem ipsum dolor sit amet, consectetur elit.\nUt enim ad veniam, quis exercitation ex consequat. "',
      'Lorem ipsum dolor sit amet, consectetur elit.\nUt enim ad veniam, quis exercitation ex consequat. ',
      'Lorem ipsum dolor sit amet.\nUt enim ad minim veniam, quis exercitation ex consequat. ',
    ],
  ];
  it.each(cases)('uses the Japanese within value and verifies edits', (html, oldText, newText) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(parseHistory(root, { latest: true, currentValue: newText })).toEqual({
      ok: true,
      change: { kind: 'replace', oldText, newText },
    });
    expect(parseHistory(root, { latest: false, currentValue: newText }).ok).toBe(false);
    expect(parseHistory(root, { latest: true }).ok).toBe(false);
    expect(parseHistory(root, { latest: true, currentValue: '矛盾する値' }).ok).toBe(false);
  });
  it('does not accept mixed locales or malformed structures', () => {
    const root = document.createElement('div');
    root.innerHTML = label('Added:') + ' "sweet", ' + label('期間') + ' "apple citrus"';
    expect(parseHistory(root, { latest: true, currentValue: 'apple sweet citrus' }).ok).toBe(false);
    root.innerHTML =
      label('追加しました:') +
      ' "sweet", ' +
      label('期間') +
      ' "apple citrus" ' +
      label('期間') +
      ' "apple citrus"';
    expect(parseHistory(root, { latest: true, currentValue: 'apple sweet citrus' }).ok).toBe(false);
  });
  it('parses full Japanese replacements with whitespace and line endings', () => {
    const root = document.createElement('div');
    root.innerHTML = label('置き換えました:') + ' " old\n" ' + label('から') + ' " new\n\n"';
    expect(parseHistory(root)).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: ' old\n', newText: ' new\n\n' },
    });
  });
});

describe('formula histories', () => {
  const f = (value: string) => `<span class="waffle-blameview-formula-text">${value}</span>`;
  it.each([
    [
      label('置き換えました:') +
        ' "' +
        f('=IF(A1="", "old", 1)') +
        '" ' +
        label('から') +
        ' "' +
        f('=IF(A1="", "new", 1)') +
        '"',
      '=IF(A1="", "old", 1)',
      '=IF(A1="", "new", 1)',
    ],
    [
      label('Replaced:') +
        ' "' +
        f('=SUM(A1:A5)') +
        '" ' +
        label('with') +
        ' "' +
        f('=SUM(A1:A9)') +
        '"',
      '=SUM(A1:A5)',
      '=SUM(A1:A9)',
    ],
    [label('已用') + ' “' + f('=A2') + '” ' + label('替换') + ' “' + f('=A1') + '”', '=A1', '=A2'],
    [
      label('Replaced:') + ' "plain text" ' + label('with') + ' "' + f('=A1') + '"',
      'plain text',
      '=A1',
    ],
    [
      label('置き換えました:') + ' "' + f('=A1') + '" ' + label('から') + ' "' + 'plain text"',
      '=A1',
      'plain text',
    ],
    [label('置き換えました:') + ' "' + f('=A1') + '" ' + label('から') + ' ""', '=A1', ''],
  ])(
    'extracts formulas without presentation quotes or loss of inner quotes',
    (html, oldText, newText) => {
      const root = document.createElement('div');
      root.innerHTML = html;
      expect(parseHistory(root)).toEqual({
        ok: true,
        change: { kind: 'replace', oldText, newText },
      });
    },
  );
  it.each([
    ['追加しました:', 'add'],
    ['Added:', 'add'],
    ['削除しました:', 'delete'],
    ['Deleted:', 'delete'],
    ['已添加', 'add'],
    ['已删除', 'delete'],
  ])('recognizes formula %s', (action, kind) => {
    const root = document.createElement('div');
    root.innerHTML = label(action) + ' "' + f('=SUM(A1:A5)') + '"';
    expect(parseHistory(root)).toEqual({
      ok: true,
      change: {
        kind,
        oldText: kind === 'delete' ? '=SUM(A1:A5)' : '',
        newText: kind === 'add' ? '=SUM(A1:A5)' : '',
      },
    });
  });
  it('infers unknown locale ordering only on latest history when current formula matches exactly once', () => {
    const root = document.createElement('div');
    root.innerHTML =
      label('Remplacé:') + ' "' + f('=A1') + '" ' + label('par') + ' "' + f('=A2') + '"';
    expect(parseHistory(root, { latest: true, currentValue: '=A2' })).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: '=A1', newText: '=A2' },
    });
    expect(parseHistory(root, { latest: true, currentValue: '=A1' })).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: '=A2', newText: '=A1' },
    });
    expect(parseHistory(root, { latest: false, currentValue: '=A2' }).ok).toBe(false);
    expect(parseHistory(root, { latest: true, currentValue: '=A3' }).ok).toBe(false);
  });
  it('rejects formula markup when its presentation quotes are unbalanced or have extra content', () => {
    const root = document.createElement('div');
    root.innerHTML = label('Added:') + ' "' + f('=A1') + ' unexpected"';
    expect(parseHistory(root).ok).toBe(false);
    root.innerHTML = label('Added:') + ' "' + f('=A1') + '」';
    expect(parseHistory(root).ok).toBe(false);
  });
  it('extracts a highlighted formula from the formula bar including inner quotes', () => {
    const root = document.createElement('div');
    root.className = 'cell-input';
    root.innerHTML =
      '<bdo dir="ltr"><span class="formula-content"><span>=</span><span>IF</span><span>(A1="",</span><span>"ok")</span></span></bdo><br>';
    expect(readFormulaBar(root)).toBe('=IF(A1="","ok")');
    root.innerHTML =
      '<bdo><span class="formula-content"><span>=A1</span><br><span>+A2</span></span></bdo><br>';
    expect(readFormulaBar(root)).toBe('=A1\n+A2');
    root.innerHTML = '<bdo><span class="formula-content"><i>=A1</i></span></bdo><br>';
    expect(readFormulaBar(root)).toBeUndefined();
  });
});

describe('Simplified Chinese histories', () => {
  // Based on user-provided Sheets HTML; no live capture is implied.
  const nested = (before: string, after: string) =>
    `<span class="docs-blame-bold-text">已用<span class="docs-blame-bold-text">“"${after}"”</span>替换“"${before}"”</span>`;
  const range = (value: string) => label('范围') + '："' + value + '"';
  const examples = [
    [
      nested('banana', 'orange') + ', ' + range('apple banana citrus'),
      'apple banana citrus',
      'apple orange citrus',
    ],
    [label('已添加：') + '"sweet", ' + range('apple citrus'), 'apple citrus', 'apple sweet citrus'],
    [
      label('已删除：') + '"sweet", ' + range('apple sweet citrus'),
      'apple sweet citrus',
      'apple citrus',
    ],
    [
      nested('amet, consectetur elit.', 'amet.') +
        ', ' +
        label('已添加：') +
        '"minim", ' +
        range(
          'Lorem ipsum dolor sit amet, consectetur elit.\nUt enim ad veniam, quis exercitation ex consequat. ',
        ),
      'Lorem ipsum dolor sit amet, consectetur elit.\nUt enim ad veniam, quis exercitation ex consequat. ',
      'Lorem ipsum dolor sit amet.\nUt enim ad minim veniam, quis exercitation ex consequat. ',
    ],
  ];
  it.each(examples)(
    'reads nested operations and verifies the full current value',
    (html, oldText, newText) => {
      const root = document.createElement('div');
      root.innerHTML = html;
      expect(parseHistory(root, { latest: true, currentValue: newText })).toEqual({
        ok: true,
        change: { kind: 'replace', oldText, newText },
      });
      expect(parseHistory(root, { latest: false, currentValue: newText }).ok).toBe(false);
      expect(parseHistory(root, { latest: true }).ok).toBe(false);
      expect(parseHistory(root, { latest: true, currentValue: '不一致' }).ok).toBe(false);
    },
  );
  it('removes presentation quotes without removing quotes inside the value', () => {
    const root = document.createElement('div');
    root.innerHTML = nested('say "old"', 'say "new"');
    expect(parseHistory(root)).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: 'say "old"', newText: 'say "new"' },
    });
  });
  it('retains actual enclosing quotes in nested values', () => {
    const root = document.createElement('div');
    root.innerHTML = nested('"old"', '"new"');
    expect(parseHistory(root)).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: '"old"', newText: '"new"' },
    });
  });
  it('rejects mismatched edits, malformed markup and mixed languages', () => {
    const root = document.createElement('div');
    root.innerHTML = nested('banana', 'orange') + ', ' + range('apple banana citrus');
    expect(parseHistory(root, { latest: true, currentValue: 'apple orange extra citrus' }).ok).toBe(
      false,
    );
    root.innerHTML =
      nested('banana', 'orange') +
      ', ' +
      label('Added:') +
      '"sweet", ' +
      range('apple banana citrus');
    expect(parseHistory(root, { latest: true, currentValue: 'apple orange sweet citrus' }).ok).toBe(
      false,
    );
    root.innerHTML =
      '<span class="docs-blame-bold-text">已用<span class="docs-blame-bold-text">“"orange"”</span>替换 banana</span>, ' +
      range('apple banana citrus');
    expect(parseHistory(root, { latest: true, currentValue: 'apple orange citrus' }).ok).toBe(
      false,
    );
  });
});

describe('Traditional Chinese histories', () => {
  // Synthetic fixtures modeled on user-provided Traditional Chinese HTML.
  // The combined Lorem ipsum case reproduces the provided example; no live capture is implied.
  const replacement = (before: string, after: string) =>
    label('已將「') + '"' + before + '"' + label('」已取代為：') + '"' + after + '"';
  const range = (value: string) => label('範圍') + '："' + value + '"';
  const before =
    'Lorem ipsum dolor sit amet, consectetur elit.\nUt enim ad veniam, quis exercitation ex consequat. ';
  const after =
    'Lorem ipsum dolor sit amet.\nUt enim ad minim veniam, quis exercitation ex consequat. ';
  const examples = [
    [
      replacement('banana', 'orange') + ', ' + range('apple banana citrus'),
      'apple banana citrus',
      'apple orange citrus',
    ],
    [label('已新增：') + '"sweet", ' + range('apple citrus'), 'apple citrus', 'apple sweet citrus'],
    [
      label('已刪除：') + '"sweet", ' + range('apple sweet citrus'),
      'apple sweet citrus',
      'apple citrus',
    ],
    [
      replacement('amet, consectetur elit.', 'amet.') +
        ', ' +
        label('已新增：') +
        '"minim", ' +
        range(before),
      before,
      after,
    ],
    [replacement('"old"', '"new"') + ', ' + range('say "old"'), 'say "old"', 'say "new"'],
    [label('已新增：') + '"added", ' + label('範圍') + ':"value"', 'value', 'value added'],
  ];
  it.each(examples)(
    'uses the range and verifies edits without changing the DOM (%#)',
    (html, oldText, newText) => {
      const root = document.createElement('div');
      root.innerHTML = html;
      const original = root.innerHTML;
      expect(isPartialHistory(root)).toBe(true);
      expect(parseHistory(root, { latest: true, currentValue: newText })).toEqual({
        ok: true,
        change: { kind: 'replace', oldText, newText },
      });
      expect(parseHistory(root, { latest: false, currentValue: newText }).ok).toBe(false);
      expect(parseHistory(root, { currentValue: newText }).ok).toBe(false);
      expect(parseHistory(root, { latest: true }).ok).toBe(false);
      expect(parseHistory(root, { latest: true, currentValue: newText + 'unexplained' }).ok).toBe(
        false,
      );
      expect(root.innerHTML).toBe(original);
    },
  );
  it.each([
    [' old\n', ' new\n\n'],
    ['"old"', '"new"'],
    ['', 'added'],
    ['deleted', ''],
    [
      '<span class="waffle-blameview-formula-text">=IF(A1="", "old", 1)</span>',
      '<span class="waffle-blameview-formula-text">=IF(A1="", "new", 1)</span>',
    ],
  ])('reads a full replacement in old/new order (%#)', (oldValue, newValue) => {
    const root = document.createElement('div');
    root.innerHTML = replacement(oldValue, newValue);
    const value = (html: string) => {
      const node = document.createElement('div');
      node.innerHTML = html;
      return node.textContent;
    };
    expect(isPartialHistory(root)).toBe(false);
    expect(parseHistory(root)).toEqual({
      ok: true,
      change: { kind: 'replace', oldText: value(oldValue), newText: value(newValue) },
    });
    expect(parseHistory(root, { latest: false })).toEqual(parseHistory(root));
  });
  it.each(['已新增：', '已刪除：'])('reads full %s operations with text and formulas', (action) => {
    for (const content of [
      ' value\n',
      '<span class="waffle-blameview-formula-text">=IF(A1="", "ok", 1)</span>',
    ]) {
      const root = document.createElement('div');
      root.innerHTML = label(action) + '"' + content + '"';
      const node = document.createElement('div');
      node.innerHTML = content;
      const added = action === '已新增：';
      expect(parseHistory(root)).toEqual({
        ok: true,
        change: {
          kind: added ? 'add' : 'delete',
          oldText: added ? '' : node.textContent,
          newText: added ? node.textContent : '',
        },
      });
    }
  });
  it.each([
    [
      replacement('banana', 'orange') +
        ', ' +
        label('已添加：') +
        '"sweet", ' +
        range('apple banana citrus'),
      'apple orange sweet citrus',
    ],
    [
      replacement('banana', 'orange') +
        ', ' +
        range('apple banana citrus') +
        range('apple banana citrus'),
      'apple orange citrus',
    ],
    [
      replacement('banana', 'orange') + ', ' + label('範圍') + '"apple banana citrus"',
      'apple orange citrus',
    ],
    [
      label('已將「') +
        '"banana"' +
        label('已取代為：') +
        '"orange", ' +
        range('apple banana citrus'),
      'apple orange citrus',
    ],
    [replacement('banana', 'orange') + ' ' + range('apple banana citrus'), 'apple orange citrus'],
    [
      replacement('banana', 'orange') + ', ' + range('apple banana citrus') + '<span>extra</span>',
      'apple orange citrus',
    ],
    [label('Added:') + '"orange", ' + range('apple banana citrus'), 'apple banana orange citrus'],
  ])(
    'rejects mixed labels, ambiguous ranges and malformed partial markup (%#)',
    (html, currentValue) => {
      const root = document.createElement('div');
      root.innerHTML = html;
      expect(isPartialHistory(root)).toBe(true);
      expect(parseHistory(root, { latest: true, currentValue }).ok).toBe(false);
    },
  );
  it.each([
    label('已將「') + '"old"' + label('with') + '"new"',
    label('Replaced:') + '"old"' + label('」已取代為：') + '"new"',
    label('已將「') + 'old' + label('」已取代為：') + '"new"',
    label('已將「') + '"old"' + label('」已取代為：') + '"new',
    replacement('old', 'new') + label('已新增：') + '"extra"',
    replacement('old', '<span>new</span>'),
  ])('rejects malformed full replacements (%#)', (html) => expect(parse(html).ok).toBe(false));
});

describe('Korean histories', () => {
  // Synthetic fixtures modeled on the user's postfix-label HTML, including
  // the empty bold span. These are not live captures from an authenticated account.
  const replacement = (before: string, after: string, empty = true) =>
    `"${before}"이(가) "${after}"(으)로 ` + label('교체됨') + (empty ? label('') : '');
  const operation = (value: string, action: '추가됨' | '삭제됨') =>
    `"${value}"이(가) ` + label(action);
  const within = (value: string) => `"${value}" ` + label('이내');
  const before =
    'Lorem ipsum dolor sit amet, consectetur elit.\nUt enim ad veniam, quis exercitation ex consequat. ';
  const after =
    'Lorem ipsum dolor sit amet.\nUt enim ad minim veniam, quis exercitation ex consequat. ';
  const examples = [
    [
      replacement('banana', 'orange') + ', ' + within('apple banana citrus'),
      'apple banana citrus',
      'apple orange citrus',
    ],
    [
      operation('sweet', '추가됨') + ', ' + within('apple citrus'),
      'apple citrus',
      'apple sweet citrus',
    ],
    [
      operation('sweet', '삭제됨') + ', ' + within('apple sweet citrus'),
      'apple sweet citrus',
      'apple citrus',
    ],
    [
      replacement('amet, consectetur elit.', 'amet.') +
        ', ' +
        operation('minim', '추가됨') +
        ', ' +
        within(before),
      before,
      after,
    ],
    [replacement('"old"', '"new"', false) + ', ' + within('say "old"'), 'say "old"', 'say "new"'],
    [replacement('안녕', '반가워') + ', ' + within('안녕 세상'), '안녕 세상', '반가워 세상'],
    [operation('first, second', '추가됨') + ', ' + within('items'), 'items', 'items first, second'],
  ];
  it.each(examples)(
    'verifies postfix operations against the current value without mutating DOM (%#)',
    (html, oldText, newText) => {
      const root = document.createElement('div');
      root.innerHTML = html;
      const original = root.innerHTML;
      expect(isPartialHistory(root)).toBe(true);
      expect(parseHistory(root, { latest: true, currentValue: newText })).toEqual({
        ok: true,
        change: { kind: 'replace', oldText, newText },
      });
      expect(parseHistory(root, { latest: false, currentValue: newText }).ok).toBe(false);
      expect(parseHistory(root, { currentValue: newText }).ok).toBe(false);
      expect(parseHistory(root, { latest: true }).ok).toBe(false);
      expect(parseHistory(root, { latest: true, currentValue: newText + 'unexplained' }).ok).toBe(
        false,
      );
      expect(root.innerHTML).toBe(original);
    },
  );
  it.each([
    [' old\n', ' new\n\n', true],
    ['"old"', '"new"', true],
    ['old, value', 'new, value', false],
    ['', 'added', true],
    ['deleted', '', false],
    [
      '<span class="waffle-blameview-formula-text">=IF(A1="", "old", 1)</span>',
      '<span class="waffle-blameview-formula-text">=IF(A1="", "new", 1)</span>',
      true,
    ],
  ] as const)(
    'reads full replacements with or without the empty label (%#)',
    (oldValue, newValue, empty) => {
      const root = document.createElement('div');
      root.innerHTML = replacement(oldValue, newValue, empty);
      const value = (html: string) => {
        const node = document.createElement('div');
        node.innerHTML = html;
        return node.textContent;
      };
      const expected = {
        ok: true,
        change: { kind: 'replace', oldText: value(oldValue), newText: value(newValue) },
      };
      expect(isPartialHistory(root)).toBe(false);
      expect(parseHistory(root)).toEqual(expected);
      expect(parseHistory(root, { latest: false })).toEqual(expected);
    },
  );
  it.each(['추가됨', '삭제됨'] as const)(
    'reads full %s operations with text and formulas',
    (action) => {
      for (const content of [
        ' value\n',
        '<span class="waffle-blameview-formula-text">=IF(A1="", "ok", 1)</span>',
      ]) {
        const root = document.createElement('div');
        root.innerHTML = operation(content, action);
        const node = document.createElement('div');
        node.innerHTML = content;
        const added = action === '추가됨';
        expect(parseHistory(root)).toEqual({
          ok: true,
          change: {
            kind: added ? 'add' : 'delete',
            oldText: added ? '' : node.textContent,
            newText: added ? node.textContent : '',
          },
        });
      }
    },
  );
  it.each([
    [replacement('banana', 'orange') + ' ' + within('apple banana citrus'), 'apple orange citrus'],
    [
      replacement('banana', 'orange') +
        ', ' +
        within('apple banana citrus') +
        ', ' +
        within('apple banana citrus'),
      'apple orange citrus',
    ],
    [
      replacement('banana', 'orange') + ', ' + within('apple banana citrus') + '<span>extra</span>',
      'apple orange citrus',
    ],
    [
      replacement('banana', 'orange') + label('') + ', ' + within('apple banana citrus'),
      'apple orange citrus',
    ],
    [
      replacement('banana', 'orange', false) +
        label('unexpected') +
        ', ' +
        within('apple banana citrus'),
      'apple orange citrus',
    ],
    [
      replacement('banana', 'orange', false) +
        '<span class="docs-blame-bold-text"><i></i></span>, ' +
        within('apple banana citrus'),
      'apple orange citrus',
    ],
    [
      '"banana"이(가) "orange"(으)로 <span class="docs-blame-bold-text"><span>교체됨</span></span>, ' +
        within('apple banana citrus'),
      'apple orange citrus',
    ],
    [
      label('Replaced:') +
        ' "banana" ' +
        label('with') +
        ' "orange", ' +
        within('apple banana citrus'),
      'apple orange citrus',
    ],
    [
      '"banana"이(가) "orange"로 ' + label('교체됨') + ', ' + within('apple banana citrus'),
      'apple orange citrus',
    ],
    [operation('orange', '추가됨') + ', ' + label('이내'), 'orange'],
  ])(
    'rejects malformed partial structure even when the described edit could match (%#)',
    (html, currentValue) => {
      const root = document.createElement('div');
      root.innerHTML = html;
      expect(isPartialHistory(root)).toBe(true);
      const original = root.innerHTML;
      expect(parseHistory(root, { latest: true, currentValue }).ok).toBe(false);
      expect(root.innerHTML).toBe(original);
    },
  );
  it.each([
    '"old" "new"(으)로 ' + label('교체됨'),
    '"old"이(가) "new ' + label('교체됨'),
    'old이(가) ' + label('추가됨'),
    '"old" ' + label('삭제됨'),
    replacement('old', '<span>new</span>'),
    replacement('a"이(가) "b', 'c'),
    replacement('old', 'new') + ', ' + operation('extra', '추가됨'),
  ])(
    'rejects missing quotes, ambiguous replacements and operations without full context (%#)',
    (html) => expect(parse(html).ok).toBe(false),
  );
});
