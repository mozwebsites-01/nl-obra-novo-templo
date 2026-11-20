// Ligação à base de dados partilhada (Supabase).
// Sem url/anonKey, o sistema funciona só neste navegador (modo local).
// A chave "anon" é pública por natureza: as regras de acesso estão no servidor (supabase/schema.sql).
export const CONFIG = {
  url: 'https://obqoavamffnobtpggwfb.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9icW9hdmFtZmZub2J0cGdnd2ZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxNzU3NzksImV4cCI6MjExMDc1MTc3OX0.0sC23kOf0qinNXPBbCw6hteQyqLN484186rtY59ZF4I',
  // Domínio interno dos endereços de acesso (telemóvel@domínio); não recebe emails
  authDomain: 'nl-obra.app',
  // Envio automático do recibo pelo WhatsApp oficial (função send-receipt no Supabase)
  whatsappAuto: false, // ligar quando a app da Meta e as funções estiverem prontas (supabase/WHATSAPP.md)
};
