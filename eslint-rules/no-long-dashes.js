const LONG_DASHES = /[\u2013\u2014]/g;

function dashOffsets(text) {
  const offsets = [];

  for (const match of text.matchAll(LONG_DASHES)) {
    offsets.push(match.index);
  }

  return offsets;
}

function positionAt(text, offset) {
  let column = 0;
  let line = 1;

  for (let i = 0; i < offset; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }

  return { column, line };
}

export default {
  meta: {
    docs: { description: 'Disallow the em dash (U+2014) and the en dash (U+2013); use contextually appropriate punctuation instead' },
    messages: {
      noLongDash:
        'Use the appropriate punctuation instead of an em dash (U+2014) or en dash (U+2013). Pick what fits the context: a comma or parentheses around an aside, a colon before a defining list or answer, a hyphen (-) inside a compound descriptor, or "to" between a numeric range.',
    },
    schema: [],
    type: 'problem',
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const text = sourceCode.getText();

    return {
      'Program:exit'() {
        for (const offset of dashOffsets(text)) {
          const loc = positionAt(text, offset);

          context.report({ loc, messageId: 'noLongDash' });
        }
      },
    };
  },
};
