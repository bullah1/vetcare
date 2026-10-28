import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  averageCost, chargeShares, landedUnitCost,
  num, onQuantity, onUnitPrice, onTotal, exactUnitPrice, lineAmounts, invoiceTotals, lineError, type LineInput,
} from "./purchase-calc";

const blank = (): LineInput => ({ quantity: "", unit_price: "", total: "", source: "unit", disc_value: "", disc_kind: "amt" });
const totals0 = { overall_disc_value: "", overall_disc_kind: "amt" as const, vat_value: "", vat_kind: "amt" as const, charges: "" };

describe("purchase line price maths", () => {
  it("10 boxes, total 1000 → unit 100", () => {
    const l = onTotal(onQuantity(blank(), "10"), "1000");
    assert.equal(l.unit_price, "100");
    assert.equal(l.source, "total");
    assert.equal(exactUnitPrice(l), 100);
  });

  it("10 boxes, unit 120 → total 1200", () => {
    const l = onUnitPrice(onQuantity(blank(), "10"), "120");
    assert.equal(l.total, "1200");
    assert.equal(l.source, "unit");
  });

  it("25 pieces, total 625 → unit 25", () => {
    const l = onTotal(onQuantity(blank(), "25"), "625");
    assert.equal(l.unit_price, "25");
  });

  it("changing quantity keeps the last typed field as the truth", () => {
    let l = onTotal(onQuantity(blank(), "10"), "1000"); // total is the truth
    l = onQuantity(l, "20");
    assert.equal(l.total, "1000");
    assert.equal(l.unit_price, "50");
    l = onUnitPrice(l, "60"); // now unit is the truth
    l = onQuantity(l, "5");
    assert.equal(l.unit_price, "60");
    assert.equal(l.total, "300");
  });

  it("no division by zero: quantity 0 or empty gives an empty unit price", () => {
    let l = onTotal(onQuantity(blank(), "0"), "500");
    assert.equal(l.unit_price, "");
    assert.equal(exactUnitPrice(l), 0);
    l = onQuantity(l, "");
    assert.equal(l.unit_price, "");
    assert.equal(lineAmounts(l).gross, 0);
  });

  it("3 for ৳1000: shown 333.3333, saved price × qty gives back exactly 1000", () => {
    const l = onTotal(onQuantity(blank(), "3"), "1000");
    assert.equal(l.unit_price, "333.3333");
    const p = exactUnitPrice(l);
    assert.equal(Math.round(p * 3 * 100) / 100, 1000);
    assert.equal(lineAmounts(l).gross, 1000);
  });

  it("rejects invalid and negative input", () => {
    assert.equal(num("abc"), null);
    assert.equal(num("-5"), null);
    assert.equal(num("1,250.50"), 1250.5);
    assert.equal(lineError(onUnitPrice(onQuantity(blank(), "-2"), "10")), "Enter a quantity above 0");
    assert.equal(lineError(onQuantity(blank(), "2")), "Enter the price");
    assert.equal(lineError(onUnitPrice(onQuantity(blank(), "2"), "0")), null); // free goods allowed
  });
});

describe("discounts and invoice totals", () => {
  it("item discount: fixed and percent, never above the line", () => {
    const l = onUnitPrice(onQuantity(blank(), "10"), "100"); // 1000
    assert.deepEqual(lineAmounts({ ...l, disc_value: "50", disc_kind: "amt" }), { gross: 1000, discount: 50, final: 950 });
    assert.deepEqual(lineAmounts({ ...l, disc_value: "10", disc_kind: "pct" }), { gross: 1000, discount: 100, final: 900 });
    assert.equal(lineAmounts({ ...l, disc_value: "5000", disc_kind: "amt" }).final, 0);
  });

  it("applies each discount once, VAT on the discounted amount, then charges", () => {
    const a = { ...onUnitPrice(onQuantity(blank(), "10"), "100"), disc_value: "10", disc_kind: "pct" as const }; // 1000 - 100
    const b = onTotal(onQuantity(blank(), "25"), "625");
    const t = invoiceTotals([a, b], {
      overall_disc_value: "5", overall_disc_kind: "pct", // 5% of 1525 = 76.25
      vat_value: "5", vat_kind: "pct", // 5% of 1448.75 = 72.44
      charges: "100",
    });
    assert.equal(t.gross, 1625);
    assert.equal(t.itemDiscount, 100);
    assert.equal(t.subtotal, 1525);
    assert.equal(t.overallDiscount, 76.25);
    assert.equal(t.taxable, 1448.75);
    assert.equal(t.vat, 72.44);
    assert.equal(t.charges, 100);
    assert.equal(t.net, 1621.19);
  });

  it("fixed amounts and empty fields", () => {
    const a = onUnitPrice(onQuantity(blank(), "2"), "50");
    const t = invoiceTotals([a], { ...totals0, overall_disc_value: "10", vat_value: "4.5", charges: "20" });
    assert.equal(t.net, 100 - 10 + 4.5 + 20);
    assert.equal(invoiceTotals([], totals0).net, 0);
  });
});


describe("courier charges and average cost", () => {
it("charges are split by line amount", () => {
  assert.deepEqual(chargeShares([2550, 1000], 355), [255, 100]);
  assert.deepEqual(chargeShares([100, 0], 50), [50, 0]);
  assert.deepEqual(chargeShares([100, 200], 0), [0, 0]);
});

it("landed cost and weighted average match the server", () => {
  const landed = landedUnitCost(2550, 255, 17);
  assert.equal(landed, 165);
  assert.equal(Math.round(averageCost(33, 120, 17, landed) * 100) / 100, 135.3);
  // nothing on the shelf → new cost
  assert.equal(averageCost(0, 120, 10, 150), 150);
  assert.equal(averageCost(-3, 120, 10, 150), 150);
  // no cost yet → new cost
  assert.equal(averageCost(5, 0, 10, 150), 150);
});
});
