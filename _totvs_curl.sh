#!/bin/bash
HOJE=$(date +%Y-%m-%d)
ANO=$(echo $HOJE | cut -c1-4)
MES=$(echo $HOJE | cut -c6-7)
declare -A PERIODOS=(
  ["mes-atual"]="$ANO-$MES-01 $HOJE"
  ["mes-passado"]="2026-05-01 2026-05-31"
  ["ano-atual"]="$ANO-01-01 $HOJE"
)
CANAIS=(varejo revenda multimarcas inbound_david inbound_rafael franquia business bazar showroom novidadesfranquia ricardoeletro)

for KEY in mes-atual mes-passado ano-atual; do
  IFS=' ' read -r DMIN DMAX <<< "${PERIODOS[$KEY]}"
  echo ""
  echo "=== $KEY ($DMIN → $DMAX) ==="
  for C in "${CANAIS[@]}"; do
    printf "  %-22s " "$C"
    T0=$(date +%s)
    RESP=$(curl -sS -m 300 -X POST "http://localhost:4100/api/crm/canal-totals?lite=true" \
      -H "Content-Type: application/json" \
      -d "{\"datemin\":\"$DMIN\",\"datemax\":\"$DMAX\",\"modulo\":\"$C\",\"lite\":true}" 2>&1)
    DT=$(( $(date +%s) - T0 ))
    VAL=$(echo "$RESP" | grep -oE '"invoice_value":[0-9.]+' | head -1 | cut -d: -f2)
    if [ -n "$VAL" ]; then
      printf "R\$ %15.2f  (%ds)\n" "$VAL" "$DT"
    else
      printf "❌ falhou  (%ds)\n" "$DT"
    fi
  done
done
