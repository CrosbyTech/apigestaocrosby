// Backfill: vincula os chamados de NF já abertos no Dryland às solicitações
// de pagamento (solicitacoes_crosby.nf_chamado_dryland_*), lendo o
// "Solicitação HeadCoach: #uuid" do texto do chamado. Só preenche onde está
// vazio; nunca apaga nada e não mexe no Dryland. Lista duplicatas para a
// Niziany cancelar à mão. (Jojo, 27/10/2026)
import 'dotenv/config';
import supabase from '../config/supabase.js';
import { chamadosAbertosDeNota } from '../services/sefazChamados.js';

const chamados = await chamadosAbertosDeNota({ forcar: true });
const comSol = chamados.filter((c) => c.sol);
const porSol = new Map();
for (const c of comSol) {
  if (!porSol.has(c.sol)) porSol.set(c.sol, []);
  porSol.get(c.sol).push(c);
}
let vinculadas = 0;
let jaTinham = 0;
let naoEncontradas = 0;
const duplicados = [];
for (const [solId, lista] of porSol) {
  lista.sort((a, b) => (a.id || 0) - (b.id || 0));
  const principal = lista[0]; // o mais antigo fica como oficial
  if (lista.length > 1) duplicados.push({ solicitacao: solId, chamados: lista.map((c) => `#${c.numero}`) });
  const { data: sol, error } = await supabase
    .from('solicitacoes_crosby')
    .select('id, nf_chamado_dryland_id')
    .eq('id', solId)
    .maybeSingle();
  if (error) throw error;
  if (!sol) {
    naoEncontradas++;
    continue;
  }
  if (sol.nf_chamado_dryland_id) {
    jaTinham++;
    continue;
  }
  const { error: e2 } = await supabase
    .from('solicitacoes_crosby')
    .update({
      nf_chamado_dryland_id: principal.id,
      nf_chamado_dryland_numero: principal.numero ?? null,
      nf_chamado_aberto_em: principal.criado_em || new Date().toISOString(),
    })
    .eq('id', solId);
  if (e2) throw e2;
  vinculadas++;
}
console.log(
  JSON.stringify(
    { chamadosAbertosDeNota: chamados.length, comSolicitacao: comSol.length, solicitacoesDistintas: porSol.size, vinculadas, jaTinham, naoEncontradas, duplicados },
    null,
    2,
  ),
);
