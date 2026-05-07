import React from 'react';
import { ERROR_MESSAGES } from '../../config/constants';

/**
 * Error Boundary para capturar erros JavaScript e mostrar fallback UI
 * Implementa melhores práticas de tratamento de erro
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error) {
    // Atualiza o state para mostrar a UI de fallback
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log do erro para monitoramento
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    // Aqui você pode enviar o erro para um serviço de monitoramento
    // como Sentry, LogRocket, etc.
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState((prevState) => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prevState.retryCount + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      // UI de fallback customizada
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleRetry);
      }

      // UI de fallback padrão
      return (
        <div className="min-h-[400px] min-w-[400px] mt-20 mx-auto flex flex-col items-center justify-center p-8 bg-red-50 border border-red-200 rounded-lg">
          <div className="text-center max-w-md">
            {/* Ícone de erro */}
            <div className="text-6xl mb-4">⚠️</div>

            {/* Título */}
            <h2 className="text-xl font-bold text-red-800 mb-2">
              Oops! Algo deu errado
            </h2>

            {/* Mensagem */}
            <p className="text-red-600 mb-6">
              {this.props.message || ERROR_MESSAGES.SERVER_ERROR}
            </p>

            {/* Botão de retry */}
            <button
              onClick={this.handleRetry}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 font-medium"
              disabled={this.state.retryCount >= 3}
            >
              {this.state.retryCount >= 3
                ? 'Muitas tentativas'
                : 'Tentar Novamente'}
            </button>

            {/* Detalhes do erro */}
            {this.state.error && (
              <details className="mt-4 text-left">
                <summary className="cursor-pointer text-sm text-red-700 hover:text-red-800">
                  Detalhes técnicos
                </summary>
                <pre className="mt-2 text-xs bg-red-100 p-2 rounded overflow-auto text-red-800">
                  {this.state.error.toString()}
                  {this.state.errorInfo && this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
