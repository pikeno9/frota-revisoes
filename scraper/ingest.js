// Envio compartilhado: manda um lote de preços para a API (POST /api/ingest).
export async function enviar(itens, fonte) {
  let API_URL = process.env.API_URL;
  const TOKEN = process.env.INGEST_TOKEN;
  if (!API_URL || !TOKEN) throw new Error('defina API_URL e INGEST_TOKEN no ambiente');
  API_URL = API_URL.trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(API_URL)) API_URL = 'https://' + API_URL; // tolera URL sem esquema
  const hoje = new Date().toISOString().slice(0, 10);
  const r = await fetch(`${API_URL}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-token': TOKEN },
    body: JSON.stringify({ data_coleta: hoje, fonte, itens }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`API respondeu ${r.status}: ${txt}`);
  return txt;
}
