const SEPARATOR = ':';

export function generateId(label: string, name: string): string {
  return label + SEPARATOR + name;
}
