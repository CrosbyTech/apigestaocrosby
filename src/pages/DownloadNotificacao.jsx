import React, { useState } from 'react';
import {
  DownloadSimple,
  WarningCircle,
  CheckCircle,
  CircleNotch,
} from '@phosphor-icons/react';
import { supabase } from '../lib/supabase';

const BUCKET_NAME = 'clientes-confianca';

const DownloadNotificacao = () => {
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(false);

  const params = new URLSearchParams(window.location.search);
  const doc = params.get('doc');

  const handleDownload = async () => {
    if (!doc) return;
    setBaixando(true);
    setErro(null);
    try {
      const storagePath = `notificacoes/${doc}.pdf`;
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(storagePath, 300);

      if (error || !data?.signedUrl) {
        throw new Error('Arquivo não encontrado');
      }

      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = `${doc}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setSucesso(true);
    } catch (e) {
      setErro(
        'Não foi possível baixar o arquivo. Verifique o link e tente novamente.',
      );
    } finally {
      setBaixando(false);
    }
  };

  if (!doc) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="bg-white rounded-2xl shadow-2xl p-10 max-w-md w-full text-center">
          <WarningCircle className="mx-auto mb-4 text-red-500" size={48} />
          <h2 className="text-xl font-bold text-gray-800 mb-2">
            Link inválido
          </h2>
          <p className="text-gray-500">
            Este link não contém um documento válido.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="bg-white rounded-2xl shadow-2xl p-10 max-w-md w-full text-center">
        <div className="mb-6">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <DownloadSimple className="text-amber-600" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-1">
            Crosby CR Vestuário
          </h1>
          <p className="text-gray-500 text-sm">Notificação Extrajudicial</p>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <p className="text-gray-600 text-sm break-all">{doc}.pdf</p>
        </div>

        {erro && (
          <div className="bg-red-50 text-red-700 rounded-lg p-3 mb-4 text-sm flex items-center gap-2">
            <WarningCircle size={16} />
            {erro}
          </div>
        )}

        {sucesso ? (
          <div className="bg-green-50 text-green-700 rounded-lg p-4 flex items-center justify-center gap-2">
            <CheckCircle size={20} />
            <span className="font-medium">Download concluído!</span>
          </div>
        ) : (
          <button
            onClick={handleDownload}
            disabled={baixando}
            className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {baixando ? (
              <>
                <CircleNotch className="animate-spin" size={20} />
                Baixando...
              </>
            ) : (
              <>
                <DownloadSimple size={20} />
                Baixar Documento
              </>
            )}
          </button>
        )}

        <p className="text-gray-400 text-xs mt-6">
          headcoach.crosbytech.com.br
        </p>
      </div>
    </div>
  );
};

export default DownloadNotificacao;
