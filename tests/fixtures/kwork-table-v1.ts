// Fully synthetic data and markup using ONLY owner-confirmed table semantics.
// Not copied from .local-acceptance; CSS classes and original personal data are absent.
export const TABLE_POLICY = { format: 'kwork-table-v1', urls: {
  hostname: 'kwork.ru', pathname: '/new_offer', projectParameter: 'project',
} } as const;
export const TABLE_HEADER = '<tr><td>Название</td><td>Покупатель</td><td>Цена</td></tr>';
export const TABLE_ROW = `<tr><td><div><a href="https://kwork.ru/new_offer?project=9000001">Синтетический интерфейс</a></div>
<div>Синтетическое описание, интерфейсы</div></td>
<td><a href="https://kwork.ru/user/synthetic-buyer"><img src="https://example.invalid/avatar"><div>Синтетический покупатель</div></a>
<div><div>33 проектов на бирже</div><div>44% нанято</div></div></td><td>5 555 ₽</td></tr>`;
export const TABLE_HTML = `<html><body><table><tr><td>Служебная таблица</td></tr><tr><td><div>
<table>${TABLE_HEADER}${TABLE_ROW}</table></div></td></tr></table></body></html>`;
