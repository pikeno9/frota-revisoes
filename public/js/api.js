async function pedir(metodo, caminho, corpo) {
  const r = await fetch(caminho, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
    credentials: 'same-origin',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.erro || `Erro ${r.status}`), { status: r.status });
  return j;
}
export const get = c => pedir('GET', c);
export const post = (c, b = {}) => pedir('POST', c, b);
export const patch = (c, b) => pedir('PATCH', c, b);
