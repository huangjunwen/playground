/**
 * Agda syntax highlighting — a CodeMirror 6 port of the mode in
 * `@codewars/codemirror-agda` (ISC), which targets CM5's
 * `defineSimpleMode`. The rule table is kept verbatim; the simple-mode
 * machinery (a stack of state names, regex rules with push/pop/next)
 * is re-expressed as one `token` function for `StreamLanguage`, and
 * the two integer token names are unified to `number` (CM6 has no
 * `integer` tag). The tokenizer itself is exported so node tests can
 * drive it line by line without a DOM.
 */

import {
  HighlightStyle,
  StreamLanguage,
  type StringStream,
  syntaxHighlighting,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';

const floatRegex = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?=[.;{}()@"\s]|$)/u;
const integerRegex = /-?(?:0|[1-9]\d*|0x[0-9A-Fa-f]+)(?=[.;{}()@"\s]|$)/u;
const keywordsRegex = new RegExp(
  '(?:[_=|→:?\\\\λ∀]|->|\\.{2,3}|abstract|codata|coinductive|constructor|' +
    'data|do|eta-equality|field|forall|hiding|import|in|inductive|' +
    'infix|infixl|infixr|instance|let|macro|module|mutual|no-eta-equality|' +
    'open|overlap|pattern|postulate|primitive|private|public|quote|' +
    'quoteContext|quoteGoal|quoteTerm|record|renaming|rewrite|' +
    'syntax|tactic|to|unquote|unquoteDecl|unquoteDef|using|variable|where|with|' +
    'Set(?:\\d+|[₀₁₂₃₄₅₆₇₈₉]+)?)(?=[.;{}()@"\\s]|$)',
  'u',
);
const escapeDec = '0|[1-9]\\d*';
const escapeHex = 'x(?:0|[1-9A-Fa-f][0-9A-Fa-f]*)';
const escapeCode =
  '[abtnvf&\\\\\'"]|NUL|SOH|STX|ETX|EOT|ENQ|ACK|BEL|BS|HT|LF|VT|FF|CR|' +
  'SO|SI|DLE|DC[1-4]|NAK|SYN|ETB|CAN|EM|SUB|ESC|FS|GS|RS|US|SP|DEL';
const escapeChar = new RegExp(`\\\\(?:${escapeDec}|${escapeHex}|${escapeCode})`, 'u');

/** One simple-mode rule: an anchored regex plus its state transition. */
interface ModeRule {
  regex: RegExp;
  /** Token style name (null = consume unstyled); space-separated names combine. */
  token: string | null;
  /** Push a state onto the stack. */
  push?: string;
  /** Replace the top of the stack. */
  next?: string;
  /** Pop the top of the stack. */
  pop?: boolean;
}

const rules: Record<string, ModeRule[]> = {
  start: [
    { regex: /\{-#.*?#-\}/u, token: 'meta' },
    { regex: /\{-/u, token: 'comment', push: 'comment' },
    { regex: /\{!/u, token: 'keyword', push: 'hole' },
    { regex: /--.*/u, token: 'comment' },
    { regex: floatRegex, token: 'number' },
    { regex: integerRegex, token: 'number' },
    { regex: /'/u, token: 'string', push: 'charLit' },
    { regex: /"/u, token: 'string', push: 'strLit' },
    { regex: keywordsRegex, token: 'keyword' },
    { regex: /[^\s.;{}()@"]+\./u, token: 'qualifier' },
    { regex: /[^\s.;{}()@"]+/u, token: null },
    { regex: /./u, token: null },
  ],
  comment: [
    { regex: /\{-/u, token: 'comment', push: 'comment' },
    { regex: /-\}/u, token: 'comment', pop: true },
    { regex: /./u, token: 'comment' },
  ],
  hole: [
    { regex: /\{!/u, token: 'keyword', push: 'hole' },
    { regex: /!\}/u, token: 'keyword', pop: true },
    { regex: /./u, token: 'comment' },
  ],
  charLit: [
    { regex: /'/u, token: 'string error', pop: true },
    { regex: /[^'\\]/u, token: 'string', next: 'charLitEnd' },
    { regex: escapeChar, token: 'string', next: 'charLitEnd' },
    { regex: /./u, token: 'string error' },
  ],
  charLitEnd: [
    { regex: /'/u, token: 'string', pop: true },
    { regex: /./u, token: 'string error' },
    { regex: /[\s\S]/u, token: 'string error', pop: true },
  ],
  strLit: [
    { regex: /"/u, token: 'string', pop: true },
    { regex: /[^"\\]/u, token: 'string' },
    { regex: escapeChar, token: 'string' },
    { regex: /./u, token: 'string error' },
  ],
};

/** The tokenizer's stack of state names; `['start']` when at top level. */
export interface AgdaTokenState {
  stack: string[];
}

/**
 * One token step: try the current state's rules in order, consume the
 * first regex that matches (anchored at the stream position) and apply
 * its transition. Returns the token style name, or null for plain.
 */
export function agdaToken(stream: StringStream, state: AgdaTokenState): string | null {
  const top = state.stack[state.stack.length - 1] ?? 'start';
  for (const rule of rules[top] ?? rules.start!) {
    const matched = stream.match(rule.regex);
    if (matched === null) continue;
    if (rule.pop === true && state.stack.length > 1) state.stack.pop();
    else if (rule.push !== undefined) state.stack.push(rule.push);
    else if (rule.next !== undefined) state.stack[state.stack.length - 1] = rule.next;
    return rule.token;
  }
  stream.next();
  return null;
}

/**
 * Token classes keyed to the palette variables in main.css. A main
 * (non-fallback) highlight style, so it takes precedence over
 * basicSetup's default palette.
 */
export const agdaHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, class: 'tok-keyword' },
  { tag: tags.comment, class: 'tok-comment' },
  { tag: tags.string, class: 'tok-string' },
  { tag: tags.number, class: 'tok-number' },
  { tag: tags.meta, class: 'tok-meta' },
  { tag: tags.modifier, class: 'tok-qualifier' },
  { tag: tags.invalid, class: 'tok-invalid' },
]);

/** The Agda stream language: tokenizer plus block/line comment data. */
export const agdaLanguage = StreamLanguage.define({
  name: 'agda',
  startState: (): AgdaTokenState => ({ stack: ['start'] }),
  copyState: (state: AgdaTokenState): AgdaTokenState => ({ stack: [...state.stack] }),
  token: agdaToken,
  languageData: {
    commentTokens: {
      block: { open: '{-', close: '-}' },
      line: '--',
    },
  },
});

/** Everything the editor needs for Agda: the language plus its colors. */
export function agda() {
  return [agdaLanguage, syntaxHighlighting(agdaHighlightStyle)];
}
