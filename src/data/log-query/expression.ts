/** Safe parser/evaluator for derived log expressions. */

/** A parsed arithmetic expression. */
export type ExpressionNode =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'ref'; readonly message: string; readonly field: string }
  | { readonly kind: 'unary'; readonly op: '+' | '-'; readonly expr: ExpressionNode }
  | {
      readonly kind: 'binary';
      readonly op: '+' | '-' | '*' | '/';
      readonly left: ExpressionNode;
      readonly right: ExpressionNode;
    };

/** A unique series reference extracted from a derived expression. */
export interface SeriesRef {
  readonly message: string;
  readonly field: string;
}

type Token =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'ident'; readonly value: string }
  | { readonly kind: 'symbol'; readonly value: '+' | '-' | '*' | '/' | '(' | ')' | '.' }
  | { readonly kind: 'eof' };

/** Parse a derived expression without using eval/Function. */
export function parseExpression(input: string): ExpressionNode {
  const parser = new Parser(tokenize(input));
  const expr = parser.parseExpression();
  parser.expectEof();
  return expr;
}

/** Return unique series references in first-use order. */
export function collectSeriesRefs(expr: ExpressionNode): readonly SeriesRef[] {
  const out: SeriesRef[] = [];
  const seen = new Set<string>();
  visit(expr, (ref) => {
    const key = `${ref.message}\u0000${ref.field}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  });
  return out;
}

/** Evaluate an expression at one timestamp. */
export function evaluateExpression(
  expr: ExpressionNode,
  resolve: (message: string, field: string) => number,
): number {
  switch (expr.kind) {
    case 'number':
      return expr.value;
    case 'ref':
      return resolve(expr.message, expr.field);
    case 'unary': {
      const value = evaluateExpression(expr.expr, resolve);
      return expr.op === '-' ? -value : value;
    }
    case 'binary': {
      const left = evaluateExpression(expr.left, resolve);
      const right = evaluateExpression(expr.right, resolve);
      switch (expr.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return left / right;
      }
    }
  }
}

function visit(expr: ExpressionNode, onRef: (ref: SeriesRef) => void): void {
  switch (expr.kind) {
    case 'number':
      return;
    case 'ref':
      onRef({ message: expr.message, field: expr.field });
      return;
    case 'unary':
      visit(expr.expr, onRef);
      return;
    case 'binary':
      visit(expr.left, onRef);
      visit(expr.right, onRef);
      return;
  }
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parseExpression(): ExpressionNode {
    return this.parseAdditive();
  }

  expectEof(): void {
    const token = this.peek();
    if (token.kind !== 'eof') throw new SyntaxError('Unexpected token after expression');
  }

  private parseAdditive(): ExpressionNode {
    let expr = this.parseMultiplicative();
    while (this.matchSymbol('+') || this.matchSymbol('-')) {
      const op = this.previousOperator();
      const right = this.parseMultiplicative();
      expr = { kind: 'binary', op, left: expr, right };
    }
    return expr;
  }

  private parseMultiplicative(): ExpressionNode {
    let expr = this.parseUnary();
    while (this.matchSymbol('*') || this.matchSymbol('/')) {
      const op = this.previousOperator();
      const right = this.parseUnary();
      expr = { kind: 'binary', op, left: expr, right };
    }
    return expr;
  }

  private parseUnary(): ExpressionNode {
    if (this.matchSymbol('+')) return { kind: 'unary', op: '+', expr: this.parseUnary() };
    if (this.matchSymbol('-')) return { kind: 'unary', op: '-', expr: this.parseUnary() };
    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionNode {
    const token = this.advance();
    if (token.kind === 'number') return { kind: 'number', value: token.value };
    if (token.kind === 'ident') return this.parseRef(token.value);
    if (token.kind === 'symbol' && token.value === '(') {
      const expr = this.parseExpression();
      this.expectSymbol(')');
      return expr;
    }
    throw new SyntaxError('Expected a number, series reference, or parenthesized expression');
  }

  private parseRef(message: string): ExpressionNode {
    this.expectSymbol('.');
    const field = this.advance();
    if (field.kind !== 'ident') throw new SyntaxError('Expected field name after message dot');
    return { kind: 'ref', message, field: field.value };
  }

  private matchSymbol(value: TokenSymbol): boolean {
    const token = this.peek();
    if (token.kind !== 'symbol' || token.value !== value) return false;
    this.index += 1;
    return true;
  }

  private expectSymbol(value: TokenSymbol): void {
    if (!this.matchSymbol(value)) throw new SyntaxError(`Expected "${value}"`);
  }

  private previousOperator(): OperatorSymbol {
    const token = this.tokens[this.index - 1];
    if (token?.kind === 'symbol' && isOperator(token.value)) return token.value;
    throw new SyntaxError('Expected operator');
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { kind: 'eof' };
  }

  private advance(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }
}

type OperatorSymbol = '+' | '-' | '*' | '/';
type TokenSymbol = OperatorSymbol | '(' | ')' | '.';

function tokenize(input: string): readonly Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    if (char === undefined) break;
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (isDigit(char) || (char === '.' && isDigit(input[index + 1] ?? ''))) {
      const parsed = scanNumber(input, index);
      tokens.push({ kind: 'number', value: parsed.value });
      index = parsed.end;
      continue;
    }
    if (isSymbol(char)) {
      tokens.push({ kind: 'symbol', value: char });
      index += 1;
      continue;
    }
    if (isIdentStart(char)) {
      const start = index;
      index += 1;
      while (index < input.length) {
        const next = input[index];
        if (next === undefined || !isIdentPart(next)) break;
        index += 1;
      }
      tokens.push({ kind: 'ident', value: input.slice(start, index) });
      continue;
    }
    throw new SyntaxError(`Unexpected character "${char}"`);
  }

  tokens.push({ kind: 'eof' });
  return tokens;
}

function scanNumber(
  input: string,
  start: number,
): { readonly value: number; readonly end: number } {
  let index = start;
  let sawDigit = false;

  while (index < input.length) {
    const char = input[index];
    if (char === undefined || !isDigit(char)) break;
    sawDigit = true;
    index += 1;
  }

  if (input[index] === '.') {
    index += 1;
    while (index < input.length) {
      const char = input[index];
      if (char === undefined || !isDigit(char)) break;
      sawDigit = true;
      index += 1;
    }
  }

  if (!sawDigit) throw new SyntaxError('Expected number');

  const exponent = input[index];
  if (exponent === 'e' || exponent === 'E') {
    const exponentStart = index;
    index += 1;
    const sign = input[index];
    if (sign === '+' || sign === '-') index += 1;
    let exponentDigits = 0;
    while (index < input.length) {
      const char = input[index];
      if (char === undefined || !isDigit(char)) break;
      exponentDigits += 1;
      index += 1;
    }
    if (exponentDigits === 0) index = exponentStart;
  }

  const raw = input.slice(start, index);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new SyntaxError(`Invalid number "${raw}"`);
  return { value, end: index };
}

function isSymbol(char: string): char is TokenSymbol {
  return isOperator(char) || char === '(' || char === ')' || char === '.';
}

function isOperator(char: string): char is OperatorSymbol {
  return char === '+' || char === '-' || char === '*' || char === '/';
}

function isIdentStart(char: string): boolean {
  return /[A-Za-z_]/u.test(char);
}

function isIdentPart(char: string): boolean {
  return /[A-Za-z0-9_]/u.test(char);
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}
