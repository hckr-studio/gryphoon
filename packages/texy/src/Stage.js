/**
 * When a pass runs (enum of Texy\Stage). Syntax passes finish recognizing the
 * source and run in parse(), the others apply its meaning and run in
 * transform(), the Finalize ones last.
 */

export const Stage = Object.freeze({
  Syntax: "Syntax",
  Transform: "Transform",
  Finalize: "Finalize",
});
