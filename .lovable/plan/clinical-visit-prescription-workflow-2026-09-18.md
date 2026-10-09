# Clinical Visit + Prescription Workflow

One fast doctor screen: search pet → doctor → complaint/symptoms/exam → diagnosis → tests → medicines → advice → follow-up → save & print prescription. All master data comes from the database with a consistent "search existing, or add new and it's selected instantly" pattern.

## What gets built

### 1. New master data (database)
- **Symptoms**, **Diagnoses**, **Tests**, **Advice templates** — each searchable, each with quick-add that saves and selects immediately. Advice templates can be tagged to symptoms/diagnoses so relevant ones show as suggestions.
- **Medicine profile per product** — dose form (tablet/capsule/syrup/liquid/injection/drops/ointment/sachet) and dose unit, plus a flag marking which products are prescribable. Retail items (pet food, litter, toys, accessories) are never prescribable, so they can never appear in the medicine picker.
- **Clinical visits** and **prescriptions** — existing visit and prescription tables get the extra clinical fields (chief complaint, examination, tests, advice, follow-up date) and link tables for the selected symptoms, diagnoses, tests, and advice. Prescription lines get structured morning/noon/night dose, unit, duration, and instruction, so printing is exact.
- Existing records, appointments, prescriptions and inventory stay untouched; only additions. A small starter set of common symptoms, tests and advice lines is seeded so the chips aren't empty (no fake patients or visits).

### 2. Clinical Visit screen (new page)
- **Patient**: search by pet name, owner name or owner phone; select, or "+ Add New Pet" (name, species, breed, sex, age, weight, owner name, owner phone, address/notes, optional photo) which saves and auto-selects.
- **Last visit summary** shown compactly after pet selection (date, symptoms, diagnosis, tests, medicine count) with "View full history". Previous medicines never copy into the new prescription — the medicines section always starts empty.
- **Doctor**: search/select, or "+ Add Doctor" with name, degree/qualification, specialization, designation, additional qualification, registration number, phone, photo. Only the name is prominent on screen.
- **Presentation**: chief complaint and examination.
- **Symptoms / Diagnosis / Tests**: quick chips for the common ones plus search; each has inline add-new.
- **Medicines**: each medicine is its own compact card — searchable medicine picker (prescribable products only), dose amount, morning/noon/night boxes with live `1 + 0 + 1` preview, duration in days, instruction dropdown. Unit follows the medicine's dose form, so a syrup shows `1 ml + 0 + 2 ml` and a tablet shows tablets; the doctor can't pick a wrong unit.
- **Advice**: suggested advice checkboxes based on chosen symptoms/diagnosis, free-text entry, and "Save as new advice". Nothing reaches the prescription until the doctor ticks it.
- **Follow-up date**, then **SAVE VISIT & GENERATE PRESCRIPTION** — saves the visit with everything relationally linked and opens the print view.

### 3. Prescription print layout (A4 / PDF friendly)
Clinic header with name, tagline, address, phone, website, prescription number and date; patient block (pet, species, breed, sex, age, weight, owner); two columns — left clinical information (complaint, symptoms, examination, diagnosis, tests), right Rx with numbered medicines showing name prominently plus dose schedule, duration and instruction; then advice, follow-up, and the doctor block with name, degree, designation/specialization, registration number and signature area.

### 4. Inventory side
Product form gets the prescribable toggle, dose form and dose unit so the clinic can classify medicines, vaccines, supplements and medical products separately from retail goods. Existing products in the medicine category default to prescribable; food, litter, accessories and toys do not.

### 5. Navigation
New "Clinical Visit" entry for doctor and admin roles; the existing prescriptions page becomes the visit/prescription history list with search and reprint.

## Notes
- White background, brand accent, mobile-first with compact collapsible sections, keyboard-friendly search-first inputs.
- Loading, empty and error states on every list and picker; duplicate-safe owner and pet creation reuses an existing match instead of creating a second record.
