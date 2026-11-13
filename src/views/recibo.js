// Página pública do recibo (#/recibo/<dados>): é o que o membro abre a partir do WhatsApp.
// Não exige sessão; mostra o recibo e permite descarregar o PDF.
import { esc, icon, receipt, toast } from '../ui.js';
import { decodeReceipt, fromData, downloadPdf } from '../share.js';
import { firstName } from '../format.js';

export function renderPublicReceipt(root, encoded) {
  document.body.className = 'is-public';
  const data = decodeReceipt(encoded);
  document.title = data ? `Recibo ${data.r} · Nataniel Litsure Ministries` : 'Recibo · Nataniel Litsure Ministries';

  const body = data
    ? (() => {
      const { c, member, reviewer, settings } = fromData(data);
      return `
        <p class="pub__hello">Olá, ${esc(firstName(data.n))}. A sua contribuição foi recebida e registada.</p>
        <div class="card pub__card">${receipt(c, { member, reviewer, settings })}</div>
        <div class="pub__actions">
          <button type="button" class="btn btn-primary btn-block" data-pdf>${icon('download', 18)} Baixar recibo em PDF</button>
        </div>
        <p class="pub__thanks">Obrigado pela sua contribuição para a ${esc(data.o)}. Que Deus abençoe a sua generosidade.</p>`;
    })()
    : `<div class="card pub__card pub__bad"><h1>Recibo não encontrado</h1><p class="muted">A ligação está incompleta ou foi alterada. Peça ao gestor que lhe envie o recibo outra vez.</p></div>`;

  root.innerHTML = `
    <main class="pub">
      <header class="pub__top"><img src="assets/brand/logo-lockup-white.svg" alt="Nataniel Litsure Ministries" width="150" height="66"></header>
      <div class="pub__wrap">${body}</div>
      <p class="pub__foot">Comprovativo emitido por Nataniel Litsure Ministries</p>
    </main>`;

  root.querySelector('[data-pdf]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await downloadPdf(data); } catch (ex) { toast(ex.message); }
    b.disabled = false;
  });
}
