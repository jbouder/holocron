/**
 * Board codes: six characters from an alphabet without 0/O/1/I, so they can be
 * read out loud or copied off a screen. 32^6 is about a billion codes; the
 * creator retries on the (very rare) collision.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

export function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) {
    // 32 symbols: the low five bits are uniform.
    code += CODE_ALPHABET[byte & 31];
  }
  return code;
}

/** Upper-case and drop the spaces and dashes people type between groups. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}
