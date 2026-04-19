const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
  { kind: 'phone_intl', re: /\+?\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3}[\s-]?\d{3,4}/g },
  { kind: 'cnp', re: /\b[1-9]\d{12}\b/g },
  { kind: 'cui', re: /\bRO\d{2,10}\b/g },
];

export interface SanitizeReplacement {
  kind: string;
  placeholder: string;
  original: string;
}

export interface SanitizeResult {
  sanitized: string;
  replacements: SanitizeReplacement[];
}

export function sanitizeText(input: string): SanitizeResult {
  const replacements: SanitizeReplacement[] = [];
  const counters = new Map<string, number>();
  let out = input;

  for (const { kind, re } of PATTERNS) {
    out = out.replace(re, (match) => {
      const current = counters.get(kind) ?? 0;
      const next = current + 1;
      counters.set(kind, next);
      const placeholder = `[${kind.toUpperCase()}_${next}]`;
      replacements.push({ kind, placeholder, original: match });
      return placeholder;
    });
  }
  return { sanitized: out, replacements };
}
