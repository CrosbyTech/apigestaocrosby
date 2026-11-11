import 'dotenv/config';
import supabase from '../../config/supabase.js';
import { listarConciliacoes, atribuirChaves } from '../../services/fluxoCaixaConciliacao.js';
const { data: contas } = await supabase.from('fluxo_caixa_contas').select('id,banco,apelido,agencia,conta,conta_dv,titular_nome,titular_cnpj,escopo').ilike('conta', '%36733%');
console.log(contas);
for (const c of contas.filter(x => x.escopo === 'crosby')) {
  const { data: l } = await supabase.from('fluxo_caixa_lancamentos').select('id,conta_id,data,valor,seq,memo,descricao,forma,contraparte_nome,documento,transferencia_id,tipo').eq('conta_id', c.id).gt('valor', 0).gte('data', '2026-10-01').lte('data', '2026-10-31').order('data').range(0, 1999);
  atribuirChaves(l);
  const concs = await listarConciliacoes({ de: '2026-10-01', ate: '2026-10-31', contaIds: [c.id] });
  const ok = new Set(concs.map((x) => x.chave));
  const pend = l.filter((x) => !ok.has(x.chave) && !x.transferencia_id && x.tipo !== 'TRANSFERENCIA');
  console.log(c.id, c.apelido, 'entradas', l.length, 'pendentes', pend.length, pend.reduce((s, x) => s + Number(x.valor), 0).toFixed(2));
  for (const x of pend) console.log(' ', x.data, x.valor, x.forma, '|', x.descricao, '|', x.memo, '|', x.contraparte_nome, '|', x.documento);
}
process.exit(0);
