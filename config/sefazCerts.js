// Carrega os certificados A1 (e-CNPJ) usados na consulta Distribuição DFe da SEFAZ.
// Duas fontes, nesta ordem:
//   1. Variáveis de ambiente (produção/Render, já que certs/ é gitignored):
//      SEFAZ_CERTIFICADOS = JSON com a mesma forma do certificados.json
//      SEFAZ_PFX_<SLUG>   = o .pfx em base64, um por certificado
//      (SLUG = nome do arquivo sem extensão, maiúsculo, com _ no lugar de -)
//   2. Arquivos em backend/certs/ (desenvolvimento local)
// O CNPJ é extraído automaticamente do certificado, em qualquer uma das fontes.
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

// shopping-recife.pfx -> SEFAZ_PFX_SHOPPING_RECIFE
export const nomeVariavelPfx = (arquivo) =>
  'SEFAZ_PFX_' +
  String(arquivo)
    .replace(/[.]pfx$/i, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');

// Lê a lista de certificados do ambiente ou dos arquivos locais
function lerConfiguracao() {
  if (process.env.SEFAZ_CERTIFICADOS) {
    try {
      // aceita JSON puro ou em base64 (base64 evita problemas de aspas e
      // acentuação ao colar o valor no painel do Render)
      const bruto = process.env.SEFAZ_CERTIFICADOS.trim();
      const texto = bruto.startsWith('[')
        ? bruto
        : Buffer.from(bruto, 'base64').toString('utf8');
      return { origem: 'env', lista: JSON.parse(texto) };
    } catch (e) {
      console.error(
        `❌ [SefazCerts] SEFAZ_CERTIFICADOS não é um JSON válido: ${e.message}`,
      );
      return { origem: 'env', lista: [] };
    }
  }

  const configPath = path.join(CERTS_DIR, 'certificados.json');
  if (!fs.existsSync(configPath)) return { origem: 'nenhuma', lista: [] };
  return {
    origem: 'arquivo',
    lista: JSON.parse(fs.readFileSync(configPath, 'utf8')),
  };
}

// Busca o .pfx: primeiro na env (base64), depois no disco
function lerPfx(arquivo, origem) {
  const envVar = nomeVariavelPfx(arquivo);
  if (process.env[envVar]) {
    return Buffer.from(process.env[envVar].replace(/[\s]/g, ''), 'base64');
  }
  if (origem === 'env') {
    console.warn(
      `⚠️ [SefazCerts] ${arquivo}: variável ${envVar} não definida — ignorando`,
    );
    return null;
  }
  const arquivoPath = path.join(CERTS_DIR, arquivo);
  if (!fs.existsSync(arquivoPath)) {
    console.warn(`⚠️ [SefazCerts] Arquivo não encontrado: ${arquivo}`);
    return null;
  }
  return fs.readFileSync(arquivoPath);
}

export function carregarCertificados({ forcar = false } = {}) {
  if (cache && !forcar) return cache;

  const { origem, lista } = lerConfiguracao();
  if (lista.length === 0) {
    console.warn(
      '⚠️ [SefazCerts] Nenhum certificado configurado — defina SEFAZ_CERTIFICADOS + SEFAZ_PFX_* ou preencha certs/certificados.json',
    );
    cache = [];
    return cache;
  }
  console.log(`🔐 [SefazCerts] Carregando ${lista.length} certificado(s) de: ${origem}`);

  const certificados = [];

  for (const item of lista) {
    if (!item.senha) {
      console.warn(
        `⚠️ [SefazCerts] Senha não configurada para ${item.arquivo} — ignorando`,
      );
      continue;
    }
    const pfx = lerPfx(item.arquivo, origem);
    if (!pfx) continue;
    try {
      const dados = extrairDadosCertificado(pfx, item.senha);
      certificados.push({
        arquivo: item.arquivo,
        descricao: item.descricao || dados.razaoSocial,
        razaoSocial: dados.razaoSocial,
        cnpj: item.cnpj || dados.cnpj,
        empresaCodigo: item.empresaCodigo || null,
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
