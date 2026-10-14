/** Trusted source configuration. No expressions or commands are taken from email. */
export const FILTER_RULES = {
  primary: [/\breact\b/iu, /\btypescript\b/iu, /\bjavascript\b/iu, /\bnode(?:\.js|js)?\b/iu,
    /\bexpress\b/iu, /\brest\s+api\b/iu, /\bpostgres(?:ql)?\b/iu, /\bmongodb\b/iu],
  auxiliary: [/\bpython\b/iu, /telegram|телеграм/iu],
  task: [/исправ|баг|ошибк|bug\s*fix|fix\b/iu, /добав|доработ|кнопк|верстк|вёрстк|ui\b/iu,
    /скрипт|script|автоматизац|интеграц|integration|sql\s+запрос/iu,
    /сдела|созда|разработ|написа|настро|подключ|парсер|parser|бот|bot|сайт|лендинг|landing|приложен|апи|api|бэкенд|backend|фронтенд|frontend|баз[ауы]\s+данн|docker|депло|deploy/iu],
  small: [/небольш|прост(?:ой|ая|ую)|маленьк|small|simple/iu],
  unwanted: [/wordpress|\bwp\b|битрикс|bitrix|modx|(?:^|[^\p{L}\p{N}])1[сc](?:$|[^\p{L}\p{N}])/iu],
  complex: [/reverse\s+engineering|реверс|обратн.{0,12}инженер/iu,
    /(?:больш|крупн).{0,35}(?:магазин|систем|платформ|fullstack)|(?:магазин|систем|платформ).{0,25}с\s+нуля|fullstack|full\s+stack/iu],
  ambiguous: [/(?:^|[^\p{L}])(?:не|без|not|without)\s+(?:react|typescript|javascript|node|python|telegram|express|rest|postgres|mongodb)/iu,
    /цитат|чуж.{0,20}(?:ваканси|технолог)|не\s+связан|ранее\s+использовал|друг(?:ая|ую)\s+технолог|конкурент|перечень\s+технолог/iu,
    /(?:react|typescript|javascript|node|python).{0,25}(?:не\s+использу|не\s+относит)|(?:not|не)\s+(?:use|использу\w*|использу[\p{L}]*).{0,15}(?:react|javascript|typescript|node)/iu,
    /[«"“][^»"”\n]{0,100}(?:react|typescript|javascript|node|python)[^»"”\n]{0,100}[»"”]/iu],
  unrelated: [/логотип|logo\b|копирайт|перевод\s+текст|озвучк|монтаж\s+видео/iu],
  cautionPrice: 20_000, cautionHireRate: 30, cautionCustomerProjects: 5,
} as const;
export interface FilterRules {
  primary: readonly RegExp[]; auxiliary: readonly RegExp[]; task: readonly RegExp[]; small: readonly RegExp[];
  unwanted: readonly RegExp[]; complex: readonly RegExp[]; unrelated: readonly RegExp[];
  ambiguous: readonly RegExp[];
  cautionPrice: number; cautionHireRate: number; cautionCustomerProjects: number;
}
