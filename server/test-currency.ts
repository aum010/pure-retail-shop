import { calculateTotals, formatNPR, VAT_RATE, SHIPPING_FLAT, FREE_SHIPPING_THRESHOLD } from "../src/lib/currency.js";

console.log("VAT", VAT_RATE, "| delivery", formatNPR(SHIPPING_FLAT), "| free over", formatNPR(FREE_SHIPPING_THRESHOLD));
console.log("");

let failures = 0;
const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = actual === wanted;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` — got ${actual}, wanted ${wanted}`}`);
};

for (const subtotal of [1250, 5000, 12500]) {
  const t = calculateTotals(subtotal);
  console.log(
    `subtotal ${formatNPR(t.subtotal).padEnd(14)} delivery ${formatNPR(t.shipping).padEnd(11)} ` +
      `VAT ${formatNPR(t.tax).padEnd(12)} total ${formatNPR(t.total).padEnd(14)} gap ${formatNPR(t.freeShippingGap)}`
  );
}

console.log("");
// Below the free-delivery threshold a flat charge applies.
const small = calculateTotals(1250);
expect("small order pays delivery", small.shipping, SHIPPING_FLAT);
expect("small order VAT is 13%", small.tax, 162.5);
expect("small order total", small.total, 1250 + 150 + 162.5);
expect("free-delivery gap is reported", small.freeShippingGap, 3750);

// At or above the threshold delivery is free.
const big = calculateTotals(5000);
expect("threshold order ships free", big.shipping, 0);
expect("threshold order VAT", big.tax, 650);
expect("threshold order total", big.total, 5650);
expect("no gap at threshold", big.freeShippingGap, 0);

// Rounding must stay to 2 decimals.
const odd = calculateTotals(1233.33);
expect("VAT rounds to 2dp", odd.tax, Math.round(1233.33 * 0.13 * 100) / 100);

// Degenerate input is handled.
expect("zero subtotal", calculateTotals(0).total, SHIPPING_FLAT);
expect("negative subtotal ignored", calculateTotals(-50).subtotal, 0);
expect("NaN subtotal ignored", calculateTotals(Number.NaN).subtotal, 0);

console.log("");
console.log(failures === 0 ? "All currency checks passed" : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
