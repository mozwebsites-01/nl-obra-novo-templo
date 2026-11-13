// Comprovativo para o membro: PDF do recibo, ligação pública e mensagem de WhatsApp.
//
// Sem servidor partilhado, o recibo viaja dentro da própria ligação (#/recibo/<dados>):
// quem a abre vê o recibo e descarrega o PDF, sem precisar de entrar no sistema.
import { METODOS, money, fmtDate, fmtDateTime, phoneFmt, firstName, porExtenso } from './format.js';

// Dados mínimos do recibo ---------------------------------------------------
export function receiptData(c, { member, reviewer, settings }) {
  return {
    r: c.ref, v: c.valor, m: c.metodo, d: c.data,
    n: member?.nome || '', t: member?.telefone || '',
    k: c.nota || '',
    e: c.revistoEm || c.declaradoEm, o: settings?.obraNome || 'Obra do Novo Templo',
  };
}

// Recibo no formato das vistas (ui.receipt) a partir dos dados da ligação
export function fromData(x) {
  return {
    c: { ref: x.r, valor: x.v, metodo: x.m, data: x.d, pagador: x.p, referencia: x.x, nota: x.k, estado: 'confirmado', registadoPor: 'ligacao', revistoEm: x.e },
    member: { nome: x.n, telefone: x.t || x.tm || '' },
    reviewer: { nome: x.g, cargo: x.gc },
    settings: { obraNome: x.o },
  };
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function encodeReceipt(data) {
  return b64url(new TextEncoder().encode(JSON.stringify(data)));
}

export function decodeReceipt(s) {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const x = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    return x && x.r && Number.isFinite(x.v) ? x : null;
  } catch {
    return null;
  }
}

// A ligação não leva o número completo do membro: só os 2 primeiros e os 4 últimos dígitos
const maskPhone = (t) => (t ? `${t.slice(0, 2)}***${t.slice(-4)}` : '');
export const receiptUrl = (data) =>
  `${location.origin}${location.pathname}#/recibo/${encodeReceipt({ ...data, t: '', tm: data.tm || maskPhone(data.t) })}`;

