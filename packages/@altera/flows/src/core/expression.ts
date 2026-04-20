import { createFailure } from './errors.ts';
import type { JsonValue } from './types.ts';

type TokenType =
  | 'identifier'
  | 'number'
  | 'string'
  | 'operator'
  | 'dot'
  | 'leftParen'
  | 'rightParen'
  | 'eof';

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

export type ExpressionNode =
  | { type: 'literal'; value: string | number | boolean | null }
  | { type: 'reference'; segments: string[] }
  | { type: 'unary'; operator: '!' | '-'; operand: ExpressionNode }
  | {
      type: 'binary';
      operator: '==' | '!=' | '&&' | '||' | '+' | '-' | '*' | '/' | '%' | '<' | '<=' | '>' | '>=';
      left: ExpressionNode;
      right: ExpressionNode;
    };

export interface ExpressionScope {
  input?: unknown;
  state?: unknown;
  env?: unknown;
  context?: unknown;
  item?: unknown;
  output?: unknown;
  [key: string]: unknown;
}

const SUPPORTED_ROOTS = new Set(['input', 'state', 'env', 'context', 'item', 'output']);

export function isInterpolation(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('${') && trimmed.endsWith('}');
}

export function unwrap(value: string): string {
  const trimmed = value.trim();
  if (!isInterpolation(trimmed))
    throw createFailure('EXPRESSION_EVALUATION_ERROR', `Invalid expression: ${value}`);
  return trimmed.slice(2, -1).trim();
}

export function parseExpression(raw: string): ExpressionNode {
  const source = isInterpolation(raw) ? unwrap(raw) : raw;
  const parser = new Parser(tokenize(source));
  return parser.parse();
}

export function evaluate(expr: string | ExpressionNode, scope: ExpressionScope): unknown {
  const ast = typeof expr === 'string' ? parseExpression(expr) : expr;
  return evalNode(ast, scope);
}

function evalNode(node: ExpressionNode, scope: ExpressionScope): unknown {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'reference':
      return resolveRef(node.segments, scope);
    case 'unary': {
      const operand = evalNode(node.operand, scope);
      return node.operator === '!' ? !operand : -toNumber(operand);
    }
    case 'binary': {
      const left = evalNode(node.left, scope);
      const right = evalNode(node.right, scope);
      switch (node.operator) {
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '&&':
          return Boolean(left) && Boolean(right);
        case '||':
          return Boolean(left) || Boolean(right);
        case '+':
          return typeof left === 'string' || typeof right === 'string'
            ? `${left ?? ''}${right ?? ''}`
            : toNumber(left) + toNumber(right);
        case '-':
          return toNumber(left) - toNumber(right);
        case '*':
          return toNumber(left) * toNumber(right);
        case '/':
          return toNumber(left) / toNumber(right);
        case '%':
          return toNumber(left) % toNumber(right);
        case '<':
          return toNumber(left) < toNumber(right);
        case '<=':
          return toNumber(left) <= toNumber(right);
        case '>':
          return toNumber(left) > toNumber(right);
        case '>=':
          return toNumber(left) >= toNumber(right);
      }
    }
  }
}

function resolveRef(segments: string[], scope: ExpressionScope): unknown {
  const [root, ...rest] = segments;
  if (!root) return undefined;
  if (!SUPPORTED_ROOTS.has(root) && !(root in scope)) {
    throw createFailure('EXPRESSION_EVALUATION_ERROR', `Unsupported expression root: ${root}`);
  }
  let current: unknown = (scope as Record<string, unknown>)[root];
  for (const segment of rest) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  throw createFailure(
    'EXPRESSION_EVALUATION_ERROR',
    `Expected number in expression, got ${typeof value}`,
  );
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'leftParen', value: ch, position: i });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rightParen', value: ch, position: i });
      i++;
      continue;
    }
    if (ch === '.') {
      tokens.push({ type: 'dot', value: ch, position: i });
      i++;
      continue;
    }

    const two = source.slice(i, i + 2);
    if (['==', '!=', '&&', '||', '<=', '>='].includes(two)) {
      tokens.push({ type: 'operator', value: two, position: i });
      i += 2;
      continue;
    }
    if (['!', '+', '-', '*', '/', '%', '<', '>'].includes(ch)) {
      tokens.push({ type: 'operator', value: ch, position: i });
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const [v, next] = readString(source, i);
      tokens.push({ type: 'string', value: v, position: i });
      i = next;
      continue;
    }
    if (/\d/.test(ch)) {
      const [v, next] = readNumber(source, i);
      tokens.push({ type: 'number', value: v, position: i });
      i = next;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const [v, next] = readIdent(source, i);
      tokens.push({ type: 'identifier', value: v, position: i });
      i = next;
      continue;
    }
    throw createFailure('EXPRESSION_EVALUATION_ERROR', `Unexpected character '${ch}' at ${i}`);
  }
  tokens.push({ type: 'eof', value: '', position: source.length });
  return tokens;
}

