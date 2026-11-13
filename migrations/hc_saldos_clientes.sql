-- ============================================================================
-- HEADCOACH › SALDOS DE CLIENTES: CREDEV e ADIANTAMENTO (Yago, 13/11/2026)
-- Saldo próprio do HeadCoach, por cliente + empresa + tipo, sem o TOTVS:
--   • carga inicial: os clientes com CREDEV (título tipo 20) ou adiantamento
--     (tipo 10) na empresa 99 em 2026, com o saldo que o TOTVS mostrava na
--     hora da carga (scripts/migrar-hc-saldos-clientes.mjs --carregar);
--   • uso: o Faturamento e o Faturamento Brejinho consomem o saldo (forma
--     "Credev" / "Adiantamento"); nota cancelada ou pedido refaturado devolve;
--   • devolução: devolução atendida do cliente soma ao CREDEV dele naquela
--     empresa (cancelada depois, sai de novo).
-- hc_cliente_saldos = saldo atual (uma linha por cliente+empresa+tipo, nunca
-- negativo); hc_cliente_saldos_mov = extrato (tudo o que entrou e saiu).
-- Toda mexida passa por hc_saldo_movimentar() (atômica: dois faturamentos ao
-- mesmo tempo não gastam o mesmo saldo). RLS ligado e sem política: só o
-- servidor acessa. Nada se apaga.
-- Rodar: node scripts/migrar-hc-saldos-clientes.mjs [--carregar]
-- ============================================================================

CREATE TABLE IF NOT EXISTS hc_cliente_saldos (
  empresa INT NOT NULL,
  cliente_code BIGINT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('credev', 'adiantamento')),
  cliente_nome TEXT,
  cliente_cpf_cnpj TEXT,
  valor_inicial NUMERIC(14, 2) NOT NULL DEFAULT 0,      -- o que veio do TOTVS na carga
  saldo NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (saldo >= 0),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa, cliente_code, tipo)
);
CREATE INDEX IF NOT EXISTS hc_cli_saldos_cliente ON hc_cliente_saldos (cliente_code);

CREATE TABLE IF NOT EXISTS hc_cliente_saldos_mov (
  id BIGSERIAL PRIMARY KEY,
  empresa INT NOT NULL,
  cliente_code BIGINT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('credev', 'adiantamento')),
  movimento TEXT NOT NULL CHECK (movimento IN ('carga_inicial', 'devolucao', 'devolucao_cancelada', 'uso', 'estorno', 'ajuste')),
  valor NUMERIC(14, 2) NOT NULL,                        -- + entra · − sai
  saldo_depois NUMERIC(14, 2) NOT NULL,
  venda_id BIGINT,                                      -- uso / estorno: a venda do faturamento
  devolucao_trx_id BIGINT,                              -- devolução: devolucoes_transacoes.id
  referencia TEXT,
  observacao TEXT,
  por TEXT,
  em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hc_cli_saldos_mov_cliente ON hc_cliente_saldos_mov (cliente_code, empresa, em DESC);
CREATE INDEX IF NOT EXISTS hc_cli_saldos_mov_venda ON hc_cliente_saldos_mov (venda_id) WHERE venda_id IS NOT NULL;
-- carga inicial uma vez por cliente+empresa+tipo; devolução creditada uma vez (e cancelada uma vez)
CREATE UNIQUE INDEX IF NOT EXISTS hc_cli_saldos_mov_carga ON hc_cliente_saldos_mov (empresa, cliente_code, tipo) WHERE movimento = 'carga_inicial';
CREATE UNIQUE INDEX IF NOT EXISTS hc_cli_saldos_mov_dev ON hc_cliente_saldos_mov (devolucao_trx_id, movimento) WHERE movimento IN ('devolucao', 'devolucao_cancelada');

-- movimenta o saldo (valor + entra, − sai) e grava no extrato; recusa deixar negativo
CREATE OR REPLACE FUNCTION hc_saldo_movimentar(
  p_empresa INT,
  p_cliente BIGINT,
  p_tipo TEXT,
  p_valor NUMERIC,
  p_movimento TEXT,
  p_venda BIGINT DEFAULT NULL,
  p_devolucao BIGINT DEFAULT NULL,
  p_referencia TEXT DEFAULT NULL,
  p_observacao TEXT DEFAULT NULL,
  p_por TEXT DEFAULT NULL,
  p_nome TEXT DEFAULT NULL,
  p_doc TEXT DEFAULT NULL
) RETURNS NUMERIC AS $$
DECLARE
  v_valor NUMERIC := round(p_valor, 2);
  v_saldo NUMERIC;
