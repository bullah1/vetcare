// Printable A4 pet vaccination certificate, styled after the classic
// blue-wave clinic template. Uses clinic settings for branding.
import { getClinic } from "@/lib/clinic-settings";

export type CertVaccination = {
  vaccine_name: string;
  administered_at: string;
  next_due_date?: string | null;
  batch_no?: string | null;
  notes?: string | null;
  doctor_name?: string | null;
};

export type CertificateData = {
  petName: string;
  species?: string | null;
  breed?: string | null;
  gender?: string | null;
  ownerName?: string | null;
  ownerPhone?: string | null;
  vaccinations: CertVaccination[];
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—";

export function buildVaccinationCertificateHtml(data: CertificateData): string {
  const c = getClinic();
  const vax = data.vaccinations;
  const firstDose = vax.length ? vax[vax.length - 1] : undefined;
  const nextDue = vax
    .map((v) => v.next_due_date)
    .filter(Boolean)
    .sort()[0];
  const vet = vax.find((v) => v.doctor_name)?.doctor_name ?? "";

  const wave = (flip: boolean) => `
    <svg class="wave ${flip ? "bottom" : "top"}" viewBox="0 0 1200 120" preserveAspectRatio="none">
      <path d="M0,0 L1200,0 L1200,60 C1000,110 850,20 620,64 C420,102 200,40 0,84 Z" fill="#8ab4f8"/>
    </svg>`;

  const paw = (cls: string) => `
    <svg class="paw ${cls}" viewBox="0 0 100 100">
      <g fill="none" stroke="#c99b86" stroke-width="3">
        <path d="M50 92c-18 0-30-10-30-24 0-12 12-18 30-18s30 6 30 18c0 14-12 24-30 24z"/>
        <circle cx="22" cy="36" r="10"/><circle cx="40" cy="22" r="10"/>
        <circle cx="62" cy="22" r="10"/><circle cx="80" cy="36" r="10"/>
      </g>
      <g fill="#c99b86" opacity=".55">
        <path d="M50 88c-15 0-25-8-25-20 0-10 10-15 25-15s25 5 25 15c0 12-10 20-25 20z"/>
        <circle cx="22" cy="36" r="7"/><circle cx="40" cy="22" r="7"/>
        <circle cx="62" cy="22" r="7"/><circle cx="80" cy="36" r="7"/>
      </g>
    </svg>`;

  const details = vax
    .map(
      (v) => `<div class="vgroup">
        <div class="vline"><b>${esc(v.vaccine_name)}</b>: ${fmt(v.administered_at)}</div>
        ${v.batch_no ? `<div class="vline">Lot Number: ${esc(v.batch_no)}</div>` : ""}
        ${v.next_due_date ? `<div class="vline">Next Due: ${fmt(v.next_due_date)}</div>` : ""}
        ${v.notes ? `<div class="vline muted">${esc(v.notes)}</div>` : ""}
      </div>`,
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8">
<title>Vaccination Certificate — ${esc(data.petName)}</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: "Segoe UI", Arial, sans-serif; color:#1a1a2e; }
  .sheet { position:relative; width:297mm; height:210mm; overflow:hidden; background:#fff; padding:34mm 24mm 30mm; }
  .wave { position:absolute; left:0; width:100%; height:26mm; }
  .wave.top { top:0; }
  .wave.bottom { bottom:0; transform:rotate(180deg); }
  .paw { position:absolute; width:34mm; opacity:.9; }
  .paw.tr { top:6mm; right:10mm; transform:rotate(12deg); }
  .paw.bl { bottom:12mm; left:8mm; transform:rotate(-18deg); }
  .clinic { text-align:center; font-size:13pt; letter-spacing:.4px; }
  h1 { text-align:center; font-family:"Times New Roman", Georgia, serif; font-size:38pt; margin:2mm 0 8mm; color:#1b1b4b; }
  .cols { display:flex; gap:14mm; font-size:12pt; line-height:1.7; }
  .cols > div { flex:1; }
  h2 { font-size:12.5pt; margin:8mm 0 3mm; }
  .vgroup { margin:0 0 4mm 8mm; font-size:11.5pt; line-height:1.6; }
  .vline { padding-left:6mm; position:relative; }
  .vline:before { content:"•"; position:absolute; left:0; }
  .muted { color:#555; }
  .foot { display:flex; gap:14mm; font-size:11.5pt; line-height:1.7; margin-top:6mm; }
  .foot > div { flex:1; }
  .sign { text-align:center; margin-top:8mm; }
  .sign b { display:block; font-size:12pt; letter-spacing:.5px; text-transform:uppercase; }
  @media print { .noprint { display:none } }
</style></head><body>
<div class="sheet">
  ${wave(false)}${wave(true)}${paw("tr")}${paw("bl")}
  <div class="clinic">${esc(c.name)}</div>
  <h1>Pet Vaccination Certificate</h1>
  <div class="cols">
    <div>
      Pet's Name: ${esc(data.petName)}<br>
      Owner: ${esc(data.ownerName || "—")}
    </div>
    <div>
      Breed: ${esc(data.breed || data.species || "—")}<br>
      Contact: ${esc(data.ownerPhone || "—")}
    </div>
  </div>
  <h2>Vaccination Details:</h2>
  ${details || `<div class="vgroup"><div class="vline">No vaccination records.</div></div>`}
  <div class="foot">
    <div>
      First Vaccine: ${fmt(firstDose?.administered_at)}<br>
      Next Booster Due: ${fmt(nextDue)}
    </div>
    <div>
      Veterinarian: ${esc(vet || "—")}<br>
      License Number: ${esc(c.license)}<br>
      Clinic: ${esc(c.name)}<br>
      Contact: ${esc(c.phone)}
    </div>
  </div>
  <div class="sign"><b>${esc(vet || c.name)}</b>Licensed Veterinarian</div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
</body></html>`;
}

export function printVaccinationCertificate(data: CertificateData) {
  const html = buildVaccinationCertificateHtml(data);
  const w = window.open("", "_blank", "width=1100,height=800");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
