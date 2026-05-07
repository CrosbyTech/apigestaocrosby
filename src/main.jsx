import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { AuthProvider } from './components/AuthContext';
import ErrorBoundary from './components/ui/ErrorBoundary';

// API Key vem da variável de ambiente (VITE_ prefix para Vite injetar no build)
const API_KEY = import.meta.env.VITE_API_KEY || '';

// Interceptor global: adiciona x-api-key em toda request para a API
const originalFetch = window.fetch;
window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (url.includes('apigestaocrosby') || url.startsWith('/api/')) {
    init = init || {};
    init.headers =
      init.headers instanceof Headers
        ? (() => {
            init.headers.set('x-api-key', API_KEY);
            return init.headers;
          })()
        : { ...init.headers, 'x-api-key': API_KEY };
  }
  return originalFetch.call(this, input, init);
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <AuthProvider>
      <App />
    </AuthProvider>
  </ErrorBoundary>,
);
