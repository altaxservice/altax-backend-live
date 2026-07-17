/** Converts a dollar amount to check-writing words, e.g. 1739.67 -> "One Thousand Seven Hundred Thirty-Nine and 67/100 Dollars". */
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion"];

function threeDigitsToWords(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    let tens = TENS[Math.floor(n / 10)];
    if (n % 10) tens += `-${ONES[n % 10]}`;
    parts.push(tens);
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

export function amountToWords(amount: number): string {
  const cents = Math.round(amount * 100) % 100;
  let dollars = Math.floor(Math.round(amount * 100) / 100);
  if (dollars === 0) return `Zero and ${String(cents).padStart(2, "0")}/100 Dollars`;

  const groups: string[] = [];
  let scaleIdx = 0;
  while (dollars > 0) {
    const chunk = dollars % 1000;
    if (chunk) groups.unshift(`${threeDigitsToWords(chunk)}${SCALES[scaleIdx] ? " " + SCALES[scaleIdx] : ""}`);
    dollars = Math.floor(dollars / 1000);
    scaleIdx++;
  }
  return `${groups.join(" ")} and ${String(cents).padStart(2, "0")}/100 Dollars`;
}
