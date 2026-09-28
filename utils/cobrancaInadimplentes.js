/**
 * Lógica pura da rota GET /api/cobranca/inadimplentes (sem rede, sem banco),
 * separada para ser testável: routes/cobranca.routes.js só orquestra as
 * chamadas ao TOTVS/Supabase e delega o cálculo para cá.
 */

export const DIAS_INADIMPLENTE = 60;
export const DOC_FATURA = 1;
export const CLIENTES_TESTE = new Set([3591]); // Felipe — vendas de teste do app BlueCard

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const ymd = (v) => (v ? String(v).slice(0, 10) : null);

// Diferença em dias entre duas datas YYYY-MM-DD, ancorada ao meio-dia UTC
// para nunca sofrer com fuso/horário de verão.
export const diasEntre = (deYmd, ateYmd) =>
  Math.round(
    (Date.parse(`${ateYmd}T12:00:00Z`) - Date.parse(`${deYmd}T12:00:00Z`)) /
      86_400_000,
  );

// Mesma chave da unique de esteira_protesto (cd_empresa, nr_fat, nr_parcela)
export const chaveTitulo = (t) =>
  `${Number(t.cd_empresa)}-${Number(t.nr_fat ?? t.nr_fatura)}-${Number(t.nr_parcela ?? 1)}`;

/**
 * Telefone para a API do WhatsApp: só dígitos, com DDI 55.
 * Aceita "(85) 9 8765-4321", "+55 85 98765 4321", "8587654321" (repõe o 9).
 * Retorna { numero: '5585987654321', tipo: 'celular'|'fixo' } ou null.
 */
export function telefoneWhatsApp(bruto) {
  let d = String(bruto || '').replace(/\D/g, '');
  if (!d) return null;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10) {
    const assinante = d.slice(2);
    if (/^[6-9]/.test(assinante)) d = `${d.slice(0, 2)}9${assinante}`;
  }
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11) return null;
  const celular = d.length === 11 && d[2] === '9';
  if (!celular && !/^[2-5]/.test(d.slice(2))) return null;
  return { numero: `55${d}`, tipo: celular ? 'celular' : 'fixo' };
}

/**
 * Dos títulos em aberto do contas a receber, fica só o que é VENCIDO de
 * verdade: FATURA, cliente de um canal pedido, filial válida para o canal,
 * vencimento anterior a hoje (fuso da loja), sem pagamento, sem duplicata.
 *
 * @param itens         linhas do accounts-receivable/filter
 * @param canalDoCliente Map<cd_cliente, { key, filial(bc) => boolean }>
 * @param hoje          YYYY-MM-DD no fuso da loja
 */
export function filtrarVencidos(itens, canalDoCliente, hoje) {
  const vistos = new Set();
  const vencidos = [];
  for (const t of itens) {
    const cod = Number(t.cd_cliente);
    const canal = canalDoCliente.get(cod);
    if (!canal || CLIENTES_TESTE.has(cod)) continue;
    if (Number(t.tp_documento) !== DOC_FATURA) continue;
    if (!canal.filial(t.cd_empresa)) continue;
    const venc = ymd(t.dt_vencimento);
    if (!venc || venc >= hoje) continue;
    if (t.dt_liq || Number(t.vl_pago || 0) > 0.01) continue;
    const k = chaveTitulo(t);
    if (vistos.has(k)) continue;
    vistos.add(k);
    vencidos.push({
      ...t,
      _canal: canal.key,
      _venc: venc,
      _dias: Math.max(0, diasEntre(venc, hoje)),
    });
  }
  return vencidos;
}

/**
 * Agrupa os títulos vencidos por cliente, com cadastro, telefone (manual do
 * Call Center > TOTVS), representante e flag de protesto por título.
 *
 * @param ctx { pessoas: {cod: {name, fantasyName, phone, uf}},
 *              cadastro: Map<cod, {nome, fantasia, documento, tipo_pessoa}>,
 *              nomeFilial: Map<cd_empresa, nome>,
 *              telefoneManual: Map<cod, telefone>,
 *              representante: Map<cod, nome>,
 *              emProtesto: Set<chaveTitulo> }
 */
