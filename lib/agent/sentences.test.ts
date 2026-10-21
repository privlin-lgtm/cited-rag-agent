import { describe, expect, it } from 'vitest';
import { splitSentences } from './sentences';

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
const words = (count: number, prefix = 'w') => Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(' ');

describe('splitSentences', () => {
  it('keeps "12 C.F.R. 1005.31" in one block', () => {
    expect(splitSentences('A provider must comply with 12 C.F.R. 1005.31 before payment. It must also disclose fees.')).toEqual([
      'A provider must comply with 12 C.F.R. 1005.31 before payment.',
      'It must also disclose fees.',
    ]);
  });

  it('keeps "§ 1005.33(a)" in one block', () => {
    expect(splitSentences('Under § 1005.33(a), the provider must investigate. The sender may ask for a report.')).toEqual([
      'Under § 1005.33(a), the provider must investigate.',
      'The sender may ask for a report.',
    ]);
  });

  it.each([
    ['See 15 U.S.C. 1693o-1 for the statute. Then read on.', 'See 15 U.S.C. 1693o-1 for the statute.'],
    ['The U.S. Congress passed it. Then it was signed.', 'The U.S. Congress passed it.'],
    ['Use a bank, e.g. a credit union, for this. Then wait.', 'Use a bank, e.g. a credit union, for this.'],
    ['Fees, i.e. charges, apply here. Then they stop.', 'Fees, i.e. charges, apply here.'],
    ['Banks, etc. Must disclose this. Then done.', 'Banks, etc. Must disclose this.'],
    ['Regulation (EU) No. 1093/2010 applies here. Then more.', 'Regulation (EU) No. 1093/2010 applies here.'],
    ['Art. 5 applies to this case. Then more.', 'Art. 5 applies to this case.'],
    ['See para. 3 for details. Then more.', 'See para. 3 for details.'],
    ['Smith Inc. paid the fee in full. Then it left.', 'Smith Inc. paid the fee in full.'],
    ['Smith Ltd. paid the fee in full. Then it left.', 'Smith Ltd. paid the fee in full.'],
  ])('rejoins an abbreviation or citation: %s', (text, first) => {
    expect(splitSentences(text)[0]).toBe(first);
  });

  it('joins a bare list number to the text after it', () => {
    expect(splitSentences('1.\nFirst item text here. Second sentence.')).toEqual(['1. First item text here.', 'Second sentence.']);
  });

  it('starts a new block at each list marker and joins wrapped lines', () => {
    expect(splitSentences('The provider must:\n(a) disclose the exchange rate;\n(b) disclose the fees\nand taxes;\n- keep records')).toEqual([
      'The provider must:',
      '(a) disclose the exchange rate;',
      '(b) disclose the fees and taxes;',
      '- keep records',
    ]);
  });

  it('makes each table row its own block', () => {
    expect(splitSentences('Fee | Amount\n--- | ---\nWire | $5.00. Extra | Row\n\nAfter the table.')).toEqual([
      'Fee | Amount',
      '--- | ---',
      'Wire | $5.00. Extra | Row',
      'After the table.',
    ]);
  });

  it('splits a block over 80 words at semicolons, then every 60 words', () => {
    const semicolons = `${words(50, 'a')}; ${words(50, 'b')}; ${words(10, 'c')}.`;
    expect(splitSentences(semicolons).map((block) => block.split(' ').length)).toEqual([50, 50, 10]);
    expect(splitSentences(`${words(200)}.`).map((block) => block.split(' ').length)).toEqual([60, 60, 60, 20]);
  });

  it('keeps blocks of 80 words or fewer whole', () => {
    expect(splitSentences(`${words(80)}.`)).toHaveLength(1);
  });

  it.each([
    'A provider must comply with 12 C.F.R. 1005.31 before payment. It must also disclose fees.\n\nSecond paragraph.',
    `Intro line\n(a) ${words(120)}; (b) ${words(30)}.\nFee | Amount\nWire | $5`,
    '  \n\n  Leading space.   Several    spaces here.  \n',
  ])('rejoins to the whitespace-collapsed text', (text) => {
    expect(splitSentences(text).join(' ')).toBe(collapse(text));
  });

  it('returns no blocks for empty text', () => {
    expect(splitSentences(' \n\n ')).toEqual([]);
  });
});
