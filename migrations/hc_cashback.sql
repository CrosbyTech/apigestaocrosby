-- ============================================================================
-- CASHBACK DO HEADCOACH (Yago, 18/11/2026)
--
-- O cashback NOVO passa a nascer e ser usado no HeadCoach (antes ia para o
-- "saldo bônus" do TOTVS, sem histórico aqui). Regras:
--   • a venda do PDV Crosby gera 20% do valor para o cliente identificado;
--   • CARÊNCIA de 3 dias: gerado no dia 0, pode ser usado a partir do dia 3;
--   • VALIDADE de 90 dias de uso: vale até o dia 93; depois disso não conta mais
--     no saldo, mas o registro FICA (o Yago pode reativar o cashback vencido);
--   • vale em qualquer loja;
--   • histórico completo: cada geração é um LOTE (hc_cashback_lotes) e cada
--     geração, uso, estorno, cancelamento e reativação é uma linha do extrato
--     (hc_cashback_mov), com a venda que gerou ou usou.
-- O saldo antigo que já está no TOTVS continua lá e é baixado lá até acabar
-- (a cópia diária dele segue em hc_cliente_saldos, tipo 'cashback').
--
-- Toda mexida passa pelas funções abaixo (atômicas: duas vendas ao mesmo tempo
-- não gastam o mesmo cashback). RLS ligado e sem política: só o servidor acessa.
-- Nada se apaga. Rodar: node scripts/migrar-hc-cashback.mjs
-- ============================================================================

CREATE TABLE IF NOT EXISTS hc_cashback_lotes (
  id BIGSERIAL PRIMARY KEY,
  cliente_code BIGINT NOT NULL,
  cliente_nome TEXT,
  cliente_cpf_cnpj TEXT,
  empresa INT NOT NULL,                                 -- loja onde foi gerado
  origem TEXT NOT NULL DEFAULT 'venda' CHECK (origem IN ('venda', 'ajuste')),
  venda_id BIGINT,                                      -- pdv_vendas.id que gerou
  base NUMERIC(14, 2),                                  -- valor da venda
  pct NUMERIC(6, 2),                                    -- % aplicado
  valor NUMERIC(14, 2) NOT NULL CHECK (valor > 0),      -- cashback gerado
  usado NUMERIC(14, 2) NOT NULL DEFAULT 0,              -- quanto já foi usado
  gerado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  libera_em DATE NOT NULL,                              -- 1º dia em que pode usar
  expira_em DATE NOT NULL,                              -- último dia em que pode usar
  cancelado_em TIMESTAMPTZ,                             -- a venda que gerou foi cancelada
  cancelado_motivo TEXT,
  reativado_em TIMESTAMPTZ,                             -- última reativação
  reativado_por TEXT,
  observacao TEXT,
  por TEXT,
  CONSTRAINT hc_cashback_lotes_usado CHECK (usado >= 0 AND usado <= valor)
);
-- saldo do lote (valor - usado), para filtrar direto na consulta
ALTER TABLE hc_cashback_lotes ADD COLUMN IF NOT EXISTS saldo NUMERIC(14,2) GENERATED ALWAYS AS (valor - usado) STORED;
CREATE UNIQUE INDEX IF NOT EXISTS hc_cashback_lotes_venda ON hc_cashback_lotes (venda_id) WHERE venda_id IS NOT NULL AND origem = 'venda';
CREATE INDEX IF NOT EXISTS hc_cashback_lotes_cliente ON hc_cashback_lotes (cliente_code, expira_em);
CREATE INDEX IF NOT EXISTS hc_cashback_lotes_cpf ON hc_cashback_lotes (cliente_cpf_cnpj) WHERE cliente_cpf_cnpj IS NOT NULL;
CREATE INDEX IF NOT EXISTS hc_cashback_lotes_expira ON hc_cashback_lotes (expira_em);

