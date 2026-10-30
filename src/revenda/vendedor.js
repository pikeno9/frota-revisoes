// Tipo de vendedor de um anúncio: locadora (seminovos das locadoras), loja ou particular.
const LOCADORAS = /\b(localiza|movida|unidas|foco aluguel|kovi|mobbi)\b/i;

export function tipoVendedor(nome, profissional) {
  if (nome && LOCADORAS.test(nome)) return 'locadora';
  if (profissional === true) return 'loja';
  if (profissional === false) return 'particular';
  return null;
}
