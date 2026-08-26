/**
 * Agda tokenizer — the ported codemirror-agda mode, driven line by
 * line through a real StringStream with the state carried across
 * lines (the way StreamLanguage runs it). One token per step: the
 * consumed text and the style name it produced.
 */

import { StringStream } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { type AgdaTokenState, agdaToken } from '../../src/language/agda';

interface Token {
  text: string;
  style: string | null;
}

/** Tokenize `text`, threading one state through all lines. */
function tokenize(text: string): Token[] {
  const state: AgdaTokenState = { stack: ['start'] };
  // Raw per-line tokens, then merged across lines with '\n' kept.
  const raw: Array<Token & { line: number }> = [];
  text.split('\n').forEach((line, lineNo) => {
    const stream = new StringStream(line, 2, 2);
    while (!stream.eol()) {
      const before = stream.pos;
      const style = agdaToken(stream, state);
      const consumed = line.slice(before, stream.pos);
      if (consumed === '') break; // safety: never spin
      raw.push({ text: consumed, style, line: lineNo });
    }
  });
  const tokens: Array<Token & { line: number }> = [];
  for (const tok of raw) {
    const last = tokens[tokens.length - 1];
    if (last !== undefined && last.style === tok.style) {
      last.text += (last.line === tok.line ? '' : '\n') + tok.text;
      last.line = tok.line;
    } else {
      tokens.push({ ...tok });
    }
  }
  return tokens.map(({ text, style }) => ({ text, style }));
}

function styles(text: string): Array<string | null> {
  return tokenize(text).map(t => t.style);
}

describe('agda tokenizer', () => {
  it('highlights keywords, leaving identifiers plain', () => {
    expect(styles('module Main where')).toEqual(['keyword', null, 'keyword']);
  });

  it('highlights unicode keywords and arrows', () => {
    expect(styles('λ x → x')).toEqual(['keyword', null, 'keyword', null]);
    expect(styles('∀')).toEqual(['keyword']);
    expect(styles('..')).toEqual(['keyword']);
  });

  it('does not take a keyword prefix of an identifier', () => {
    expect(styles('importing')).toEqual([null]);
    expect(styles('setData')).toEqual([null]);
  });

  it('highlights line and nested block comments', () => {
    expect(styles('-- a line comment')).toEqual(['comment']);
    expect(styles('{- outer {- inner -} still -}')).toEqual(['comment']);
    // State must return to start after the block closes (the space
    // between tokens is unstyled).
    expect(styles('{- c -} module')).toEqual(['comment', null, 'keyword']);
  });

  it('comments span lines until the closer', () => {
    const tokens = tokenize('{- one\ntwo -}\nmodule');
    expect(tokens[0]).toEqual({ text: '{- one\ntwo -}', style: 'comment' });
    expect(tokens[1]).toEqual({ text: 'module', style: 'keyword' });
  });

  it('marks interaction holes as keyword-delimited comment bodies', () => {
    expect(styles('{! x !}')).toEqual(['keyword', 'comment', 'keyword']);
    expect(styles('{! {! !} !}')).toEqual([
      'keyword',
      'comment',
      'keyword',
      'comment',
      'keyword',
      'comment',
      'keyword',
    ]);
  });

  it('highlights numbers with delimiting lookahead', () => {
    expect(styles('42')).toEqual(['number']);
    expect(styles('0x1F')).toEqual(['number']);
    expect(styles('3.14')).toEqual(['number']);
    expect(styles('1e-9')).toEqual(['number']);
    // No delimiter after: the lookahead fails, so it is not a number.
    expect(styles('1x')).toEqual([null]);
  });

  it('highlights module qualifiers but not the qualified name', () => {
    expect(styles('Data.Nat')).toEqual(['qualifier', null]);
  });

  it('highlights pragmas as meta', () => {
    expect(styles('{-# BUILTIN NATURAL ℕ #-}')).toEqual(['meta']);
  });

  it('highlights string literals with escapes; a bad escape errors', () => {
    expect(styles('"abc"')).toEqual(['string']);
    expect(styles('"a\\n99b"')).toEqual(['string']);
    // Newlines do not error in this mode: an unterminated string simply
    // continues on the next line.
    expect(tokenize('"abc\ndef"')).toEqual([{ text: '"abc\ndef"', style: 'string' }]);
    expect(styles('"a\\qb"')).toEqual(['string', 'string error', 'string']);
  });

  it('highlights character literals with escapes', () => {
    expect(styles("'a'")).toEqual(['string']);
    expect(styles("'\\n'")).toEqual(['string']);
    expect(styles("'\\x41'")).toEqual(['string']);
    // A char literal is exactly one char: the extra char is an error
    // inside the closing-quote state.
    expect(styles("'ab'")).toEqual(['string', 'string error', 'string']);
  });

  it('leaves identifiers and as-patterns unstyled', () => {
    expect(styles('suc zero xs@( y )')).toEqual([null]);
  });
});
