/** Standard Luhn checksum, used to cut false positives on card-like number sequences. */
export function passesLuhn(digits: string): boolean {
  const clean = digits.replace(/\D/g, "");
  if (clean.length < 12) return false;
  let sum = 0;
  let double = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let d = clean.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}
