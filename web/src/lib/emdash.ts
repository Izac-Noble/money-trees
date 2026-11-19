/** Em dashes are not allowed in UI text. */
// Built from its code point so this file passes its own check.
export const EM_DASH = String.fromCharCode(0x2014);

/** The 1-based line numbers of `text` that contain an em dash. */
export function findEmDashes(text: string): number[] {
  return text.split("\n").flatMap((line, index) => (line.includes(EM_DASH) ? [index + 1] : []));
}