export function agruparClientes(vencidos, ctx) {
  const pessoas = ctx.pessoas || {};
  const cadastro = ctx.cadastro || new Map();
  const nomeFilial = ctx.nomeFilial || new Map();
  const telefoneManual = ctx.telefoneManual || new Map();
  const representante = ctx.representante || new Map();
  const emProtesto = ctx.emProtesto || new Set();

  const porCliente = new Map();
  for (const t of vencidos) {
    const cod = Number(t.cd_cliente);
    let c = porCliente.get(cod);
    if (!c) {
      const p = pessoas[cod] || pessoas[String(cod)] || {};
      const cad = cadastro.get(cod) || {};
      const documento = String(cad.documento || t.nr_cpfcnpj || '').replace(/\D/g, '');
      const telManual = telefoneManual.get(cod);
      const telBruto = telManual || p.phone || '';
      const wa = telefoneWhatsApp(telBruto);
      c = {
        canal: t._canal,
        cd_cliente: cod,
        nm_cliente: p.name || cad.nome || `Cliente ${cod}`,
        nm_fantasia: p.fantasyName || cad.fantasia || '',
        nr_cpfcnpj: documento,
        tipo_pessoa:
          cad.tipo_pessoa ||
          (documento.length === 14 ? 'PJ' : documento.length === 11 ? 'PF' : null),
        ds_uf: p.uf || '',
        nr_telefone: telBruto,
        telefone_origem: telManual ? 'call_center' : p.phone ? 'totvs' : null,
        telefone_whatsapp: wa?.numero || null,
        telefone_tipo: wa?.tipo || null,
        representante: representante.get(cod) || null,
        qtd_titulos: 0,
        valor_vencido: 0,
        valor_juros: 0,
        valor_multa: 0,
        maior_atraso_dias: 0,
        vencimento_mais_antigo: null,
        titulos: [],
      };
      porCliente.set(cod, c);
    }
    const bc = Number(t.cd_empresa);
    const titulo = {
      cd_empresa: bc,
      nm_empresa: nomeFilial.get(bc) || `Filial ${bc}`,
      nr_fatura: t.nr_fat ?? t.nr_fatura,
      nr_parcela: t.nr_parcela ?? 1,
      dt_emissao: ymd(t.dt_emissao),
      dt_vencimento: t._venc,
      dias_atraso: t._dias,
      vl_fatura: r2(t.vl_fatura),
      vl_juros: r2(t.vl_juros),
      vl_multa: r2(t.vl_multa),
      vl_desconto: r2(t.vl_desconto),
      vl_liquido: r2(t.vl_liquido ?? t.vl_fatura),
      cd_portador: t.cd_portador ?? null,
      nm_portador: t.nm_portador || null,
      tp_cobranca: t.tp_cobranca ?? null,
      nosso_numero: t.nosso_numero || null,
      linha_digitavel: t.linha_digitavel || null,
      cd_barras: t.cd_barras || null,
      qr_code_pix: t.qr_code_pix || null,
      em_protesto: emProtesto.has(chaveTitulo(t)),
    };
    c.titulos.push(titulo);
    c.qtd_titulos++;
    c.valor_vencido += titulo.vl_fatura;
    c.valor_juros += titulo.vl_juros;
    c.valor_multa += titulo.vl_multa;
    if (titulo.dias_atraso > c.maior_atraso_dias) c.maior_atraso_dias = titulo.dias_atraso;
    if (!c.vencimento_mais_antigo || titulo.dt_vencimento < c.vencimento_mais_antigo) {
      c.vencimento_mais_antigo = titulo.dt_vencimento;
    }
  }

  return [...porCliente.values()]
    .map((c) => ({
      ...c,
      valor_vencido: r2(c.valor_vencido),
      valor_juros: r2(c.valor_juros),
      valor_multa: r2(c.valor_multa),
      valor_corrigido: r2(c.valor_vencido + c.valor_juros + c.valor_multa),
      situacao: c.maior_atraso_dias > DIAS_INADIMPLENTE ? 'inadimplente' : 'vencido',
      titulos: c.titulos.sort((a, b) => a.dt_vencimento.localeCompare(b.dt_vencimento)),
    }))
    .sort((a, b) => b.valor_vencido - a.valor_vencido);
}

/**
 * Filtros aplicados depois do cache. Situação vale para o cliente; a faixa de
 * atraso vale título a título (o cliente fica se sobrar ao menos um).
 */
export function aplicarFiltros(clientes, { situacao = 'todos', diasMin = 1, diasMax = null, comTelefone = false } = {}) {
  return clientes
    .filter((c) => situacao === 'todos' || c.situacao === situacao)
    .filter((c) => !comTelefone || c.telefone_whatsapp)
    .map((c) => {
      const titulos = c.titulos.filter(
        (t) => t.dias_atraso >= diasMin && (diasMax == null || t.dias_atraso <= diasMax),
      );
      if (titulos.length === c.titulos.length) return c;
      const soma = (k) => r2(titulos.reduce((s, t) => s + t[k], 0));
      return {
        ...c,
        titulos,
        qtd_titulos: titulos.length,
        valor_vencido: soma('vl_fatura'),
        valor_juros: soma('vl_juros'),
        valor_multa: soma('vl_multa'),
        valor_corrigido: r2(soma('vl_fatura') + soma('vl_juros') + soma('vl_multa')),
      };
    })
    .filter((c) => c.titulos.length > 0);
}

export function resumir(clientes) {
  const porCanal = {};
  for (const c of clientes) {
    const p = (porCanal[c.canal] ||= { clientes: 0, titulos: 0, valor_vencido: 0 });
    p.clientes++;
    p.titulos += c.qtd_titulos;
    p.valor_vencido = r2(p.valor_vencido + c.valor_vencido);
  }
  return {
    clientes: clientes.length,
    titulos: clientes.reduce((s, c) => s + c.qtd_titulos, 0),
    valor_vencido: r2(clientes.reduce((s, c) => s + c.valor_vencido, 0)),
    valor_corrigido: r2(clientes.reduce((s, c) => s + c.valor_corrigido, 0)),
    com_telefone_whatsapp: clientes.filter((c) => c.telefone_whatsapp).length,
    sem_telefone: clientes.filter((c) => !c.telefone_whatsapp).length,
    por_canal: porCanal,
  };
}
