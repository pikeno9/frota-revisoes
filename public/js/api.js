async function pedir(metodo, caminho, corpo) {
  const r = await fetch(caminho, {
    method: metodo,
    headers: metodo === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: metodo === 'GET' ? undefined : JSON.stringify(corpo ?? {}),
    credentials: 'same-origin',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.erro || `Erro ${r.status}`), { status: r.status });
  return j;
}
export const get = c => pedir('GET', c);
export const post = (c, b = {}) => pedir('POST', c, b);
export const patch = (c, b) => pedir('PATCH', c, b);
export const put = (c, b) => pedir('PUT', c, b);
