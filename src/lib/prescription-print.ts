import { getClinic } from "@/lib/clinic-settings";
import { getBrandTheme } from "@/lib/brand-theme";

export type RxPrintItem = {
  name: string;
  schedule: string; // e.g. "1 + 0 + 1" or "1 ml + 0 + 2 ml"
  duration: string; // e.g. "7 Days"
  instruction?: string | null;
};

export type RxPrintData = {
  rxNo: string;
  date: string | Date;
  pet: {
    name: string;
    species?: string | null;
    breed?: string | null;
    gender?: string | null;
    age?: string | null;
    weight?: string | null;
  };
  owner: { name?: string | null; phone?: string | null };
  chiefComplaint?: string | null;
  symptoms?: string[];
  examination?: string | null;
  diagnoses?: string[];
  tests?: string[];
  items: RxPrintItem[];
  advice?: string[];
  followUp?: string | null;
  doctor?: {
    name?: string | null;
    degree?: string | null;
    designation?: string | null;
    specialization?: string | null;
    additional?: string | null;
    registration?: string | null;
  } | null;
};

function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function block(label: string, value?: string | null) {
  if (!value || !String(value).trim()) return "";
  return `<div class="cblock"><div class="clabel">${esc(label)}</div><div class="cvalue">${esc(value)}</div></div>`;
}

