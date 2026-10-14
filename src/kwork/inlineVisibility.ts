import { ident, parse } from 'css-tree';

/** Parse inline declarations only. No rendering, script execution, cascade or resource loading. */
export function inlineStyleHidesContent(style: string): boolean {
  if (style.length > 16_384) return false;
  try {
    const ast = parse(style, { context: 'declarationList' });
    if (ast.type !== 'DeclarationList') return false;
    for (const declaration of ast.children) {
      // Unknown fragments are not evidence of hidden content.
      if (declaration.type !== 'Declaration') continue;
      const property = ident.decode(declaration.property).toLowerCase();
      if (!['display', 'visibility', 'mso-hide'].includes(property)) continue;
      if (declaration.value.type !== 'Value') continue;
      const values = declaration.value.children.toArray();
      const value = values[0];
      if (values.length !== 1 || value?.type !== 'Identifier') continue;
      const name = ident.decode(value.name).toLowerCase();
      if (property === 'display' && name === 'none') return true;
      if (property === 'visibility' && ['hidden', 'collapse'].includes(name)) return true;
      if (property === 'mso-hide' && name === 'all') return true;
    }
    return false;
  } catch {
    return false;
  }
}
