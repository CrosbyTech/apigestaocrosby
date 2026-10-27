// Manifestação do Destinatário — evento 210210 (Ciência da Operação) no
// Ambiente Nacional, com o certificado A1 da filial destinatária.
// Autorizado pelo Yago em 27/10/2026 para liberar o XML completo (e o DANFE)
// das notas que a Distribuição DFe entrega só como resumo.
//
// Não usa Tools.sefazEvento da node-sped-nfe porque ele valida o XML com o
// binário `xmllint` (inexistente no Windows e no Render); reaproveita o envio
// SOAP próprio do PDV (services/pdvFiscal.js), igual ao cancelamento.
import { Tools, json2xml, xml2json, cUF2UF, formatData } from 'node-sped-nfe';
import { postSoap, corpoSoap, envelopar } from './pdvFiscal.js';
import { carregarCertificados } from '../config/sefazCerts.js';
import { filialPorCnpj } from '../config/sefazFiliais.js';

const TP_AMB = process.env.SEFAZ_TP_AMB || '1'; // 1 = produção
// Eventos do destinatário (2102xx) vão para o Ambiente Nacional. A tabela da
// node-sped-nfe chama de "AN" o SEFAZ Virtual (sefazvirtual.fazenda.gov.br),
// que não é isso — e urlEventos('AN') nem resolve, porque o mod65 não tem AN.
const URL_AN_RECEPCAO_EVENTO = {
  1: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  2: 'https://hom.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
};
const digits = (v) => String(v || '').replace(/\D/g, '');
const val = (o, ...ks) => ks.reduce((a, k) => (a == null ? a : a[k]), o);

export const EVENTO_CIENCIA = '210210';

function certificadoDaFilial(filial, certs) {
  return (
    certs.find((c) => c.arquivo === filial.cert) ||
    certs.find((c) => digits(c.cnpj).slice(0, 8) === String(filial.cnpj).slice(0, 8)) ||
    null
  );
}

// Registra a Ciência da Operação para a nota `chave` em nome do CNPJ
// destinatário. Retorna { ok, cStat, xMotivo, nProt, dhRegEvento }.
// cStat 135 = evento registrado e vinculado; 573 = já registrado antes (ok).
export async function registrarCienciaOperacao({ chave, cnpjDestinatario, nSeqEvento = 1 }) {
  const ch = digits(chave);
  const cnpj = digits(cnpjDestinatario);
  if (ch.length !== 44) throw new Error('Chave de acesso inválida');
  if (cnpj.length !== 14) throw new Error('CNPJ do destinatário inválido');
  if (ch.substring(20, 22) !== '55') {
    throw new Error('Manifestação do destinatário só se aplica a NF-e (modelo 55)');
  }

  const filial = filialPorCnpj(cnpj) || { cnpj, cert: null };
  const cert = certificadoDaFilial(filial, carregarCertificados());
  if (!cert) throw new Error('Sem certificado para a filial destinatária desta nota');

  const tools = new Tools(
    {
      mod: '55',
      UF: cUF2UF[String(cert.cUF)] || 'PE',
      tpAmb: Number(TP_AMB),
      versao: '4.00',
      timeout: 60,
      openssl: process.env.NFE_OPENSSL_PATH || null,
      xmllint: 'xmllint',
      CNPJ: cnpj,
    },
    { pfx: cert.pfx, senha: cert.senha },
  );
  const pem = await tools.getCertificado();

  const evento = {
    envEvento: {
      '@xmlns': 'http://www.portalfiscal.inf.br/nfe',
      '@versao': '1.00',
      idLote: String(Date.now()).slice(-15),
      evento: {
        '@xmlns': 'http://www.portalfiscal.inf.br/nfe',
        '@versao': '1.00',
        infEvento: {
          '@Id': `ID${EVENTO_CIENCIA}${ch}${String(nSeqEvento).padStart(2, '0')}`,
          cOrgao: '91', // Ambiente Nacional (eventos do destinatário)
          tpAmb: Number(TP_AMB),
          CNPJ: cnpj,
          chNFe: ch,
          dhEvento: formatData(),
          tpEvento: EVENTO_CIENCIA,
          nSeqEvento: Number(nSeqEvento),
          verEvento: '1.00',
          detEvento: {
            '@versao': '1.00',
            descEvento: 'Ciencia da Operacao',
          },
        },
      },
    },
  };

  const assinado = await tools.xmlSign(await json2xml(evento), { tag: 'infEvento' });
  const url =
    process.env.SEFAZ_AN_RECEPCAO_EVENTO_URL ||
    URL_AN_RECEPCAO_EVENTO[Number(TP_AMB)] ||
    URL_AN_RECEPCAO_EVENTO[1];
  const xml = await envelopar('NFeRecepcaoEvento4', await xml2json(assinado));
  const retorno = await postSoap({ url, xml, pem });

  const { corpo } = await corpoSoap(retorno, 'retEnvEvento');
  const r = corpo || {};
  const inf = val(r, 'retEvento', 'infEvento') || val([].concat(r.retEvento || [])[0], 'infEvento');
  const cStat = String(val(inf, 'cStat') ?? val(r, 'cStat') ?? '');
  return {
    ok: cStat === '135' || cStat === '573',
    cStat,
    xMotivo: String(val(inf, 'xMotivo') || val(r, 'xMotivo') || ''),
    nProt: val(inf, 'nProt') ? String(val(inf, 'nProt')) : null,
    dhRegEvento: val(inf, 'dhRegEvento') || null,
  };
}

export default { registrarCienciaOperacao, EVENTO_CIENCIA };
