/**
 * Cuts false positives on the shape-based ACCESSION_NUMBER pattern (which
 * has no label/context requirement): real institution accession codes
 * ("RAD22-MR-02219", "LAB22-338207", "S22-014728-IHC") always have at least
 * one hyphenated suffix group that's a substantial run of digits/letters,
 * not just 1-2 characters. Lab test names collapse to the same shape when
 * extracted PDF text drops the space ("CA 15-3" -> "CA15-3", "CA 27.29"-like
 * markers, etc.) but their suffix groups stay short — so requiring
 * substance there is enough to tell the two apart without needing a label.
 */
export function hasSubstantialAccessionSuffix(value: string): boolean {
  const groups = value.split("-").slice(1);
  return groups.some((g) => g.length >= 4);
}
