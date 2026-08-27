// Carrega os certificados A1 (e-CNPJ) usados na consulta Distribuição DFe da SEFAZ.
// Os arquivos .pfx e o certificados.json (com as senhas) ficam em backend/certs/,
// fora do controle de versão. O CNPJ é extraído automaticamente do certificado.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CERTS_DIR = path.resolve(__dirname, '../certs');

let cache = null;

function extrairDadosCertificado(pfxBuffer, senha) {
  const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBags = bags[forge.pki.oids.certBag] || [];
  // Pega o certificado folha (com CN contendo o CNPJ no padrão ICP-Brasil "RAZAO SOCIAL:CNPJ")
  for (const bag of certBags) {
    const cert = bag.cert;
    if (!cert) continue;
    const cnField = cert.subject.getField('CN');
    if (!cnField) continue;
    const cn = cnField.value || '';
    const m = cn.match(/:(\d{14})$/);
    if (m) {
      return {
        cnpj: m[1],
        razaoSocial: cn.split(':')[0],
        validade: cert.validity.notAfter,
      };
    }
  }
  throw new Error('CNPJ não encontrado no CN do certificado');
}

export function carregarCertificados({ forcar = false } = {}) {
  if (cache && !forcar) return cache;

  const configPath = path.join(CERTS_DIR, 'certificados.json');
  if (!fs.existsSync(configPath)) {
    console.warn('⚠️ [SefazCerts] certs/certificados.json não encontrado');
    cache = [];
    return cache;
  }

  const lista = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const certificados = [];

  for (const item of lista) {
    const arquivoPath = path.join(CERTS_DIR, item.arquivo);
    if (!fs.existsSync(arquivoPath)) {
      console.warn(`⚠️ [SefazCerts] Arquivo não encontrado: ${item.arquivo}`);
      continue;
    }
    if (!item.senha) {
      console.warn(
        `⚠️ [SefazCerts] Senha não configurada para ${item.arquivo} — ignorando`,
      );
      continue;
    }
    const pfx = fs.readFileSync(arquivoPath);
    try {
      const dados = extrairDadosCertificado(pfx, item.senha);
      certificados.push({
        arquivo: item.arquivo,
        descricao: item.descricao || dados.razaoSocial,
        razaoSocial: dados.razaoSocial,
        cnpj: item.cnpj || dados.cnpj,
        cUF: item.cUF || '26',
        validade: dados.validade,
        pfx,
        senha: item.senha,
      });
      console.log(
        `🔐 [SefazCerts] ${item.arquivo} → CNPJ ${dados.cnpj} (${dados.razaoSocial}) válido até ${dados.validade.toISOString().slice(0, 10)}`,
      );
    } catch (e) {
      console.error(
        `❌ [SefazCerts] Falha ao abrir ${item.arquivo}: ${e.message} (senha incorreta?)`,
      );
    }
  }

  cache = certificados;
  return cache;
}

export default { carregarCertificados };
