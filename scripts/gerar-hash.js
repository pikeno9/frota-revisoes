// Uso: npm run hash -- "senha"  →  valor para ADMIN_SENHA_HASH no Coolify.
import { gerarHash } from '../src/auth.js';

const senha = process.argv[2];
if (!senha) { console.error('uso: npm run hash -- "senha"'); process.exit(1); }
console.log(gerarHash(senha));
