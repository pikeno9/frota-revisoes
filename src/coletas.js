// Registro das coletas (uma linha por fonte e rodada) e alerta de falha: usados pela
// rodada das Revisões e pela da Revenda.
export const novaColeta = (db, fonte, origem) =>
  Number(db.prepare("INSERT INTO coletas (fonte, inicio, origem) VALUES (?, datetime('now'), ?)").run(fonte, origem).lastInsertRowid);

export function fecharColeta(db, id, c) {
  db.prepare("UPDATE coletas SET fim = datetime('now'), status = ?, modelos_ok = ?, itens = ?, mudancas = ?, erro = ? WHERE id = ?")
    .run(c.status, c.modelos_ok ?? 0, c.itens ?? 0, c.mudancas ?? 0, c.erro ?? null, id);
}

export function alertaFalha(db, coletaId, texto, modeloId = null) {
  db.prepare("INSERT INTO alertas (coleta_id, tipo, modelo_id, texto) VALUES (?, 'falha', ?, ?)").run(coletaId, modeloId, texto);
}