BEGIN
  IF p_tipo NOT IN ('credev', 'adiantamento') THEN
    RAISE EXCEPTION 'Tipo de saldo inválido: %', p_tipo;
  END IF;
  IF v_valor = 0 THEN
    RAISE EXCEPTION 'Valor zerado';
  END IF;
  INSERT INTO hc_cliente_saldos (empresa, cliente_code, tipo, cliente_nome, cliente_cpf_cnpj, saldo)
  VALUES (p_empresa, p_cliente, p_tipo, p_nome, p_doc, 0)
  ON CONFLICT (empresa, cliente_code, tipo) DO UPDATE
    SET cliente_nome = COALESCE(EXCLUDED.cliente_nome, hc_cliente_saldos.cliente_nome),
        cliente_cpf_cnpj = COALESCE(EXCLUDED.cliente_cpf_cnpj, hc_cliente_saldos.cliente_cpf_cnpj);
  UPDATE hc_cliente_saldos
     SET saldo = saldo + v_valor,
         valor_inicial = CASE WHEN p_movimento = 'carga_inicial' THEN v_valor ELSE valor_inicial END,
         atualizado_em = now()
   WHERE empresa = p_empresa AND cliente_code = p_cliente AND tipo = p_tipo AND saldo + v_valor >= 0
  RETURNING saldo INTO v_saldo;
  IF v_saldo IS NULL THEN
    SELECT saldo INTO v_saldo FROM hc_cliente_saldos WHERE empresa = p_empresa AND cliente_code = p_cliente AND tipo = p_tipo;
    RAISE EXCEPTION 'SALDO_INSUFICIENTE: o saldo de % do cliente % na empresa % é %', p_tipo, p_cliente, p_empresa, COALESCE(v_saldo, 0);
  END IF;
  INSERT INTO hc_cliente_saldos_mov (empresa, cliente_code, tipo, movimento, valor, saldo_depois, venda_id, devolucao_trx_id, referencia, observacao, por)
  VALUES (p_empresa, p_cliente, p_tipo, p_movimento, v_valor, v_saldo, p_venda, p_devolucao, p_referencia, p_observacao, p_por);
  RETURN v_saldo;
END;
$$ LANGUAGE plpgsql;

-- devolve ao cliente o que a venda gastou (nota cancelada, pedido faturado de novo)
CREATE OR REPLACE FUNCTION hc_saldo_estornar_venda(p_venda BIGINT, p_motivo TEXT DEFAULT NULL, p_por TEXT DEFAULT NULL)
RETURNS NUMERIC AS $$
DECLARE
  r RECORD;
  v_total NUMERIC := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(918273, p_venda::INT);
  FOR r IN
    SELECT empresa, cliente_code, tipo, SUM(valor) AS liquido
      FROM hc_cliente_saldos_mov
     WHERE venda_id = p_venda AND movimento IN ('uso', 'estorno')
     GROUP BY empresa, cliente_code, tipo
  LOOP
    IF r.liquido < 0 THEN
      PERFORM hc_saldo_movimentar(r.empresa, r.cliente_code, r.tipo, -r.liquido, 'estorno', p_venda, NULL, NULL, p_motivo, p_por);
      v_total := v_total - r.liquido;
    END IF;
  END LOOP;
  RETURN v_total;
END;
$$ LANGUAGE plpgsql;

-- nada de apagar
CREATE OR REPLACE FUNCTION hc_saldos_proibir_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Saldo de cliente não pode ser apagado (lance um ajuste)';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS hc_cli_saldos_sem_delete ON hc_cliente_saldos;
CREATE TRIGGER hc_cli_saldos_sem_delete BEFORE DELETE ON hc_cliente_saldos FOR EACH ROW EXECUTE FUNCTION hc_saldos_proibir_delete();
DROP TRIGGER IF EXISTS hc_cli_saldos_mov_sem_delete ON hc_cliente_saldos_mov;
CREATE TRIGGER hc_cli_saldos_mov_sem_delete BEFORE DELETE ON hc_cliente_saldos_mov FOR EACH ROW EXECUTE FUNCTION hc_saldos_proibir_delete();

ALTER TABLE hc_cliente_saldos ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_cliente_saldos_mov ENABLE ROW LEVEL SECURITY;
-- as funções só rodam pelo servidor (service role)
REVOKE EXECUTE ON FUNCTION hc_saldo_movimentar(INT, BIGINT, TEXT, NUMERIC, TEXT, BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION hc_saldo_estornar_venda(BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hc_saldo_movimentar(INT, BIGINT, TEXT, NUMERIC, TEXT, BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION hc_saldo_estornar_venda(BIGINT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