/** Clean A4 / PDF friendly veterinary prescription. */
export function printClinicalPrescription(data: RxPrintData) {
  const C = getClinic();
  const theme = getBrandTheme();
  const date = new Date(data.date);
  const patient = [
    ["Pet", data.pet.name],
    ["Species", data.pet.species],
    ["Breed", data.pet.breed],
    ["Sex", data.pet.gender],
    ["Age", data.pet.age],
    ["Weight", data.pet.weight],
    ["Owner", data.owner.name],
    ["Phone", data.owner.phone],
  ]
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `<div class="patient-field"><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
    .join("");

  const rx =
    data.items.length === 0
      ? `<div class="empty">No medicine prescribed</div>`
      : data.items
          .map(
            (it, i) => `
        <div class="rxitem">
          <div class="rxnum">${String(i + 1).padStart(2, "0")}</div>
          <div class="rxbody">
            <div class="rxname">${esc(it.name)}</div>
            <div class="dose-label">Dose schedule</div>
            <div class="dose">${esc(it.schedule)}</div>
            <div class="rxmeta">
              ${it.duration ? `<span><small>Duration</small>${esc(it.duration)}</span>` : ""}
              ${it.instruction ? `<span><small>Timing</small>${esc(it.instruction)}</span>` : ""}
            </div>
          </div>
        </div>`,
          )
          .join("");

  const doc = data.doctor ?? {};
  const docLines = [
    doc.degree,
    [doc.designation, doc.specialization].filter(Boolean).join(" & "),
    doc.additional,
    doc.registration ? `Reg. No. ${doc.registration}` : "",
  ]
    .filter((l) => l && String(l).trim())
    .map((l) => `<div>${esc(l)}</div>`)
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(data.rxNo)} — ${esc(data.pet.name)}</title>
<style>
  @page{size:A4;margin:10mm}
  *{box-sizing:border-box}
  :root{--brand:${theme.primary};--ink:#151719;--quiet:#697077;--line:#dedede;--wash:#f7f7f6;--warm:#fbfaf8}
  html,body{margin:0;padding:0;background:#fff;color:var(--ink);font:11.5px/1.48 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;letter-spacing:0}
  .sheet{max-width:190mm;min-height:267mm;margin:0 auto;padding:6mm 5mm 3mm;display:flex;flex-direction:column}
  header{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:22px;align-items:start;padding:0 0 11px;border-bottom:1px solid var(--line);position:relative}
  header:after{content:"";position:absolute;left:0;bottom:-1px;width:44px;height:2px;background:var(--brand)}
  .brand-row{display:flex;align-items:center;gap:10px}
  .brand-mark{width:34px;height:34px;object-fit:contain}
  .brand h1{margin:0;font-size:19px;line-height:1.1;font-weight:700;color:var(--ink)}
  .brand .tag{font-size:9.5px;color:var(--brand);font-weight:600;margin-top:3px}
  .brand .addr{margin:7px 0 0 44px;font-size:9px;color:var(--quiet);line-height:1.55}
  .meta{text-align:right;font-size:9px;color:var(--quiet);white-space:nowrap;padding-top:1px}
  .meta .eyebrow{font-size:8px;text-transform:uppercase;letter-spacing:.16em;color:var(--quiet)}
  .meta .no{font-size:15px;line-height:1.35;font-weight:700;color:var(--ink);margin:2px 0 4px}
  .meta .date{display:grid;grid-template-columns:auto auto;gap:2px 10px;justify-content:end}
  .meta .date span{text-align:left;color:#989898}
  .patient{display:grid;grid-template-columns:1.4fr repeat(3,1fr);gap:0;margin:11px 0 12px;border:1px solid var(--line);border-radius:6px;background:var(--warm);overflow:hidden}
  .patient-field{padding:8px 10px;min-height:43px;border-right:1px solid #e9e7e3;border-bottom:1px solid #e9e7e3}
  .patient-field:nth-child(4n){border-right:0}.patient-field:nth-last-child(-n+4){border-bottom:0}
  .patient span{display:block;font-size:7.5px;line-height:1.2;text-transform:uppercase;letter-spacing:.12em;color:#8b8b87;margin-bottom:4px}
  .patient b{display:block;font-size:10.5px;line-height:1.2;font-weight:600;color:var(--ink)}
  .patient-field:first-child b{font-size:17px;line-height:1;font-weight:700}
  .cols{display:grid;grid-template-columns:.84fr 1.16fr;border:1px solid var(--line);border-radius:6px;overflow:hidden}
  .col{padding:13px 14px 12px}
  .col+.col{border-left:1px solid var(--line);background:#fff}
  .coltitle{display:flex;align-items:center;gap:7px;font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:var(--quiet);font-weight:700;margin-bottom:12px}
  .coltitle:before{content:"";display:block;width:14px;height:2px;background:var(--brand)}
  .cblock{margin-bottom:12px;padding-bottom:11px;border-bottom:1px solid #eeeeec}
  .cblock:last-child{margin-bottom:0;padding-bottom:0;border-bottom:0}
  .clabel{font-size:7.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--brand);font-weight:700;margin-bottom:4px}
  .cvalue{font-size:10.5px;color:#303337;white-space:pre-wrap;line-height:1.55}
  .rxitem{display:grid;grid-template-columns:24px 1fr;gap:9px;padding:0 0 13px;margin-bottom:13px;border-bottom:1px solid #e8e8e6;break-inside:avoid}
  .rxitem:last-child{border-bottom:0}
  .rxnum{display:flex;align-items:center;justify-content:center;width:23px;height:23px;border:1px solid var(--line);border-radius:50%;font-size:8px;font-weight:700;color:var(--quiet)}
  .rxname{font-size:13px;line-height:1.2;font-weight:700;color:var(--ink)}
  .dose-label{margin-top:7px;font-size:7px;letter-spacing:.12em;text-transform:uppercase;color:#999}
  .dose{margin-top:1px;font-size:15px;line-height:1.25;font-weight:700;color:var(--brand)}
  .rxmeta{margin-top:7px;display:flex;gap:20px;color:#34373a;font-size:9.5px;font-weight:600}
  .rxmeta span{display:flex;align-items:baseline;gap:5px}.rxmeta small{font-size:7px;text-transform:uppercase;letter-spacing:.09em;color:#999;font-weight:500}
  .empty{color:#999;font-size:10px;padding:6px 0}
  .after{display:grid;grid-template-columns:1fr 57mm;gap:24px;margin-top:14px;align-items:start}
  .advice{border-left:2px solid var(--brand);padding:3px 0 3px 12px}
  .advice ul{margin:7px 0 0;padding-left:14px}
  .advice li{font-size:10px;margin-bottom:4px;color:#3f4245}
  .sectitle{font-size:8px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink);font-weight:700}
  .followup{display:inline-flex;gap:8px;margin-top:9px;padding:5px 8px;border-radius:4px;background:var(--wash);font-size:9.5px}
  .sign{min-width:55mm;text-align:left;border-top:1px solid #777;padding-top:7px;margin-top:33px;font-size:9px;line-height:1.5;color:var(--quiet)}
  .sign .dn{font-size:11.5px;font-weight:700;color:var(--ink)}
  footer{margin-top:auto;border-top:1px solid var(--line);padding-top:7px;font-size:8px;color:#929292;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px}
  footer .wish{color:var(--brand);font-weight:600}footer .page{text-align:center}footer .ref{text-align:right}
  @media print{.noprint{display:none}}
</style></head><body>
<div class="sheet">
  <header>
    <div class="brand">
      <div class="brand-row"><img class="brand-mark" src="/logo-mark.png" alt=""><div><h1>${esc(C.name)}</h1><div class="tag">${esc(C.tagline)}</div></div></div>
      <div class="addr">${esc(C.address)}<br>${esc(C.phone)}${C.website ? ` · ${esc(C.website)}` : ""}</div>
    </div>
    <div class="meta">
      <div class="eyebrow">Veterinary Prescription</div>
      <div class="no">${esc(data.rxNo)}</div>
      <div class="date"><span>Date</span><b>${esc(date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }))}</b><span>Time</span><b>${esc(date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</b></div>
    </div>
  </header>

  <div class="patient">${patient}</div>

  <div class="cols">
    <div class="col">
      <div class="coltitle">Clinical Information</div>
      ${block("Chief Complaint", data.chiefComplaint)}
      ${block("Symptoms", (data.symptoms ?? []).join(", "))}
      ${block("Examination", data.examination)}
      ${block("Diagnosis", (data.diagnoses ?? []).join(", "))}
      ${block("Investigation / Tests", (data.tests ?? []).join(", "))}
    </div>
    <div class="col">
      <div class="coltitle">Rx — Prescription</div>
      ${rx}
    </div>
  </div>

  <div class="after">
    <div class="advice">
      ${
        (data.advice ?? []).length
          ? `<div class="sectitle">Advice</div><ul>${(data.advice ?? [])
              .map((a) => `<li>${esc(a)}</li>`)
              .join("")}</ul>`
          : ""
      }
      ${
        data.followUp
          ? `<div class="followup"><span class="sectitle">Follow-up</span> &nbsp;${esc(
              new Date(data.followUp).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              }),
            )}</div>`
          : ""
      }
    </div>
    <div class="sign">
      <div class="dn">${esc(doc.name ? `Dr. ${String(doc.name).replace(/^dr\.?\s*/i, "")}` : "Attending Veterinarian")}</div>
      ${docLines}
    </div>
  </div>

  <footer>
    <span class="wish">${esc(C.invoiceFooter)}</span>
    <span class="page">${esc(C.phone)}${C.website ? ` · ${esc(C.website)}` : ""}</span>
    <span class="ref">${esc(data.rxNo)} · Page 1 of 1</span>
  </footer>
</div>
<script>window.onload=function(){window.print()}</script>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

/** Human dose schedule, e.g. "1 + 0 + 1" for tablets and "1 ml + 0 + 2 ml" for liquids. */
export function formatSchedule(
  slots: { morning: number; noon: number; night: number },
  unit: string,
  liquid: boolean,
) {
  const fmt = (n: number) => {
    const v = Number(n) || 0;
    const txt = Number.isInteger(v) ? String(v) : String(v);
    return v > 0 && liquid ? `${txt} ${unit}` : txt;
  };
  const base = `${fmt(slots.morning)} + ${fmt(slots.noon)} + ${fmt(slots.night)}`;
  return liquid ? base : `${base} ${unit}`;
}
