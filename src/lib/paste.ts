/** Lines in a paste; one trailing newline does not add a line. */
export function countLines(text: string): number {
  if (text === "") return 0;
  return text.replace(/(\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/).length;
}

/** Pasting more than one line runs commands the user has not seen end to end. */
export function needsPasteConfirm(text: string): boolean {
  return countLines(text) > 1;
}
