// Relatórios em PDF (A4): cabeçalho com o logótipo, identificação, indicadores e as
// secções que o ecrã envia (tabelas), com linhas de assinatura no fim.
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
  const iw = [0.24, 0.34, 0.22, 0.2].map((f) => f * (W - 2 * M));
  let ix = M;
  rep.info.forEach(([l, v], i) => {
    font('regular', 7.5, MUTED); doc.text(l, ix, y);
    font('semibold', 9, INK); doc.text(fit(v, iw[i] - 4), ix, y + 5);
    ix += iw[i];
  });

  // Indicadores (o principal fica destacado)
  y += 12;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
  const kTotal = rep.kpis.reduce((s, k) => s + (k.main ? 1.35 : 1), 0);
  let kx = M;
  rep.kpis.forEach((k, i) => {
    const kw = ((k.main ? 1.35 : 1) / kTotal) * (W - 2 * M);
    if (k.main) { doc.setFillColor(...TINT); doc.rect(kx, y, kw, 20, 'F'); }
    if (i) doc.line(kx, y + (k.main ? 0 : 3), kx, y + (k.main ? 20 : 17));
    font('regular', 7.5, MUTED); doc.text(k.l, kx + 5, y + 7);
    font(k.main ? 'bold' : 'semibold', k.main ? 12.5 : 10.5, k.main || k.strong ? NAVY : INK); doc.text(fit(k.v, kw - 8), kx + 5, y + 14.5);
    kx += kw;
  });
  doc.roundedRect(M, y, W - 2 * M, 20, 1.5, 1.5, 'S');
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

  // Tabela com cabeçalho repetido quando muda de página. Uma linha pode trazer texto
  // por baixo de uma coluna (ex.: a nota de uma despesa), com quebra de linha.
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
    const line = (row, bold) => {
      const cells = Array.isArray(row) ? row : row.cells;
      const sub = Array.isArray(row) ? null : row.sub;
      let subLines = [];
      if (sub) {
        font('regular', 7.5, MUTED);
        subLines = sub.lines.flatMap((t) => doc.splitTextToSize(t, widths[sub.col] - 5));
      }
      // Colunas com quebra de linha (ex.: categoria): o texto passa à linha seguinte
      const wraps = cells.map((v, i) => {
        if (!cols[i].wrap || bold) return null;
        font('regular', 8, INK);
        return doc.splitTextToSize(String(v ?? ''), widths[i] - 5);
      });
      const wrapExtra = Math.max(0, ...wraps.map((l) => (l ? l.length - 1 : 0)));
      const h = 7 + Math.max(subLines.length * 3.5 + (subLines.length ? 1.5 : 0), wrapExtra * 3.6);
      if (y + h > BOTTOM) { newPage(); head(); }
      let x = M;
      cells.forEach((v, i) => {
        const c = cols[i];
        font(bold || c.strong ? 'semibold' : 'regular', 8, c.muted && !bold ? MUTED : INK);
        // Linha de total: o rótulo ocupa também as colunas vazias à sua direita
        let room = widths[i];
        if (bold && i === 0) for (let j = 1; j < cells.length && cells[j] === ''; j++) room += widths[j];
        if (wraps[i]) wraps[i].forEach((t2, k) => doc.text(t2, x + 2.5, y + 4.8 + k * 3.6));
        else doc.text(fit(v, room - 5), c.r ? x + widths[i] - 2.5 : x + 2.5, y + 4.8, { align: c.r ? 'right' : 'left' });
        if (sub && i === sub.col) {
          font('regular', 7.5, MUTED);
          subLines.forEach((t2, k) => doc.text(t2, x + 2.5, y + 8.6 + k * 3.5));
        }
        x += widths[i];
      });
      y += h;
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

  for (const sec of rep.sections) {
    if (!sec.rows.length && !sec.empty) continue;
    section(sec.title, sec.rows.length ? 30 : 16);
    if (sec.rows.length) table(sec.cols, sec.rows, sec.total);
    else { font('regular', 9, MUTED); doc.text(sec.empty, M, y + 4); y += 14; }
  }

  // Assinaturas
  // Espaço para assinar: 14 mm de folga + a linha e o nome
  if (y + 21 > BOTTOM) newPage();
  y += 14;
  const sw = 64;
  [[M, rep.signLeft], [W - M - sw, rep.signRight || 'Administração']].forEach(([x, label]) => {
    doc.setDrawColor(...INK); doc.setLineWidth(0.3); doc.line(x, y, x + sw, y);
    font('regular', 8, MUTED); doc.text(label, x + sw / 2, y + 5, { align: 'center' });
  });

  footers();
  return doc.output('blob');
}

export async function downloadReportPdf(rep) {
  return saveBlob(await reportPdf(rep), rep.file);
}
