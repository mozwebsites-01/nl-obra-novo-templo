// whatsapp-webhook — a Meta avisa aqui quando a mensagem do recibo é entregue, lida ou falha.
// Atualiza o estado do envio de cada recibo (enviado → entregue → lido · falhou).
//
// Configurar na Meta (App › WhatsApp › Configuration › Webhook):
//   Callback URL: https://<projeto>.supabase.co/functions/v1/whatsapp-webhook
//   Verify token: o mesmo valor do segredo WA_VERIFY_TOKEN
//   Subscrever o campo "messages"
// Implementar com "Verify JWT" DESLIGADO (a Meta não envia sessão do Supabase).
//
// Segredos: WA_VERIFY_TOKEN, WA_APP_SECRET (para confirmar que o aviso vem mesmo da Meta)
import { createClient } from 'npm:@supabase/supabase-js@2';

const ORDER = ['a_enviar', 'enviado', 'entregue', 'lido'];
const MAP: Record<string, string> = { sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'falhou' };

async function validSignature(raw: string, header: string | null, secret: string) {
  if (!secret) return true; // sem segredo configurado, não verifica (não recomendado)
  if (!header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === header.slice(7);
}

Deno.serve(async (req) => {
  const env = (k: string) => Deno.env.get(k) || '';
  const url = new URL(req.url);

  // Verificação inicial da Meta
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env('WA_VERIFY_TOKEN');
    return ok ? new Response(url.searchParams.get('hub.challenge') || '', { status: 200 }) : new Response('Forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get('x-hub-signature-256'), env('WA_APP_SECRET')))) {
    return new Response('Invalid signature', { status: 401 });
  }

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response('ok'); }

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      for (const st of change.value?.statuses || []) {
        const estado = MAP[st.status];
        if (!estado || !st.id) continue;
        const { data: c } = await admin.from('contributions').select('id, envio_estado').eq('whatsapp_msg_id', st.id).maybeSingle();
        if (!c) continue;
        // Os avisos podem chegar fora de ordem: nunca recua (lido não volta a entregue)
        if (estado !== 'falhou' && ORDER.indexOf(estado) <= ORDER.indexOf(c.envio_estado)) continue;
        const erro = estado === 'falhou' ? (st.errors?.[0]?.error_data?.details || st.errors?.[0]?.title || 'A mensagem não foi entregue.') : null;
        await admin.from('contributions').update({ envio_estado: estado, envio_erro: erro }).eq('id', c.id);
      }
    }
  }
  return new Response('ok', { status: 200 });
});
