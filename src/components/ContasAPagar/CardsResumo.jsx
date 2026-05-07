import React, { useMemo } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/cards';
import {
  Receipt,
  CurrencyDollar,
  Clock,
  Warning,
  CheckCircle,
  ArrowUp,
  ArrowDown,
  TrendDown,
  Spinner,
} from '@phosphor-icons/react';
import { criarDataSemFusoHorario, getStatusFromData } from './utils';

const CardsResumo = React.memo(
  ({ dadosOrdenadosParaCards, loading, abrirModalCard }) => {
    // Memoizar TODOS os cálculos dos cards
    const cardData = useMemo(() => {
      const totalContas = dadosOrdenadosParaCards.length;
      const totalValor = dadosOrdenadosParaCards.reduce(
        (acc, grupo) => acc + parseFloat(grupo.item.vl_duplicata || 0),
        0,
      );

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      let totalContasVencidas = 0;
      let valorContasVencidas = 0;
      let totalContasAVencer = 0;
      let valorContasAVencer = 0;
      let totalContasProximasVencer = 0;
      let valorContasProximasVencer = 0;
      let totalPagas = 0;
      let valorPagas = 0;
      let totalDescontos = 0;
      let contasComDesconto = 0;

      for (let i = 0; i < dadosOrdenadosParaCards.length; i++) {
        const grupo = dadosOrdenadosParaCards[i];
        const item = grupo.item;
        const status = getStatusFromData(item);
        const vlDuplicata = parseFloat(item.vl_duplicata || 0);
        const vlDesconto = parseFloat(item.vl_desconto || 0);

        if (status === 'Vencido') {
          totalContasVencidas++;
          valorContasVencidas += vlDuplicata;
        }
        if (status === 'A Vencer' || status === 'Próxima a Vencer') {
          totalContasAVencer++;
          valorContasAVencer += vlDuplicata;
        }
        if (item.dt_vencimento && !item.dt_liq) {
          const dataVencimento = criarDataSemFusoHorario(item.dt_vencimento);
          const diasParaVencer = Math.ceil(
            (dataVencimento - hoje) / (1000 * 60 * 60 * 24),
          );
          if (diasParaVencer >= 0 && diasParaVencer <= 7) {
            totalContasProximasVencer++;
            valorContasProximasVencer += vlDuplicata;
          }
        }
        if (status === 'Pago') {
          totalPagas++;
          valorPagas += parseFloat(item.vl_pago || 0);
        }
        if (vlDesconto > 0) {
          totalDescontos += vlDesconto;
          contasComDesconto++;
        }
      }

      return {
        totalContas,
        totalValor,
        totalContasVencidas,
        valorContasVencidas,
        totalContasAVencer,
        valorContasAVencer,
        totalContasProximasVencer,
        valorContasProximasVencer,
        totalPagas,
        valorPagas,
        valorFaltaPagar: totalValor - valorPagas,
        totalDescontos,
        contasComDesconto,
      };
    }, [dadosOrdenadosParaCards]);

    const fmt = (v) =>
      v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const cards = [
      {
        title: 'Total de Contas',
        icon: Receipt,
        color: 'blue',
        value: cardData.totalContas,
        isCurrency: false,
        subtitle: 'Contas no período',
      },
      {
        title: 'Valor Total',
        icon: CurrencyDollar,
        color: 'green',
        value: cardData.totalValor,
        isCurrency: true,
        subtitle: 'Valor total das contas',
      },
      {
        title: 'Falta Pagar',
        icon: ArrowDown,
        color: 'purple',
        value: cardData.valorFaltaPagar,
        isCurrency: true,
        count: `${cardData.totalContas - cardData.totalPagas} contas`,
        subtitle: 'Contas pendentes',
        onClick: () => abrirModalCard('faltaPagar'),
      },
      {
        title: 'Contas Vencidas',
        icon: Warning,
        color: 'red',
        value: cardData.valorContasVencidas,
        isCurrency: true,
        count: `${cardData.totalContasVencidas} contas`,
        subtitle: 'Contas em atraso',
        onClick: () => abrirModalCard('vencidas'),
      },
      {
        title: 'A Vencer',
        icon: Clock,
        color: 'yellow',
        value: cardData.valorContasAVencer,
        isCurrency: true,
        count: `${cardData.totalContasAVencer} contas`,
        subtitle: 'Contas futuras',
        onClick: () => abrirModalCard('aVencer'),
      },
      {
        title: 'Próximas a Vencer',
        icon: ArrowUp,
        color: 'orange',
        value: cardData.valorContasProximasVencer,
        isCurrency: true,
        count: `${cardData.totalContasProximasVencer} contas`,
        subtitle: 'Próximos 7 dias',
        onClick: () => abrirModalCard('proximasVencer'),
      },
      {
        title: 'Contas Pagas',
        icon: CheckCircle,
        color: 'green',
        value: cardData.valorPagas,
        isCurrency: true,
        count: `${cardData.totalPagas} contas`,
        subtitle: 'Contas liquidadas',
        onClick: () => abrirModalCard('pagas'),
      },
      {
        title: 'Descontos Ganhos',
        icon: TrendDown,
        color: 'emerald',
        value: cardData.totalDescontos,
        isCurrency: true,
        count: `${cardData.contasComDesconto} contas`,
        subtitle: 'Total de descontos obtidos',
        onClick: () => abrirModalCard('descontos'),
      },
    ];

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8 max-w-7xl mx-auto">
        {cards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <Card
              key={idx}
              className={`shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white ${
                card.onClick ? 'cursor-pointer' : ''
              }`}
              onClick={card.onClick}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Icon size={18} className={`text-${card.color}-600`} />
                  <CardTitle
                    className={`text-sm font-bold text-${card.color}-700`}
                  >
                    {card.title}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div
                  className={`text-base font-extrabold text-${card.color}-600 mb-0.5 break-words`}
                >
                  {loading ? (
                    <Spinner
                      size={24}
                      className={`animate-spin text-${card.color}-600`}
                    />
                  ) : card.isCurrency ? (
                    fmt(card.value)
                  ) : (
                    card.value
                  )}
                </div>
                {card.count && (
                  <div
                    className={`text-base font-medium text-${card.color}-500`}
                  >
                    {loading ? '...' : card.count}
                  </div>
                )}
                <CardDescription className="text-xs text-gray-500">
                  {card.subtitle}
                </CardDescription>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  },
);

CardsResumo.displayName = 'CardsResumo';

export default CardsResumo;
