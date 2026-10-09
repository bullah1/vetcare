// Printable appointment slip (80mm thermal) — serial token for the customer.
import { toast } from "sonner";
import { getClinic } from "@/lib/clinic-settings";

export type AppointmentSlip = {
  serial_no: number | null;
  scheduled_at: string;
  duration_minutes?: number | null;
  pet_name: string;
  pet_species?: string | null;
  owner_name: string;
  owner_phone?: string | null;
  doctor_name: string;
  fee?: number | null;
  paid?: number | null;
  reason?: string | null;
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export function printAppointmentSlip(a: AppointmentSlip) {
  const clinic = getClinic();
  const when = new Date(a.scheduled_at);
  const dateStr = when.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = when.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  const due = Math.max(Number(a.fee || 0) - Number(a.paid || 0), 0);

  const row = (l: string, v: string) =>
    `<div class="row"><span>${esc(l)}</span><b>${esc(v)}</b></div>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Appointment Slip</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;-webkit-print-color-adjust:exact}
  .r{width:72mm;margin:0 auto;padding:4mm 2mm;font-size:11px;line-height:1.45}
  .c{text-align:center}
  .name{font-size:15px;font-weight:800;letter-spacing:.3px}
  .sub{font-size:10px;color:#333}
  .hr{border-top:1px dashed #000;margin:6px 0}
  .serial{font-size:34px;font-weight:900;text-align:center;letter-spacing:1px;margin:4px 0 2px}
  .serial-lbl{font-size:10px;text-align:center;letter-spacing:2px;font-weight:700}
  .row{display:flex;justify-content:space-between;gap:8px;padding:1.5px 0}
  .row b{text-align:right;word-break:break-word}
  .box{border:1.5px solid #000;border-radius:6px;padding:6px 8px;margin:6px 0;text-align:center}
  .box .d{font-size:16px;font-weight:800}
  .foot{font-size:9.5px;color:#333;text-align:center;margin-top:6px}
</style></head><body>
<div class="r">
  <div class="c">
    <div class="name">${esc(clinic.name)}</div>
    ${clinic.address ? `<div class="sub">${esc(clinic.address)}</div>` : ""}
    ${clinic.phone ? `<div class="sub">Phone: ${esc(clinic.phone)}</div>` : ""}
  </div>
  <div class="hr"></div>
  <div class="serial-lbl">APPOINTMENT SERIAL</div>
  <div class="serial">#${a.serial_no ?? "-"}</div>
  <div class="box">
    <div class="d">${esc(dateStr)}</div>
    <div class="d">${esc(timeStr)}</div>
  </div>
  ${row("Pet", `${a.pet_name}${a.pet_species ? ` (${a.pet_species})` : ""}`)}
  ${row("Owner", a.owner_name)}
  ${a.owner_phone ? row("Phone", a.owner_phone) : ""}
  ${row("Doctor", `Dr. ${a.doctor_name}`)}
  ${a.reason ? row("Reason", a.reason) : ""}
  <div class="hr"></div>
  ${row("Fee", `${clinic.currency}${Number(a.fee || 0).toLocaleString("en-BD")}`)}
  ${row("Paid", `${clinic.currency}${Number(a.paid || 0).toLocaleString("en-BD")}`)}
  ${row("Due", `${clinic.currency}${due.toLocaleString("en-BD")}`)}
  <div class="hr"></div>
  <div class="foot">Please arrive 10 minutes early and bring this slip.<br>${esc(clinic.invoiceFooter || "Thank you!")}</div>
</div>
<script>
(function(){
  function fit(){
    var r=document.querySelector('.r'); if(!r) return;
    var pxPerMm=96/25.4;
    var h=Math.ceil(r.getBoundingClientRect().height/pxPerMm)+4;
    h=Math.max(60,Math.min(1000,h));
    var st=document.createElement('style');
    st.textContent='@page{size:80mm '+h+'mm;margin:0}';
    document.head.appendChild(st);
  }
  window.addEventListener('load',function(){ fit(); setTimeout(function(){ window.print(); },250); });
})();
</script>
</body></html>`;

  const w = window.open("", "_blank", "width=420,height=700");
  if (!w) {
    toast.error("Enable pop-ups to print the slip");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
