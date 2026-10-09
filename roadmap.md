# Sales summary reconciliation
- [x] Unify Dashboard and Reports date-based sales/returns and cost calculations without changing transactions.
- [x] Verify September against read-only ledger totals: gross 136,636.20 − returns 3,750 = net 132,886.20; COGS 96,091.70; gross profit 36,794.50. Eight regression tests pass in UTC and America/New_York; both page modules compile.
- [x] Check preview rendering errors: sign-in page renders with no runtime errors; previous hydration errors not reproduced.
- [ ] Signed-in visual comparison: blocked because no preview session is available and the requesting user's account cannot be matched. Requires the user to sign in.
## Appointment system audit (Sep 18)
- [x] Appointment History page: date range, search (customer/phone/pet/doctor/serial), status tabs, full details
- [x] Searchable customer picker in New Appointment with duplicate-safe new customer
- [x] Customer -> Pet -> Appointment -> Doctor links enforced by trigger + indexes
- [ ] Signed-in visual check pending (no test login available)
## Clinical visit + prescription workflow (Sep 18)
- [x] Master data tables: symptoms, diagnoses, medical_tests, advice_templates (with starter rows, quick-add duplicate-safe)
- [x] clinical_visits + visit_symptoms/diagnoses/tests/advice link tables; prescriptions.visit_id, structured prescription_items (morning/noon/night, unit, days, instruction)
- [x] products.is_prescribable + dose_form/dose_unit; medicine-category products backfilled; medicine picker shows prescribable only
- [x] Clinical Visit page: patient search (pet/owner/phone) + add pet, doctor select + add doctor, complaint/examination, symptoms/diagnosis/tests chips, medicine cards with 1+0+1 preview and unit-aware liquid dosing, suggested advice, follow-up, save & print
- [x] A4 prescription layout (clinic header, patient, two-column clinical/Rx, advice, follow-up, doctor block)
- [x] Doctor profile fields (degree, designation, additional qualification, registration no) shown on the printout
- [x] Premium A4 prescription redesign: branded stationery header, patient profile, editorial clinical sections, prominent dose hierarchy, advice, signature and minimal footer
- [ ] Signed-in visual check pending (no test login available)
## Clinic-only analytics dashboard (Sep 18)
- [x] /clinic-dashboard route: patients (new/repeat/species mix + trend), clinical activity, consultation fees, surgery, top analysis, peak days/hours
- [x] Filters: Today / 7 Days / This Month / Last Month / Custom range / Doctor
- [x] surgeries table (visit-linked) + optional surgery entry in Clinical Visit; appointments.discount + discount field in New Appointment
- [x] No shop, POS, inventory or product-sales data used on this dashboard
- [ ] Signed-in visual check pending (no test login available)
## Clinical Intelligence & drill-down analytics (Sep 18)
- [x] /clinical-intelligence route built on existing clinical_visits, medical_records, prescriptions, surgeries (no new clinical tables, no schema change needed — link tables and text arrays already exist)
- [x] Global filters: date range presets/custom, species, breed, age group, weight range, doctor, diagnosis, symptom, medicine, free-text search
- [x] Top insights: diagnoses, symptoms, medicines, species, breeds, investigations, age/weight groups, doctor load, surgery types, repeat case types, rising/falling cases
- [x] Multi-level drill-down panel with breadcrumbs (diagnosis -> species -> weight -> symptoms -> medicines -> patients) and patient list opening the existing pet record
- [x] Historical analytics only — no medicine recommendations or treatment advice
- [ ] Signed-in visual check pending (no test login available)

## Clinic Dashboard → Analysis section upgraded to drill-down (Sep 18)
- [x] Clinical analysis filters (species, breed, gender, age group, weight group, diagnosis, symptom, medicine, search) on top of date + doctor
- [x] Case analysis tables (diagnosis, symptom, medicine, test, species, breed, gender, age, weight, repeat patients) — every row opens CaseDrillDown; patient rows open PetHistorySheet
- [x] Appointment analysis: pending count + appointment → clinical visit conversion, doctor-wise activity table
- [x] Surgery analysis: fee/collected/due KPIs, type/species/doctor tables, daily surgery trend
- [x] gender dimension added to clinical-intel (CaseRow, filters, buckets, drill-down breakdowns); no schema change, no shop/POS data