function readString(source: string, start: number): [string, number] {
  const quote = source[start];
  let i = start + 1;
  let value = '';
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      const next = source[i + 1];
      if (next === undefined) break;
      value += next;
      i += 2;
      continue;
    }
    if (ch === quote) return [value, i + 1];
    value += ch;
    i++;
  }
  throw createFailure('EXPRESSION_EVALUATION_ERROR', 'Unterminated string');
}

function readNumber(source: string, start: number): [string, number] {
  let i = start;
  while (i < source.length && /[\d.]/.test(source[i]!)) i++;
  return [source.slice(start, i), i];
}

function readIdent(source: string, start: number): [string, number] {
  let i = start;
  while (i < source.length && /[A-Za-z0-9_]/.test(source[i]!)) i++;
  return [source.slice(start, i), i];
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): ExpressionNode {
    const expr = this.parseOr();
    this.expect('eof');
    return expr;
  }
  private parseOr(): ExpressionNode {
    let node = this.parseAnd();
    while (this.matchOp('||'))
      node = { type: 'binary', operator: '||', left: node, right: this.parseAnd() };
    return node;
  }
  private parseAnd(): ExpressionNode {
    let node = this.parseEq();
    while (this.matchOp('&&'))
      node = { type: 'binary', operator: '&&', left: node, right: this.parseEq() };
    return node;
  }
  private parseEq(): ExpressionNode {
    let node = this.parseCmp();
    while (true) {
      if (this.matchOp('==')) {
        node = { type: 'binary', operator: '==', left: node, right: this.parseCmp() };
        continue;
      }
      if (this.matchOp('!=')) {
        node = { type: 'binary', operator: '!=', left: node, right: this.parseCmp() };
        continue;
      }
      return node;
    }
  }
  private parseCmp(): ExpressionNode {
    let node = this.parseAdd();
    while (true) {
      for (const op of ['<=', '>=', '<', '>'] as const) {
        if (this.matchOp(op)) {
          node = { type: 'binary', operator: op, left: node, right: this.parseAdd() };
          continue;
        }
      }
      return node;
    }
  }
  private parseAdd(): ExpressionNode {
    let node = this.parseMul();
    while (true) {
      if (this.matchOp('+')) {
        node = { type: 'binary', operator: '+', left: node, right: this.parseMul() };
        continue;
      }
      if (this.matchOp('-')) {
        node = { type: 'binary', operator: '-', left: node, right: this.parseMul() };
        continue;
      }
      return node;
    }
  }
  private parseMul(): ExpressionNode {
    let node = this.parseUnary();
    while (true) {
      if (this.matchOp('*')) {
        node = { type: 'binary', operator: '*', left: node, right: this.parseUnary() };
        continue;
      }
      if (this.matchOp('/')) {
        node = { type: 'binary', operator: '/', left: node, right: this.parseUnary() };
        continue;
      }
      if (this.matchOp('%')) {
        node = { type: 'binary', operator: '%', left: node, right: this.parseUnary() };
        continue;
      }
      return node;
    }
  }
  private parseUnary(): ExpressionNode {
    if (this.matchOp('!')) return { type: 'unary', operator: '!', operand: this.parseUnary() };
    if (this.matchOp('-')) return { type: 'unary', operator: '-', operand: this.parseUnary() };
    return this.parsePrimary();
  }
  private parsePrimary(): ExpressionNode {
    if (this.match('leftParen')) {
      const e = this.parseOr();
      this.expect('rightParen');
      return e;
    }
    const tok = this.peek();
    if (tok.type === 'number') {
      this.index++;
      return { type: 'literal', value: Number(tok.value) };
    }
    if (tok.type === 'string') {
      this.index++;
      return { type: 'literal', value: tok.value };
    }
    if (tok.type === 'identifier') {
      this.index++;
      if (tok.value === 'true' || tok.value === 'false')
        return { type: 'literal', value: tok.value === 'true' };
      if (tok.value === 'null') return { type: 'literal', value: null };
      const segments = [tok.value];
      while (this.match('dot')) {
        const seg = this.expect('identifier');
        segments.push(seg.value);
      }
      return { type: 'reference', segments };
    }
    throw createFailure('EXPRESSION_EVALUATION_ERROR', `Unexpected token '${tok.value}'`);
  }

  private match(type: TokenType): boolean {
    if (this.peek().type !== type) return false;
    this.index++;
    return true;
  }
  private matchOp(op: string): boolean {
    const tok = this.peek();
    if (tok.type !== 'operator' || tok.value !== op) return false;
    this.index++;
    return true;
  }
  private expect(type: TokenType): Token {
    const tok = this.peek();
    if (tok.type !== type)
      throw createFailure('EXPRESSION_EVALUATION_ERROR', `Expected ${type} but got '${tok.value}'`);
    this.index++;
    return tok;
  }
  private peek(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!;
  }
}

export function interpolateValue(value: unknown, scope: ExpressionScope): JsonValue {
  if (value == null) return value as null;
  if (typeof value === 'string') {
    if (isInterpolation(value)) return evaluate(value, scope) as JsonValue;
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => interpolateValue(v, scope)) as JsonValue;
  if (typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateValue(v, scope);
    }
    return out;
  }
  return value as JsonValue;
}
