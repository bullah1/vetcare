import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dhakaDayKey, shiftDay, summarizeSales } from "./sales-summary";

const from = "2026-09-01", to = "2026-09-11";
const sale = (id: string, total: number, created_at = "2026-09-03T10:00:00Z") => ({ id, total, created_at });
const ret = (id: string, refund_amount: number, created_at = "2026-09-07T10:00:00Z") => ({ id, refund_amount, created_at });

describe("date-based sales summary", () => {
  it("matches the September audit and excludes the August invoice from September gross", () => {
    const sales = [sale("completed", 132976.2), sale("void", 2870), sale("fully-returned", 170), sale("partial", 620), sale("august", 400, "2026-08-30T12:25:51Z")];
    const returns = [ret("cancel1", 1150), ret("august-cancel", 400), ret("cancel2", 1370), ret("partial", 310), ret("full-return", 170), ret("cancel3", 350)];
    const summary = summarizeSales(sales, [], returns, from, to);
    assert.equal(summary.totals.gross, 136636.2);
    assert.equal(summary.totals.refund, 3750);
    assert.equal(summary.totals.rev, 132886.2);
    assert.equal(summary.daily.has("2026-08-30"), false);
  });

  it("keeps a fully returned invoice on sale day and reverses on return day", () => {
    const s = [{ ...sale("full", 170), status: "refunded" }];
    const r = [ret("full-return", 170)];
    assert.equal(summarizeSales(s, [], r, "2026-09-03", "2026-09-03").totals.rev, 170);
    assert.equal(summarizeSales(s, [], r, "2026-09-07", "2026-09-07").totals.rev, -170);
    assert.equal(summarizeSales(s, [], r, from, to).totals.rev, 0);
  });

  it("partial return then later cancel reverses only each transaction's value and cost", () => {
    const s = [{ ...sale("s", 1000), status: "void" }];
    const items = [{ sale_id: "s", quantity: 10, cost_price: 60 }];
    const returns = [
      { ...ret("partial", 300, "2026-09-04T10:00:00Z"), sale_return_items: [{ quantity: 3, sale_items: { cost_price: 60 } }] },
      { ...ret("cancel", 700), sale_return_items: [{ quantity: 7, sale_items: { cost_price: 60 } }] },
    ];
    assert.deepEqual(summarizeSales(s, items, returns, "2026-09-04", "2026-09-04").totals, { gross: 0, refund: 300, rev: -300, cogs: -180 });
    assert.deepEqual(summarizeSales(s, items, returns, from, to).totals, { gross: 1000, refund: 1000, rev: 0, cogs: 0 });
  });

  it("credits prior-month return cost without adding prior-month gross or cost", () => {
    const s = [sale("old", 400, "2026-08-30T10:00:00Z")];
    const items = [{ sale_id: "old", quantity: 1, cost_price: 250 }];
    const returns = [{ ...ret("r", 400), sale_return_items: [{ quantity: 1, sale_items: { cost_price: 250 } }] }];
    assert.deepEqual(summarizeSales(s, items, returns, from, to).totals, { gross: 0, refund: 400, rev: -400, cogs: -250 });
  });

  it("uses total return value including due reduction, not just cash refunded", () => {
    const returns = [{ ...ret("r", 500), refund_paid: 100, due_reduction: 400 }];
    assert.equal(summarizeSales([], [], returns, from, to).totals.refund, 500);
  });

  it("uses Dhaka midnight and inclusive end-of-day regardless of device timezone", () => {
    const s = [sale("before", 1, "2026-08-31T17:59:59.999Z"), sale("start", 2, "2026-08-31T18:00:00Z"), sale("end", 3, "2026-09-01T17:59:59.999Z"), sale("after", 4, "2026-09-01T18:00:00Z")];
    assert.equal(summarizeSales(s, [], [], from, from).totals.gross, 5);
    assert.equal(dhakaDayKey("2026-08-31T18:00:00Z"), from);
    assert.equal(shiftDay(from, -1), "2026-08-31");
  });

  it("does not double-count repeated invoice or return rows", () => {
    const s = sale("s", 100), r = ret("r", 40);
    assert.equal(summarizeSales([s, s], [], [r, r], from, to).totals.rev, 60);
  });

  it("month totals equal the sum of day totals including decimal amounts", () => {
    const s = [sale("a", 0.1), sale("b", 0.2), sale("c", 230.2, "2026-09-04T10:00:00Z")];
    const result = summarizeSales(s, [], [], from, to);
    assert.equal(result.totals.rev, 230.5);
    assert.equal(Math.round([...result.daily.values()].reduce((sum, d) => sum + d.rev, 0) * 100), result.totals.rev * 100);
  });
});