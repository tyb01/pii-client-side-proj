/**
 * Structural validity check for US SSNs (area-group-serial), per SSA
 * allocation rules — not a checksum (SSNs don't have one), but the same
 * false-positive-cutting role: an area/group/serial of 000/666/900-999,
 * 00, or 0000 is never a real SSN, so this rejects a lot of incidental
 * 9-digit matches (phone-ish numbers, padded IDs, ...) that the bare regex
 * alone can't distinguish.
 */
export function isValidSsnStructure(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 9) return false;

  const area = digits.slice(0, 3);
  const group = digits.slice(3, 5);
  const serial = digits.slice(5, 9);

  if (area === "000" || area === "666" || Number(area) >= 900) return false;
  if (group === "00") return false;
  if (serial === "0000") return false;

  return true;
}
