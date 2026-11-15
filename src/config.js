// Ligação à base de dados partilhada (Supabase).
// Sem url/anonKey, o sistema funciona só neste navegador (modo local).
// A chave "anon" é pública por natureza: as regras de acesso estão no servidor (supabase/schema.sql).
export const CONFIG = {
  url: '',
  anonKey: '',
  // Domínio interno dos endereços de acesso (telemóvel@domínio); não recebe emails
  authDomain: 'nl-obra.app',
};
