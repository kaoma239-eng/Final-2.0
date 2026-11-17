function formatNrcInput(value, selectionStart) {
  const input = String(value || '');
  const cursorPosition = Number.isInteger(selectionStart) ? selectionStart : input.length;
  const digitsBeforeCursor = (input.slice(0, cursorPosition).match(/\d/g) || []).length;
  const digits = input.replace(/\D/g, '').slice(0, 9);
  const formatted = digits.length < 6
    ? digits
    : `${digits.slice(0, 6)}/${digits.slice(6, 8)}${digits.length >= 8 ? `/${digits.slice(8)}` : ''}`;

  let formattedCaret = 0;
  let formattedDigits = 0;
  const targetDigits = Math.min(digitsBeforeCursor, digits.length);

  while (formattedCaret < formatted.length && formattedDigits < targetDigits) {
    if (/\d/.test(formatted[formattedCaret])) {
      formattedDigits += 1;
    }
    formattedCaret += 1;
  }

  if ((targetDigits === 6 || targetDigits === 8) && formatted[formattedCaret] === '/') {
    formattedCaret += 1;
  }

  return { value: formatted, caretPosition: formattedCaret };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatNrcInput };
}
