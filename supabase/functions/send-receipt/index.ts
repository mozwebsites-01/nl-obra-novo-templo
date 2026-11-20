// send-receipt — envia ao membro, pelo WhatsApp oficial da tesouraria, a confirmação da
// contribuição com o recibo em PDF anexado (API Cloud do WhatsApp, da Meta).
//
// Chamada pelo sistema logo depois de o gestor registar a contribuição:
//   POST multipart/form-data  { contribution_id, pdf }   (com a sessão do gestor)
// O PDF é o mesmo recibo que o sistema gera no ecrã.
//
// Segredos (Supabase › Edge Functions › Secrets):
//   WA_TOKEN            token permanente (utilizador de sistema da Meta)
//   WA_PHONE_NUMBER_ID  identificador do número +258 87 947 0600 na API
//   WA_TEMPLATE         nome do modelo aprovado (por omissão: recibo_contribuicao)
//   WA_TEMPLATE_LANG    idioma do modelo (por omissão: pt_PT)
import { createClient } from 'npm:@supabase/supabase-js@2';

const GRAPH = 'https://graph.facebook.com/v21.0';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const METODOS: Record<string, string> = { mpesa: 'M-Pesa', emola: 'e-Mola', banco: 'Transferência bancária', numerario: 'Numerário' };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const money = (v: number) => `${Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} MT`;
const fmtDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${String(d).padStart(2, '0')} ${MESES[m - 1]} ${y}`; };

// Mensagens de erro da Meta em linguagem simples
function explain(err: any): string {
  const code = err?.error?.code;
  const msg = err?.error?.error_user_msg || err?.error?.message || 'Erro desconhecido';
  if (code === 131026) return 'O número do membro não tem WhatsApp.';
  if (code === 132001) return 'O modelo de mensagem não existe ou ainda não foi aprovado pela Meta.';
  if (code === 190) return 'O token de acesso do WhatsApp expirou ou é inválido.';
  if (code === 131047) return 'Passaram mais de 24 h desde a última conversa; é preciso um modelo aprovado.';
  if (code === 131056) return 'Demasiadas mensagens para este número em pouco tempo. Tente daqui a pouco.';
  return msg;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  const env = (k: string, d = '') => Deno.env.get(k) || d;
  const url = env('SUPABASE_URL');
  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'));
  // Cliente com a sessão de quem chamou: as regras de acesso decidem se pode ver o recibo
  const asUser = createClient(url, env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });

  let id = '';
  let pdf: File | null = null;
  try {
    const form = await req.formData();
    id = String(form.get('contribution_id') || '');
    const f = form.get('pdf');
    pdf = f instanceof File ? f : null;
  } catch {
    return json({ error: 'Pedido inválido.' }, 400);
  }
  if (!id || !pdf) return json({ error: 'Falta o recibo.' }, 400);
  if (pdf.size > 2_000_000 || !/pdf/i.test(pdf.type || 'application/pdf')) return json({ error: 'O recibo tem de ser um PDF até 2 MB.' }, 400);

  // Só quem registou (ou a administração) pode enviar este recibo
  const { data: visible } = await asUser.from('contributions').select('id').eq('id', id).maybeSingle();
  if (!visible) return json({ error: 'Recibo não encontrado ou sem permissão.' }, 403);

  const { data: c } = await admin.from('contributions').select('*').eq('id', id).single();
  if (['enviado', 'entregue', 'lido'].includes(c.envio_estado) && new URL(req.url).searchParams.get('force') !== '1') {
    return json({ estado: c.envio_estado, ja_enviado: true });
  }
  const [{ data: m }, { data: s }] = await Promise.all([
    admin.from('people').select('nome, telefone').eq('id', c.membro_id).single(),
    admin.from('settings').select('obra_nome').eq('id', 1).single(),
  ]);

  const token = env('WA_TOKEN');
  const phoneId = env('WA_PHONE_NUMBER_ID');
  const fail = async (motivo: string, status = 502) => {
    await admin.from('contributions').update({ envio_estado: 'falhou', envio_erro: motivo, envio_em: new Date().toISOString(), envio_tentativas: (c.envio_tentativas || 0) + 1 }).eq('id', id);
    return json({ estado: 'falhou', erro: motivo }, status);
  };
  if (!token || !phoneId) return fail('O envio automático ainda não está configurado (WA_TOKEN / WA_PHONE_NUMBER_ID).', 503);

  await admin.from('contributions').update({ envio_estado: 'a_enviar', envio_erro: null }).eq('id', id);

  try {
    // 1) Carrega o PDF para o WhatsApp
    const filename = `Recibo-${c.ref}.pdf`;
    const up = new FormData();
    up.append('messaging_product', 'whatsapp');
    up.append('type', 'application/pdf');
    up.append('file', new File([await pdf.arrayBuffer()], filename, { type: 'application/pdf' }));
    const media = await fetch(`${GRAPH}/${phoneId}/media`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: up });
    const mediaJson = await media.json();
    if (!media.ok) return fail(explain(mediaJson));

    // 2) Envia a mensagem-modelo com o PDF no cabeçalho
    const first = String(m.nome).trim().split(/\s+/)[0];
    const body = {
      messaging_product: 'whatsapp',
      to: `258${m.telefone}`,
      type: 'template',
      template: {
        name: env('WA_TEMPLATE', 'recibo_contribuicao'),
        language: { code: env('WA_TEMPLATE_LANG', 'pt_PT') },
        components: [
          { type: 'header', parameters: [{ type: 'document', document: { id: mediaJson.id, filename } }] },
          { type: 'body', parameters: [
            { type: 'text', text: first },
            { type: 'text', text: money(c.valor) },
            { type: 'text', text: s?.obra_nome || 'Obra do Novo Templo' },
            { type: 'text', text: `${fmtDate(c.data)} · ${METODOS[c.metodo] || c.metodo}` },
            { type: 'text', text: c.ref },
          ] },
        ],
      },
    };
    const send = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const sendJson = await send.json();
    if (!send.ok) return fail(explain(sendJson));

    const msgId = sendJson.messages?.[0]?.id || null;
    await admin.from('contributions').update({
      envio_estado: 'enviado', envio_erro: null, envio_em: new Date().toISOString(),
      envio_tentativas: (c.envio_tentativas || 0) + 1, whatsapp_msg_id: msgId,
      notificado_em: new Date().toISOString(), notificado_canal: 'whatsapp-auto',
    }).eq('id', id);
    return json({ estado: 'enviado', mensagem: msgId });
  } catch (e) {
    return fail(`Sem ligação ao WhatsApp: ${(e as Error).message}`);
  }
});
