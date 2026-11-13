// Relatório de recebimentos em PDF (A4): cabeçalho com o logótipo, indicadores,
// resumos por gestor e por forma de pagamento, lista completa e linhas de assinatura.
import { newPdf, saveBlob, PDF_COLORS } from './share.js';
import { money } from './format.js';

const { NAVY, ORANGE, INK, MUTED, LINE, TINT } = PDF_COLORS;
const W = 210, H = 297, M = 16, BOTTOM = H - 20;

export async function reportPdf(rep) {
  const { doc, logo } = await newPdf('a4');
  const font = (w, size, color = INK) => { doc.setFont('Montserrat', w); doc.setFontSize(size); doc.setTextColor(...color); };
  const fit = (t, width) => {
    t = String(t ?? '');
    if (doc.getTextWidth(t) <= width) return t;
    while (t.length > 1 && doc.getTextWidth(`${t}…`) > width) t = t.slice(0, -1);
    return `${t}…`;
  };
  doc.setProperties({ title: rep.title, author: 'Nataniel Litsure Ministries', subject: rep.obra });

  // Cabeçalho (só na primeira página)
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 36, 'F');
  doc.setFillColor(...ORANGE); doc.rect(0, 36, W, 1.2, 'F');
  doc.addImage(logo, 'JPEG', M, 7.5, 48, 48 * (270 / 615));
  font('bold', 13, [255, 255, 255]);
  doc.text(rep.title, W - M, 16, { align: 'right' });
  font('regular', 9, [205, 208, 232]);
  doc.text(rep.period, W - M, 22.5, { align: 'right' });
  doc.text(rep.obra, W - M, 28, { align: 'right' });

  // Identificação
  let y = 47;
  const info = [['Gestor', rep.who], ['Período', rep.range], ['Emitido em', rep.issuedAt], ['Emitido por', rep.issuedBy]];
  const iw = [0.24, 0.34, 0.22, 0.2].map((f) => f * (W - 2 * M));
  let ix = M;
  info.forEach(([l, v], i) => {
    font('regular', 7.5, MUTED); doc.text(l, ix, y);
    font('semibold', 9, INK); doc.text(fit(v, iw[i] - 4), ix, y + 5);
    ix += iw[i];
  });

  // Indicadores
  y += 12;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
  doc.roundedRect(M, y, W - 2 * M, 20, 1.5, 1.5, 'S');
  const kpis = [['Total recebido', money(rep.total)], ['Recebimentos', String(rep.count)], ['Membros', String(rep.members)], ['Valor médio', money(rep.avg)]];
  const kw = [0.34, 0.2, 0.18, 0.28].map((f) => f * (W - 2 * M));
  let kx = M;
  kpis.forEach(([l, v], i) => {
    if (i) doc.line(kx, y + 3, kx, y + 17);
    font('regular', 7.5, MUTED); doc.text(l, kx + 5, y + 7);
    font(i ? 'semibold' : 'bold', i ? 11 : 13, i ? INK : NAVY); doc.text(v, kx + 5, y + 14.5);
    kx += kw[i];
  });
  y += 30;

  // Rodapé de cada página (preenchido no fim, quando se sabe o total de páginas)
  const footers = () => {
    const n = doc.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      doc.setPage(p);
      doc.setDrawColor(...LINE); doc.line(M, H - 13, W - M, H - 13);
      font('regular', 7, MUTED);
      doc.text(`Nataniel Litsure Ministries · ${rep.obra} · Processado por computador`, M, H - 8.5);
      doc.text(`Página ${p} de ${n}`, W - M, H - 8.5, { align: 'right' });
    }
  };

  const newPage = () => { doc.addPage(); y = 18; };
  const section = (title, need = 20) => {
    if (y + need > BOTTOM) newPage();
    font('bold', 10.5, NAVY); doc.text(title, M, y);
    y += 4;
  };

  // Tabela com cabeçalho repetido quando muda de página
  const table = (cols, rows, total) => {
    const widths = cols.map((c) => c.w * (W - 2 * M));
    const head = () => {
      doc.setFillColor(...TINT); doc.rect(M, y, W - 2 * M, 7.5, 'F');
      font('semibold', 7.5, MUTED);
      let x = M;
      cols.forEach((c, i) => {
        doc.text(c.label, c.r ? x + widths[i] - 2.5 : x + 2.5, y + 5, { align: c.r ? 'right' : 'left' });
        x += widths[i];
      });
      y += 7.5;
    };
    const line = (cells, bold) => {
      if (y + 7 > BOTTOM) { newPage(); head(); }
      let x = M;
      cells.forEach((v, i) => {
        const c = cols[i];
        font(bold || c.strong ? 'semibold' : 'regular', 8, c.muted && !bold ? MUTED : INK);
        const t = fit(v, widths[i] - 5);
        doc.text(t, c.r ? x + widths[i] - 2.5 : x + 2.5, y + 4.8, { align: c.r ? 'right' : 'left' });
        x += widths[i];
      });
      y += 7;
      doc.setDrawColor(...LINE); doc.line(M, y, W - M, y);
    };
    head();
    rows.forEach((r) => line(r));
    if (total) {
      if (y + 8 > BOTTOM) { newPage(); head(); }
      doc.setDrawColor(...NAVY); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); doc.setLineWidth(0.3);
      line(total, true);
    }
    y += 8;
  };

  if (rep.byGestor.length) {
    section('Por gestor');
    table(
      [{ label: 'Gestor', w: 0.46 }, { label: 'Recebimentos', w: 0.18, r: true }, { label: 'Parte', w: 0.14, r: true }, { label: 'Valor', w: 0.22, r: true, strong: true }],
      rep.byGestor.map((g) => [g.nome, String(g.n), g.pct, money(g.v)]),
      ['Total geral', String(rep.count), '100,0%', money(rep.total)],
    );
  }

  if (rep.byMethod.length) {
    section('Por forma de pagamento');
    table(
      [{ label: 'Forma de pagamento', w: 0.6 }, { label: 'Recebimentos', w: 0.18, r: true }, { label: 'Valor', w: 0.22, r: true, strong: true }],
      rep.byMethod.map((m) => [m.l, String(m.n), money(m.v)]),
    );
  }

  section('Recebimentos', 30);
  if (rep.rows.length) {
    const cols = rep.showGestor
      ? [{ label: 'Data', w: 0.095 }, { label: 'Recibo', w: 0.18, muted: true }, { label: 'Membro', w: 0.235 }, { label: 'Forma', w: 0.155 }, { label: 'Recebido por', w: 0.165 }, { label: 'Valor', w: 0.17, r: true, strong: true }]
      : [{ label: 'Data', w: 0.11 }, { label: 'Recibo', w: 0.2, muted: true }, { label: 'Membro', w: 0.34 }, { label: 'Forma', w: 0.17 }, { label: 'Valor', w: 0.18, r: true, strong: true }];
    table(cols, rep.rows, [...cols.slice(0, -1).map((_, i) => (i === 0 ? 'Total' : '')), money(rep.total)]);
  } else {
    font('regular', 9, MUTED); doc.text('Não há recebimentos neste período.', M, y + 4); y += 14;
  }

  // Assinaturas
  // Espaço para assinar: 14 mm de folga + a linha e o nome
  if (y + 21 > BOTTOM) newPage();
  y += 14;
  const sw = 64;
  [[M, rep.signLeft], [W - M - sw, 'Administração']].forEach(([x, label]) => {
    doc.setDrawColor(...INK); doc.setLineWidth(0.3); doc.line(x, y, x + sw, y);
    font('regular', 8, MUTED); doc.text(label, x + sw / 2, y + 5, { align: 'center' });
  });

  footers();
  return doc.output('blob');
}

export async function downloadReportPdf(rep) {
  saveBlob(await reportPdf(rep), rep.file);
}