// WhatsApp -------------------------------------------------------------------
export function whatsappText(data) {
  return [
    '*Nataniel Litsure Ministries*',
    data.o,
    '',
    `Olá, ${firstName(data.n)}! Confirmamos a receção da sua contribuição. Muito obrigado.`,
    '',
    `*Valor:* ${money(data.v)}`,
    `*Forma de pagamento:* ${METODOS[data.m]}`,
    `*Data:* ${fmtDate(data.d)}`,
    `*Recibo n.º:* ${data.r}`,
    '',
    'Comprovativo em PDF:',
    receiptUrl(data),
    '',
    'Que Deus abençoe a sua generosidade.',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

export const whatsappLink = (data) => `https://wa.me/258${data.t}?text=${encodeURIComponent(whatsappText(data))}`;

// PDF ------------------------------------------------------------------------
let libReady;
function loadLib() {
  libReady ||= new Promise((resolve, reject) => {
    if (window.jspdf) return resolve();
    const s = document.createElement('script');
    s.src = 'assets/vendor/jspdf.umd.min.js';
    s.onload = resolve;
    s.onerror = () => { libReady = null; reject(new Error('Não foi possível preparar o PDF. Verifique a ligação à internet.')); };
    document.head.append(s);
  });
  return libReady;
}

const toB64 = (buf) => {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

let assets;
function loadAssets() {
  assets ||= (async () => {
    const fonts = await Promise.all(['Regular', 'SemiBold', 'Bold'].map(async (w) => [w, toB64(await (await fetch(`assets/fonts/Montserrat-${w}.ttf`)).arrayBuffer())]));
    // O logótipo é usado tal como está: só é convertido em imagem, no tamanho certo
    const logo = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = 1230; cv.height = 540;
        const g = cv.getContext('2d');
        g.fillStyle = '#0B1060'; // o mesmo azul do cabeçalho do PDF, para usar JPEG (ficheiro leve)
        g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = reject;
      img.src = 'assets/brand/logo-lockup-white.svg';
    });
    return { fonts, logo };
  })().catch((e) => { assets = null; throw e; });
  return assets;
}

const NAVY = [11, 16, 96];
const ORANGE = [217, 128, 10];
const INK = [20, 22, 43];
const MUTED = [104, 108, 128];
const LINE = [226, 228, 234];
const TINT = [236, 237, 246];

// Parágrafo com partes em negrito, quebrado palavra a palavra na largura dada
function richText(doc, pieces, x, y, width, size, lead, color) {
  doc.setFontSize(size); doc.setTextColor(...color);
  const words = pieces.flatMap(([w, t]) => t.split(/(\s+)/).filter(Boolean).map((p) => [w, p]));
  let cx = x;
  for (const [w, p] of words) {
    doc.setFont('Montserrat', w);
    const pw = doc.getTextWidth(p);
    if (/^\s+$/.test(p)) { if (cx > x) cx += pw; continue; }
    // A pontuação fica sempre colada à palavra anterior
    if (cx + pw > x + width && cx > x && !/^[,.;:]/.test(p)) { y += lead; cx = x; }
    doc.text(p, cx, y);
    cx += pw;
  }
  return y + lead;
}

export async function receiptPdf(data) {
  await loadLib();
  const { fonts, logo } = await loadAssets();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a5', compress: true });
  for (const [w, b64] of fonts) {
    doc.addFileToVFS(`Montserrat-${w}.ttf`, b64);
    doc.addFont(`Montserrat-${w}.ttf`, 'Montserrat', w.toLowerCase());
  }
  const W = 148, M = 14;
  const font = (w, size, color = INK) => { doc.setFont('Montserrat', w); doc.setFontSize(size); doc.setTextColor(...color); };

  doc.setProperties({ title: `Recibo ${data.r}`, author: 'Nataniel Litsure Ministries', subject: data.o });

  // Cabeçalho
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 42, 'F');
  doc.setFillColor(...ORANGE); doc.rect(0, 42, W, 1.2, 'F');
  doc.addImage(logo, 'JPEG', M, 9.5, 52, 52 * (270 / 615));
  font('semibold', 6.5, [200, 203, 230]);
  doc.text('RECIBO DE RECEÇÃO', W - M, 17, { align: 'right', charSpace: 0.6 });
  font('bold', 11.5, [255, 255, 255]);
  doc.text(data.r, W - M, 24, { align: 'right' });
  font('regular', 7, [200, 203, 230]);
  doc.text(data.o, W - M, 29.5, { align: 'right' });

  // Valor numa caixa, como num recibo em papel, e o selo de confirmação
  let y = 56;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
  doc.roundedRect(M, y, W - 2 * M, 17, 1.5, 1.5, 'S');
  font('semibold', 8, MUTED);
  doc.text('MT', M + 5, y + 10.6);
  font('semibold', 19, NAVY);
  doc.text(money(data.v, { unit: false }), M + 13, y + 11.2);
  font('semibold', 7.5, NAVY);
  const tag = 'Pagamento confirmado';
  const tw = doc.getTextWidth(tag) + 10;
  doc.setFillColor(...TINT); doc.roundedRect(W - M - 4 - tw, y + 4.5, tw, 8, 4, 4, 'F');
  doc.setFillColor(...ORANGE); doc.circle(W - M - 4 - tw + 4.2, y + 8.5, 1, 'F');
  doc.text(tag, W - M - 4 - tw + 7, y + 9.6);

  // Texto do recibo com a quantia por extenso
  y += 26;
  const pieces = [
    ['regular', 'Recebemos de '], ['semibold', data.n], ['regular', ' a quantia de '],
    ['semibold', porExtenso(data.v)], ['regular', `, referente à contribuição para a ${data.o}.`],
  ];
  y = richText(doc, pieces, M, y, W - 2 * M, 9.5, 5, INK) + 4;

  // Linhas do recibo
  doc.setDrawColor(...LINE); doc.line(M, y, W - M, y);
  const rows = [
    ['Membro', data.n],
    ['Telemóvel', data.t || data.tm ? `+258 ${phoneFmt(data.t || data.tm)}` : '—'],
    ['Data do pagamento', fmtDate(data.d)],
    ['Forma de pagamento', METODOS[data.m]],
    ['Registado em', fmtDateTime(data.e)],
    ...(data.k ? [['Nota', data.k]] : []),
  ];
  for (const [label, value] of rows) {
    font('semibold', 8.5, INK);
    const lines = doc.splitTextToSize(String(value), 72);
    const h = 5 + lines.length * 4.2;
    font('regular', 8, MUTED);
    doc.text(label, M, y + 6.2);
    font('semibold', 8.5, INK);
    doc.text(lines, W - M, y + 6.2, { align: 'right' });
    y += h + 1.5;
    doc.setDrawColor(...LINE); doc.line(M, y, W - M, y);
  }

  // Rodapé
  y = Math.max(y + 14, 172);
  font('semibold', 9.5, NAVY);
  doc.text('Obrigado pela sua contribuição.', W / 2, y, { align: 'center' });
  font('regular', 8, MUTED);
  doc.text('Que Deus abençoe a sua generosidade.', W / 2, y + 5, { align: 'center' });
  font('regular', 6.5, MUTED);
  doc.text(`Processado por computador · Nataniel Litsure Ministries · ${fmtDateTime(new Date().toISOString())}`, W / 2, 198, { align: 'center' });
  font('semibold', 6.5, NAVY);
  const link = 'Ver este recibo online';
  doc.textWithLink(link, (W - doc.getTextWidth(link)) / 2, 202.5, { url: receiptUrl(data) });

  return doc.output('blob');
}

export const pdfName = (data) => `Recibo-${data.r}.pdf`;

export async function downloadPdf(data) {
  const blob = await receiptPdf(data);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = pdfName(data);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// Partilha nativa do telemóvel (WhatsApp, etc.) com o PDF em anexo
export function canSharePdf() {
  try {
    return !!navigator.canShare?.({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

export async function sharePdf(data) {
  const file = new File([await receiptPdf(data)], pdfName(data), { type: 'application/pdf' });
  await navigator.share({ files: [file], title: `Recibo ${data.r}`, text: whatsappText(data) });
}
