import React, { memo, Suspense, lazy, useState, useCallback } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Outlet,
} from 'react-router-dom';
import LoginForm from './components/LoginForm';
import PrivateRoute from './components/PrivateRoute';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorBoundary from './components/ui/ErrorBoundary';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
// Lazy loading de todas as páginas para otimizar bundle
const Home = lazy(() => import('./pages/Home'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const BIExterno = lazy(() => import('./pages/BIExterno'));
const ContasAPagar = lazy(() => import('./pages/ContasAPagar'));
const Emprestimos = lazy(() => import('./pages/Emprestimos'));
const DespesaFilial = lazy(() => import('./pages/DespesaFilial'));
const LiberacaoPagamento = lazy(() => import('./pages/LiberacaoPagamento'));
const ContasAReceber = lazy(() => import('./pages/ContasAReceber'));
const BatidaCarteira = lazy(() => import('./pages/BatidaCarteira'));
const ContasPagarFranquias = lazy(() => import('./pages/ContasPagarFranquias'));
const TitulosClientes = lazy(() => import('./pages/TitulosClientes'));
const SolicitacaoCredito = lazy(() => import('./pages/SolicitacaoCredito'));
const AnaliseCredito = lazy(() => import('./pages/AnaliseCredito'));
const RenegociacaoDividas = lazy(() => import('./pages/RenegociacaoDividas'));
const AnaliseRenegociacao = lazy(() => import('./pages/AnaliseRenegociacao'));
const NotasFiscais = lazy(() => import('./pages/NotasFiscais'));
const ExtratoCredito = lazy(() => import('./pages/ExtratoCredito'));

const MetasVarejo = lazy(() => import('./pages/MetasVarejo'));

const RankingFaturamento = lazy(() => import('./pages/RankingFaturamento'));
const ComprasFranquias = lazy(() => import('./pages/ComprasFranquias'));
const Credev = lazy(() => import('./pages/Credev'));
const CreditoFranquia = lazy(() => import('./pages/CreditoFranquia'));
const CreditosClientes = lazy(() => import('./pages/CreditosClientes'));
const CredevRevenda = lazy(() => import('./pages/CredevRevenda'));
const CredevVarejo = lazy(() => import('./pages/CredevVarejo'));
const CredevMultimarcas = lazy(() => import('./pages/CredevMultimarcas'));
const PainelAdmin = lazy(() => import('./pages/PainelAdmin'));
const UserPanel = lazy(() => import('./pages/UserPanel'));
const ExtratosBancos = lazy(() => import('./pages/ExtratosBancos'));
const AuthTest = lazy(() => import('./components/AuthTest'));
const PMR = lazy(() => import('./pages/DashboardPMR'));
const DashContasAReceber = lazy(() => import('./pages/DashContasAReceber'));
const DashInadimplencia = lazy(() => import('./pages/DashInadimplencia'));
const CMVConsolidado = lazy(() => import('./pages/CMVConsolidado'));
const CMVMultimarcas = lazy(() => import('./pages/CMVMultimarcas'));
const CMVRevenda = lazy(() => import('./pages/CMVRevenda'));
const CMVFranquia = lazy(() => import('./pages/CMVFranquia'));
const DashboardVarejo = lazy(() => import('./pages/DashboardVarejo'));
const DashboardMultimarcas = lazy(() => import('./pages/DashboardMultimarcas'));
const DashboardFranquias = lazy(() => import('./pages/DashboardFranquias'));
const DashboardRevenda = lazy(() => import('./pages/DashboardRevenda'));
const CrosbyBot = lazy(() => import('./pages/CrosbyBot'));
const InadimplentesMultimarcas = lazy(
  () => import('./pages/InadimplentesMultimarcas'),
);
const InadimplentesRevenda = lazy(() => import('./pages/InadimplentesRevenda'));
const InadimplentesFranquias = lazy(
  () => import('./pages/InadimplentesFranquias'),
);
const RecuperacaoCredito = lazy(() => import('./pages/RecuperacaoCredito'));
const CMVVarejo = lazy(() => import('./pages/CMVVarejo'));
const DRE = lazy(() => import('./pages/DRE'));
const GerenciadorDashboards = lazy(
  () => import('./pages/GerenciadorDashboards'),
);
const GerenciadorAcessos = lazy(() => import('./pages/GerenciadorAcessos'));
const GerenciadorAvisos = lazy(() => import('./pages/GerenciadorAvisos'));
const Widgets = lazy(() => import('./pages/Widgets'));
const ConsultaCliente = lazy(() => import('./pages/ConsultaCliente'));
const ClientesTotvs = lazy(() => import('./pages/ClientesTotvs'));
const SolicitacaoBaixa = lazy(() => import('./pages/SolicitacaoBaixa'));
const MinhasSolicitacoesBaixa = lazy(
  () => import('./pages/MinhasSolicitacoesBaixa'),
);
const FaturasClientesAntecipacao = lazy(
  () => import('./pages/FaturasClientesConfianca'),
);
const NotasFiscaisClientesAntecipacao = lazy(
  () => import('./pages/NotasFiscaisClientesConfianca'),
);
const ComprovantesAntecipacao = lazy(
  () => import('./pages/ComprovantesConfianca'),
);
const ClientesAntecipacao = lazy(() => import('./pages/ClientesConfianca'));
const LicitacaoTitulos = lazy(() => import('./pages/LicitacaoTitulos'));
const SolicitacoesRemessa = lazy(() => import('./pages/SolicitacoesRemessa'));
const MinhasRemessas = lazy(() => import('./pages/MinhasRemessas'));
const ClientesMTM = lazy(() => import('./pages/ClientesMTM'));
const DownloadNotificacao = lazy(() => import('./pages/DownloadNotificacao'));
const ApiClaude = lazy(() => import('./pages/ApiClaude'));
const Estoque = lazy(() => import('./pages/Estoque'));
const PainelVendas = lazy(() => import('./pages/PainelVendas'));
const CRMVendas = lazy(() => import('./pages/CRMVendas'));
const FaturamentoCanal = lazy(() => import('./pages/FaturamentoCanal'));
const VoucherUsage = lazy(() => import('./pages/VoucherUsage'));
const CatalogoAdmin = lazy(() => import('./pages/CatalogoAdmin'));
const CrosbyManage = lazy(() => import('./pages/CrosbyManage'));
const ExtratoTotvs = lazy(() => import('./pages/ExtratoTotvs'));
const TopClientes = lazy(() => import('./pages/TopClientes'));
const DocumentoBluecred = lazy(() => import('./pages/DocumentoBluecred'));
const ClientesBluecred = lazy(() => import('./pages/ClientesBluecred'));
const ConsultaNFs = lazy(() => import('./pages/ConsultaNFs'));
const FaturamentoPanel = lazy(() => import('./components/FaturamentoPanel'));
const AtividadeClientes = lazy(() => import('./pages/AtividadeClientes'));

// Componente de fallback para loading
const PageLoadingFallback = memo(() => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <LoadingSpinner size="lg" text="Carregando página..." />
  </div>
));

PageLoadingFallback.displayName = 'PageLoadingFallback';

// Lista de rotas protegidas (constante estática no módulo)
const protectedRoutes = [
  { path: '/gerenciador-dashboards', component: GerenciadorDashboards },
  { path: '/widgets', component: Widgets },

  { path: '/dash-contas-a-receber', component: DashContasAReceber },
  { path: '/dash-inadimplencia', component: DashInadimplencia },
  { path: '/pmr', component: PMR },
  { path: '/home', component: Home },
  { path: '/dashboard', component: Dashboard },
  { path: '/bi-externo', component: BIExterno },
  { path: '/contas-a-pagar', component: ContasAPagar },
  { path: '/emprestimos', component: Emprestimos },
  { path: '/despesa-filial', component: DespesaFilial },
  { path: '/liberacao-pagamento', component: LiberacaoPagamento },
  { path: '/contas-a-receber', component: ContasAReceber },
  { path: '/batida-carteira', component: BatidaCarteira },
  { path: '/contas-pagar-franquias', component: ContasPagarFranquias },
  { path: '/titulos-clientes', component: TitulosClientes },
  { path: '/solicitacao-credito', component: SolicitacaoCredito },
  { path: '/analise-credito', component: AnaliseCredito },
  { path: '/renegociacao-dividas', component: RenegociacaoDividas },
  { path: '/analise-renegociacao', component: AnaliseRenegociacao },
  { path: '/notas-fiscais', component: NotasFiscais },
  { path: '/consulta-nfs', component: ConsultaNFs },
  { path: '/atividade-clientes', component: AtividadeClientes },
  { path: '/extratos-bancos', component: ExtratosBancos },
  { path: '/extrato-credito', component: ExtratoCredito },
  { path: '/metas-varejo', component: MetasVarejo },
  { path: '/ranking-faturamento', component: RankingFaturamento },
  { path: '/cmv-consolidado', component: CMVConsolidado },
  { path: '/cmv-multimarcas', component: CMVMultimarcas },
  { path: '/cmv-revenda', component: CMVRevenda },
  { path: '/cmv-franquia', component: CMVFranquia },
  { path: '/cmv-varejo', component: CMVVarejo },
  { path: '/dre', component: DRE },
  { path: '/compras-franquias', component: ComprasFranquias },
  { path: '/credev', component: Credev },
  { path: '/credito-franquia', component: CreditoFranquia },
  { path: '/credev-revenda', component: CredevRevenda },
  { path: '/credev-varejo', component: CredevVarejo },
  { path: '/credev-multimarcas', component: CredevMultimarcas },
  { path: '/inadimplentes-multimarcas', component: InadimplentesMultimarcas },
  { path: '/inadimplentes-revenda', component: InadimplentesRevenda },
  { path: '/inadimplentes-franquias', component: InadimplentesFranquias },
  { path: '/recuperacao-credito', component: RecuperacaoCredito },
  { path: '/dashboard-varejo', component: DashboardVarejo },
  { path: '/dashboard-multimarcas', component: DashboardMultimarcas },
  { path: '/dashboard-franquias', component: DashboardFranquias },
  { path: '/dashboard-revenda', component: DashboardRevenda },
  { path: '/crosby-bot', component: CrosbyBot },
  { path: '/painel-admin', component: PainelAdmin },
  { path: '/gerenciador-acessos', component: GerenciadorAcessos },
  { path: '/gerenciador-avisos', component: GerenciadorAvisos },
  { path: '/user-panel', component: UserPanel },
  { path: '/auth-test', component: AuthTest },
  { path: '/consulta-cliente', component: ConsultaCliente },
  { path: '/clientes-totvs', component: ClientesTotvs },
  { path: '/creditos-clientes', component: CreditosClientes },
  { path: '/top-clientes', component: TopClientes },
  { path: '/documento-bluecred', component: DocumentoBluecred },
  { path: '/clientes-bluecred', component: ClientesBluecred },
  { path: '/solicitacao-baixa', component: SolicitacaoBaixa },
  { path: '/minhas-solicitacoes-baixa', component: MinhasSolicitacoesBaixa },
  {
    path: '/faturas-clientes-antecipacao',
    component: FaturasClientesAntecipacao,
  },
  {
    path: '/nf-clientes-antecipacao',
    component: NotasFiscaisClientesAntecipacao,
  },
  { path: '/comprovantes-antecipacao', component: ComprovantesAntecipacao },
  { path: '/clientes-antecipacao', component: ClientesAntecipacao },
  { path: '/licitacao-titulos', component: LicitacaoTitulos },
  { path: '/solicitacoes-remessa', component: SolicitacoesRemessa },
  { path: '/minhas-remessas', component: MinhasRemessas },
  { path: '/clientes-mtm', component: ClientesMTM },
  { path: '/api-claude', component: ApiClaude },
  { path: '/estoque', component: Estoque },
  { path: '/painel-vendas', component: PainelVendas },
  { path: '/crm-vendas', component: CRMVendas },
  { path: '/faturamento-canal', component: FaturamentoCanal },
  { path: '/totvs', component: FaturamentoPanel },
  { path: '/voucher-usage', component: VoucherUsage },
  { path: '/catalogo-admin', component: CatalogoAdmin },
  { path: '/crosby-manage', component: CrosbyManage },
  { path: '/extrato-totvs', component: ExtratoTotvs },
];

// Layout compartilhado - estável, preserva estado das páginas ao interagir com sidebar
const ProtectedLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const handleToggleSidebar = useCallback(() => setSidebarOpen((o) => !o), []);
  const handleCloseSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <div className="h-screen ">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={handleCloseSidebar}
        onToggle={handleToggleSidebar}
      />
      <div className="flex-1 flex flex-col w-screen">
        <Header
          sidebarOpen={sidebarOpen}
          onToggleSidebar={handleToggleSidebar}
        />
        <main
          className={`flex-1 flex flex-col min-h-0 transition-all duration-300 ease-in-out ${
            sidebarOpen ? 'lg:pl-64' : 'lg:pl-0'
          }`}
        >
          <ErrorBoundary>
            <PrivateRoute>
              <Suspense fallback={<PageLoadingFallback />}>
                <Outlet />
              </Suspense>
            </PrivateRoute>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LoginForm />} />
        <Route
          path="/notificacao"
          element={
            <Suspense fallback={<PageLoadingFallback />}>
              <DownloadNotificacao />
            </Suspense>
          }
        />
        <Route element={<ProtectedLayout />}>
          {protectedRoutes.map(({ path, component: Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
