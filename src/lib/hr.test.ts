import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { monthDays, weekday, monthSalary, isLate, fmtTime } from "./hr";

// October 2026: 31 days, Fridays = 2, 9, 16, 23, 30 → 26 working days with Friday off.
const emp = { monthly_salary: 26000, weekly_off: [5], join_date: "2026-01-01", duty_start: "09:00:00" };
const att = (work_date: string, status: any, check_in: string | null = "09:00:00") => ({ work_date, status, check_in });

describe("calendar helpers", () => {
  it("days and weekdays", () => {
    assert.equal(monthDays("2026-10").length, 31);
    assert.equal(monthDays("2026-02").length, 28);
    assert.equal(weekday("2026-10-16"), 5); // Friday
    assert.equal(fmtTime("13:05:00"), "1:05 PM");
    assert.equal(isLate("09:10:00", "09:00:00"), false);
    assert.equal(isLate("09:11:00", "09:00:00"), true);
  });
});

describe("monthly salary", () => {
  it("full month with nothing marked = full salary, unmarked days counted", () => {
    const s = monthSalary(emp, "2026-10", [], [], "2026-10-31");
    assert.equal(s.workingDays, 26);
    assert.equal(s.perDay, 1000);
    assert.equal(s.notMarked, 26);
    assert.equal(s.net, 26000);
  });

  it("absent, unpaid leave, half day deducted; paid leave free; off-day work paid extra", () => {
    const s = monthSalary(emp, "2026-10", [
      att("2026-10-01", "absent", null),
      att("2026-10-04", "leave", null),
      att("2026-10-05", "leave", null),
      att("2026-10-06", "half_day"),
      att("2026-10-07", "paid_leave", null),
      att("2026-10-09", "present"), // Friday = off day → extra
      att("2026-10-12", "present", "09:30:00"), // late
    ], [], "2026-10-31");
    assert.equal(s.absent, 1);
    assert.equal(s.leave, 2);
    assert.equal(s.halfDays, 1);
    assert.equal(s.paidLeave, 1);
    assert.equal(s.offDayWorked, 1);
    assert.equal(s.late, 1);
    assert.equal(s.deductDays, 3.5);
    assert.equal(s.deduction, 3500);
    assert.equal(s.offDayExtra, 1000);
    assert.equal(s.net, 26000 - 3500 + 1000);
  });

  it("bonus, deduction and advance; leave on an off day costs nothing", () => {
    const s = monthSalary(emp, "2026-10", [att("2026-10-16", "leave", null)], [
      { kind: "bonus", amount: 2000 }, { kind: "advance", amount: 5000 }, { kind: "deduction", amount: 300 },
    ], "2026-10-31");
    assert.equal(s.leave, 0);
    assert.equal(s.net, 26000 + 2000 - 5000 - 300);
  });

  it("joined mid-month: days before joining are not paid", () => {
    // Joined Oct 15: working days Oct 1–14 = 14 − 2 Fridays (2, 9) = 12
    const s = monthSalary({ ...emp, join_date: "2026-10-15" }, "2026-10", [], [], "2026-10-31");
    assert.equal(s.notJoinedDays, 12);
    assert.equal(s.net, 14000);
  });

  it("never below zero; zero salary safe", () => {
    assert.equal(monthSalary(emp, "2026-10", [], [{ kind: "advance", amount: 99999 }], "2026-10-31").net, 0);
    assert.equal(monthSalary({ ...emp, monthly_salary: 0 }, "2026-10", [att("2026-10-01", "absent", null)], [], "2026-10-31").net, 0);
    const allOff = monthSalary({ ...emp, weekly_off: [0, 1, 2, 3, 4, 5, 6] }, "2026-10", [], [], "2026-10-31");
    assert.equal(allOff.perDay, 0);
  });
});
