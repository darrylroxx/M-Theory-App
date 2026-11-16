/** Each section letter gets its own colour, the same everywhere it appears. */
export const letterClass = (letter: string) => `L${(letter.charCodeAt(0) - 65) % 8}`;
