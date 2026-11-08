export const partialLabels = {
  en: {
    context: 'within',
    replace: 'Replaced:',
    separator: 'with',
    add: 'Added:',
    delete: 'Deleted:',
  },
  es: {
    context: 'en',
    replace: 'Sustituido:',
    separator: 'por',
    add: 'Añadido:',
    delete: 'Eliminado:',
  },
  fr: {
    context: 'période',
    replace: 'Valeur',
    separator: 'remplacée par',
    add: 'Valeur ajoutée',
    delete: 'Valeur supprimée',
  },
  id: {
    context: 'dalam',
    replace: 'Mengganti:',
    separator: 'dengan',
    add: 'Menambahkan:',
    delete: 'Menghapus:',
  },
  ptBR: {
    context: 'período:',
    replace: 'Substituído:',
    separator: 'por',
    add: 'Adicionado:',
    delete: 'Excluído:',
  },
  ru: {
    context: 'исходный текст:',
    replace: 'Заменено:',
    separator: 'на',
    add: 'Добавлено:',
    delete: 'Удалено:',
  },
  de: {
    context: 'innerhalb von',
    replace: 'Ersetzt:',
    separator: 'durch',
    add: 'Hinzugefügt:',
    delete: 'Gelöscht:',
  },
  ar: {
    context: 'خلال',
    replace: 'تمّ استبدال:',
    separator: 'بالقيمة',
    add: 'تمّت إضافة:',
    delete: 'تمّ حذف:',
  },
  ja: {
    context: '期間',
    replace: '置き換えました:',
    separator: 'から',
    add: '追加しました:',
    delete: '削除しました:',
  },
  zhTW: {
    context: '範圍',
    replace: '已將「',
    separator: '」已取代為：',
    add: '已新增：',
    delete: '已刪除：',
  },
} as const;

export const koreanLabels = {
  context: '이내',
  replace: '교체됨',
  add: '추가됨',
  delete: '삭제됨',
} as const;

export type PartialLabels = (typeof partialLabels)[keyof typeof partialLabels];
