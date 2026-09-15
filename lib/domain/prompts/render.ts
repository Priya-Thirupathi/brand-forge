export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    if (!(key in variables)) {
      throw new Error(`Missing template variable "${key}"`);
    }
    return variables[key];
  });
}