CREATE TABLE IF NOT EXISTS hc_cashback_mov (
  id BIGSERIAL PRIMARY KEY,
  lote_id BIGINT NOT NULL REFERENCES hc_cashback_lotes (id),
  cliente_code BIGINT NOT NULL,
  empresa INT,                                          -- loja onde aconteceu (uso: a que vendeu)
  movimento TEXT NOT NULL CHECK (movimento IN ('geracao', 'uso', 'estorno_uso', 'cancelamento', 'reativacao')),
  valor NUMERIC(14, 2) NOT NULL,                        -- + entra · − sai · reativação: o saldo que voltou a valer
  venda_id BIGINT,                                      -- venda que gerou / usou
  observacao TEXT,
  por TEXT,
  em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hc_cashback_mov_cliente ON hc_cashback_mov (cliente_code, em DESC);
CREATE INDEX IF NOT EXISTS hc_cashback_mov_venda ON hc_cashback_mov (venda_id) WHERE venda_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hc_cashback_mov_lote ON hc_cashback_mov (lote_id);

ALTER TABLE hc_cashback_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_cashback_mov ENABLE ROW LEVEL SECURITY;

-- Gera o cashback de uma venda (um lote por venda: chamar de novo não duplica).
-- Devolve o id do lote.
CREATE OR REPLACE FUNCTION hc_cashback_gerar(
  p_cliente BIGINT,
  p_empresa INT,
  p_venda BIGINT,
  p_base NUMERIC,
  p_pct NUMERIC,
  p_valor NUMERIC,
  p_libera DATE,
  p_expira DATE,
  p_nome TEXT DEFAULT NULL,
  p_doc TEXT DEFAULT NULL,
  p_por TEXT DEFAULT NULL,
  p_observacao TEXT DEFAULT NULL,
  p_origem TEXT DEFAULT 'venda'
) RETURNS BIGINT AS $$
DECLARE
  v_valor NUMERIC := round(p_valor, 2);
  v_id BIGINT;
BEGIN
  IF v_valor <= 0 THEN
    RAISE EXCEPTION 'Cashback zerado';
  END IF;
  IF p_venda IS NOT NULL AND p_origem = 'venda' THEN
    SELECT id INTO v_id FROM hc_cashback_lotes WHERE venda_id = p_venda AND origem = 'venda';
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;
  INSERT INTO hc_cashback_lotes (cliente_code, cliente_nome, cliente_cpf_cnpj, empresa, origem, venda_id, base, pct, valor, libera_em, expira_em, observacao, por)
  VALUES (p_cliente, p_nome, p_doc, p_empresa, p_origem, p_venda, p_base, p_pct, v_valor, p_libera, p_expira, p_observacao, p_por)
  RETURNING id INTO v_id;
  INSERT INTO hc_cashback_mov (lote_id, cliente_code, empresa, movimento, valor, venda_id, observacao, por)
  VALUES (v_id, p_cliente, p_empresa, 'geracao', v_valor, p_venda, p_observacao, p_por);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Usa o cashback do cliente numa venda: sai primeiro do lote que vence antes.
-- Só conta lote liberado (fora da carência), dentro da validade e não cancelado.
-- Recusa (exceção) se o saldo disponível não cobre. Devolve o valor usado.
CREATE OR REPLACE FUNCTION hc_cashback_usar(
  p_cliente BIGINT,
  p_valor NUMERIC,
  p_venda BIGINT DEFAULT NULL,
  p_empresa INT DEFAULT NULL,
  p_por TEXT DEFAULT NULL,
  p_observacao TEXT DEFAULT NULL
) RETURNS NUMERIC AS $$
DECLARE
  v_falta NUMERIC := round(p_valor, 2);
  v_hoje DATE := (now() AT TIME ZONE 'America/Recife')::date;
  v_disp NUMERIC;
  v_usa NUMERIC;
  r RECORD;
BEGIN
  IF v_falta <= 0 THEN
    RAISE EXCEPTION 'Valor zerado';
  END IF;
  SELECT COALESCE(sum(valor - usado), 0) INTO v_disp
    FROM hc_cashback_lotes
   WHERE cliente_code = p_cliente AND cancelado_em IS NULL AND libera_em <= v_hoje AND expira_em >= v_hoje AND usado < valor;
  IF v_disp + 0.005 < v_falta THEN
    RAISE EXCEPTION 'CASHBACK_INSUFICIENTE: disponível % e a venda usou %', v_disp, v_falta;
  END IF;
  FOR r IN
    SELECT id, valor, usado FROM hc_cashback_lotes
     WHERE cliente_code = p_cliente AND cancelado_em IS NULL AND libera_em <= v_hoje AND expira_em >= v_hoje AND usado < valor
     ORDER BY expira_em, id
     FOR UPDATE
  LOOP
    EXIT WHEN v_falta <= 0;
    v_usa := LEAST(v_falta, r.valor - r.usado);
    IF v_usa > 0 THEN
      UPDATE hc_cashback_lotes SET usado = usado + v_usa WHERE id = r.id;
      INSERT INTO hc_cashback_mov (lote_id, cliente_code, empresa, movimento, valor, venda_id, observacao, por)
      VALUES (r.id, p_cliente, p_empresa, 'uso', -v_usa, p_venda, p_observacao, p_por);
      v_falta := v_falta - v_usa;
    END IF;
  END LOOP;
  IF v_falta > 0.005 THEN
    RAISE EXCEPTION 'CASHBACK_INSUFICIENTE: faltaram % (outra venda usou o saldo ao mesmo tempo)', v_falta;
  END IF;
  RETURN round(p_valor, 2);
END;
$$ LANGUAGE plpgsql;

-- Venda cancelada: devolve aos lotes o cashback que ela usou e cancela o lote
-- que ela gerou (o que ainda não tinha sido usado). Pode ser chamada de novo.
-- Devolve { "devolvido": x, "cancelado": y }.
CREATE OR REPLACE FUNCTION hc_cashback_estornar_venda(
  p_venda BIGINT,
  p_motivo TEXT DEFAULT NULL,
  p_por TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_devolvido NUMERIC := 0;
  v_cancelado NUMERIC := 0;
  v_volta NUMERIC;
  r RECORD;
  l RECORD;
BEGIN
  FOR r IN
    SELECT m.lote_id, m.cliente_code, max(m.empresa) AS empresa, -sum(m.valor) AS liquido
      FROM hc_cashback_mov m
     WHERE m.venda_id = p_venda AND m.movimento IN ('uso', 'estorno_uso')
     GROUP BY m.lote_id, m.cliente_code
    HAVING -sum(m.valor) > 0.005
  LOOP
    SELECT id, usado INTO l FROM hc_cashback_lotes WHERE id = r.lote_id FOR UPDATE;
    v_volta := LEAST(r.liquido, l.usado);
    IF v_volta > 0 THEN
      UPDATE hc_cashback_lotes SET usado = usado - v_volta WHERE id = r.lote_id;
      INSERT INTO hc_cashback_mov (lote_id, cliente_code, empresa, movimento, valor, venda_id, observacao, por)
      VALUES (r.lote_id, r.cliente_code, r.empresa, 'estorno_uso', v_volta, p_venda, COALESCE(p_motivo, 'Venda cancelada'), p_por);
      v_devolvido := v_devolvido + v_volta;
    END IF;
  END LOOP;
  FOR l IN
    SELECT id, cliente_code, empresa, valor, usado FROM hc_cashback_lotes
     WHERE venda_id = p_venda AND origem = 'venda' AND cancelado_em IS NULL
     FOR UPDATE
  LOOP
    UPDATE hc_cashback_lotes SET cancelado_em = now(), cancelado_motivo = COALESCE(p_motivo, 'Venda cancelada') WHERE id = l.id;
    INSERT INTO hc_cashback_mov (lote_id, cliente_code, empresa, movimento, valor, venda_id, observacao, por)
    VALUES (l.id, l.cliente_code, l.empresa, 'cancelamento', -(l.valor - l.usado), p_venda, COALESCE(p_motivo, 'Venda cancelada'), p_por);
    v_cancelado := v_cancelado + (l.valor - l.usado);
  END LOOP;
  RETURN json_build_object('devolvido', round(v_devolvido, 2), 'cancelado', round(v_cancelado, 2));
END;
$$ LANGUAGE plpgsql;

-- Reativa um lote (vencido ou não): passa a valer até p_expira e sai da
-- carência. Só lote não cancelado e com saldo. Devolve o saldo reativado.
CREATE OR REPLACE FUNCTION hc_cashback_reativar(
  p_lote BIGINT,
  p_expira DATE,
  p_por TEXT DEFAULT NULL,
  p_observacao TEXT DEFAULT NULL
) RETURNS NUMERIC AS $$
DECLARE
  v_hoje DATE := (now() AT TIME ZONE 'America/Recife')::date;
  l RECORD;
BEGIN
  SELECT id, cliente_code, empresa, valor, usado, cancelado_em INTO l FROM hc_cashback_lotes WHERE id = p_lote FOR UPDATE;
  IF l.id IS NULL THEN
    RAISE EXCEPTION 'Lote de cashback % não encontrado', p_lote;
  END IF;
  IF l.cancelado_em IS NOT NULL THEN
    RAISE EXCEPTION 'O cashback % foi cancelado com a venda e não pode ser reativado', p_lote;
  END IF;
  IF l.valor - l.usado <= 0 THEN
    RAISE EXCEPTION 'O cashback % já foi todo usado', p_lote;
  END IF;
  IF p_expira < v_hoje THEN
    RAISE EXCEPTION 'A nova validade tem que ser de hoje em diante';
  END IF;
  UPDATE hc_cashback_lotes
     SET expira_em = p_expira, libera_em = LEAST(libera_em, v_hoje), reativado_em = now(), reativado_por = p_por
   WHERE id = p_lote;
  INSERT INTO hc_cashback_mov (lote_id, cliente_code, empresa, movimento, valor, observacao, por)
  VALUES (p_lote, l.cliente_code, l.empresa, 'reativacao', l.valor - l.usado, COALESCE(p_observacao, 'Cashback reativado'), p_por);
  RETURN l.valor - l.usado;
END;
$$ LANGUAGE plpgsql;
