/** GTIN-8, GTIN-12 (UPC), GTIN-13 (EAN) e GTIN-14, com dígito verificador. */
export function isValidGtin(raw: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(raw)) return false;
  const digits = raw.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  // Da direita para a esquerda (sem o verificador): pesos 3,1,3,1...
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}
