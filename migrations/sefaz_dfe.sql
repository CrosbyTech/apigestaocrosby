-- Notas fiscais destinadas aos CNPJs próprios, capturadas via SEFAZ Distribuição DFe
create table if not exists sefaz_dfe_notas (
  id bigint generated always as identity primary key,
  cnpj_destinatario text not null,
  chave_acesso text not null,
  nsu bigint,
  emitente_cnpj text,
  emitente_nome text,
  emitente_ie text,
  data_emissao timestamptz,
  tipo_operacao text,          -- tpNF: '0' = Entrada, '1' = Saída (na ótica do emitente)
  valor_total numeric(15,2),
  situacao text,               -- cSitNFe: '1' = Autorizada, '2' = Cancelada, '3' = Denegada
  manifestacao text,           -- tpEvento do último evento de manifestação (ex.: 210210)
  manifestacao_descricao text,
  schema_origem text,          -- resNFe / procNFe
  xml_completo boolean default false,
  xml text,
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now(),
  unique (cnpj_destinatario, chave_acesso)
);

create index if not exists idx_sefaz_dfe_notas_dt
  on sefaz_dfe_notas (cnpj_destinatario, data_emissao);

-- Controle de NSU por CNPJ (consulta incremental na SEFAZ)
create table if not exists sefaz_dfe_controle (
  cnpj text primary key,
  descricao text,
  ult_nsu bigint default 0,
  max_nsu bigint default 0,
  ultima_consulta timestamptz,
  ultimo_cstat text,
  ultimo_xmotivo text,
  bloqueado_ate timestamptz,
  atualizado_em timestamptz default now()
);
