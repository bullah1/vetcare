# Return & Cancel System Stabilization

## Goal
Return, full cancellation, payment, due, stock, cash drawer, sales history, dashboard এবং profit report—সব জায়গায় একই transaction থেকে একই ফল দেখানো। একই action দুইবার submit হলেও duplicate refund, stock restore বা cash entry তৈরি হবে না।

## Business Rules
- Original invoice total ও original sale lines immutable financial history হিসেবে থাকবে; return হলে invoice total rewrite করা হবে না।
- **Partial return:** returned item value Net Sales থেকে return date-এ বাদ যাবে; returned stock cost একই return date-এ COGS credit হবে।
- **Paid + due invoice return:** আগে unpaid due কমবে; তার বেশি অংশই শুধু customer refund হবে। তাই `refund_amount = due_reduction + refund_paid`।
- **Full cancel:** এখনো return না হওয়া সব item একবারে reverse হবে; remaining due write-off হবে এবং বাস্তবে যত payment net received হয়েছে শুধু ততটুকু original payment method অনুযায়ী ফেরত হবে।
- **Split payment:** cash/bKash/Nagad/card প্রতিটি method তার নিজের net collected amount অনুযায়ী reverse হবে; cash drawer-এ শুধু cash অংশ যাবে।
- **Stock:** restock=true হলে শুধু এখনো ফেরত/বাতিল না হওয়া quantity একবার restore হবে; damaged/discard return stock বাড়াবে না। Negative stock বা over-return হবে না।
- **Sale edit:** completed invoice-এর customer/note metadata edit করা যাবে; quantity, price, discount বা paid amount correction Return/Cancel/Additional Payment flow দিয়েই হবে—Edit আর refund তৈরি করবে না।
- সব financial date `timestamptz`-এ সংরক্ষিত থাকবে; day-wise UI/report Dhaka business day (UTC+6) ব্যবহার করবে।

## Implementation
### 1. One canonical backend transaction
- Existing `create_return`, `cancel_sale`, `recalc_sale_totals`, payment/cash triggers একত্রে audit করে একটি shared internal return engine বানানো।
- Partial return ও cancel উভয় RPC একই locked sale/items/payment rows এবং একই calculation ব্যবহার করবে।
- Every request-এ `client_request_id`/idempotency key যোগ করে unique constraint দেওয়া; retry/double-click একই result ফেরত দেবে।
- Validate status, remaining quantity, refund amount, payment method, open cash shift এবং staff permission transaction শুরুতেই। কোনো ধাপে error হলে পুরো action rollback হবে।
- Return header, return items, payment reversal, stock restore, sale status এবং due/paid recalculation একই database transaction-এ হবে।

### 2. Immutable and auditable records
- `sale_returns`-এ return type (`partial`/`cancel`), due reduction, refund paid, request id ও processed timestamp স্পষ্টভাবে সংরক্ষণ করা।
- Payment reversals return record-এর সঙ্গে সরাসরি link করা, fragile reference-text matching বাদ দেওয়া।
- Cancelled sale-এর return items-ও লিখে রাখা, যাতে কোন product/quantity/cost reverse হয়েছে তা report নির্ভুলভাবে জানতে পারে।
- Existing rows delete বা overwrite না করে targeted backfill; migration-এর আগে/পরে anomaly counts রাখা।

### 3. Safe totals and reconciliation
- `sales.paid` = payment ledger-এর net received; `sales.due` = max(original total − all return value − net paid, 0); status remaining quantities থেকে derive হবে।
- Cash Drawer/shift summary actual payment timestamps ও attached shift ব্যবহার করবে; cancelled inflow/outflow আলাদা visible lines হলেও expected closing net অপরিবর্তিত থাকবে।
- Sales History, Dashboard, Reports, Customer Ledger এবং Profit একই shared calculation/query contract ব্যবহার করবে:
  - Gross Sales = invoice creation date
  - Returns/Cancel reversal = processed date
  - Collection = payment received date
  - COGS credit = corresponding return/cancel processed date
- একটি reconciliation query/report থাকবে যা invoice total, returns, payments, due, stock-return quantities এবং cash movement mismatch invoice-wise দেখাবে।

### 4. Return & Cancel experience
- একটিই “Returns & Cancellation” flow থাকবে: invoice search → remaining items → quantity/reason/restock → due reduction/refund preview → confirmation → return receipt.
- Submit button pending অবস্থায় locked থাকবে এবং request id reuse করবে।
- Cancel confirmation-এ স্পষ্ট preview: invoice reversal, due written off, customer refund by method, stock restored/discarded।
- Sales History detail-এ original sale, all returns/cancellation, payment reversals এবং current net balance timeline দেখাবে।
- Successful action-এর পর affected Sales History, Cash Drawer, Dashboard, Reports, Inventory, Due এবং Customer Ledger data refresh হবে।

### 5. Historical repair
- বর্তমান database-এ invoice-wise audit চালিয়ে duplicate edit refunds, missing return items, wrong `refund_paid`, wrong `paid/due`, duplicate/missing stock restores, orphan/wrong-shift cash movements শনাক্ত করা।
- Deterministic repair migration only; valid historical sales/payment values unchanged থাকবে। Ambiguous records auto-change না করে audit list-এ থাকবে।
- Repair শেষে all known mismatch invoices এবং recent return/cancel records পুনরায় reconcile করা।

## Verification
Automated integration scenarios:
1. Fully paid cash partial return.
2. Part-paid/due return where due absorbs all value.
3. Part-paid/due return requiring both due reduction and cash refund.
4. Split cash + bKash full cancel.
5. Prior partial return followed by cancel.
6. Restock false return.
7. Double-click/network retry of return and cancel.
8. Return on a later Dhaka day than sale.
9. Closed shift vs current open shift handling.
10. Unauthorized staff and already-cancelled invoice rejection.

For every scenario assert invoice gross, return value, paid, due, stock, per-method payments, cash movement, shift expected closing, daily Net Sales, COGS and Profit. Run type checks plus browser verification of the complete flow.

## Technical Notes
- Database remains the authority; frontend never calculates a final refund independently.
- Use row locks, unique request IDs, foreign keys and explicit constraints instead of reference strings/status guesses.
- Keep existing RLS/role checks; cancellation remains admin-only unless permissions explicitly grant it.
- Deliver backend migration, frontend flow updates, shared reporting helpers, historical repair report and regression tests together so partial deployment cannot create another mismatch.
