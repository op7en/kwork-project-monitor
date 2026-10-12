import { ident, parse } from 'css-tree';

/** Parse inline declarations only. No rendering, script execution, cascade or resource loading. */
export function inlineStyleHidesContent(style: string): boolean {
  if (style.length > 16_384) return true;
  try {
    const ast = parse(style, { context: 'declarationList' });
    if (ast.type !== 'DeclarationList') return true;
    for (const declaration of ast.children) {
      // Unparsed declaration fragments could conceal a visibility property; fail closed.
      if (declaration.type === 'Raw') return true;
      if (declaration.type !== 'Declaration') continue;
      const property = ident.decode(declaration.property).toLowerCase();
      if (!['display', 'visibility', 'mso-hide'].includes(property)) continue;
      if (declaration.value.type !== 'Value') return true;
      const values = declaration.value.children.toArray();
      // var()/unknown expressions cannot establish that a visibility declaration is safe.
      if (!values.length || values.some(value => value.type !== 'Identifier')) return true;
      const names = values.map(value => value.type === 'Identifier' ? ident.decode(value.name).toLowerCase() : '');
      if (property === 'display' && names.includes('none')) return true;
      if (property === 'visibility' && (names.length !== 1 ||
          !['visible', 'inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(names[0]!))) return true;
      if (property === 'mso-hide' && (names.length !== 1 || names[0] !== 'none')) return true;
    }
    return false;
  } catch {
    return true;
  }
}
