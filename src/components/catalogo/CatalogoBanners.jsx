import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../ui/cards';
import LoadingSpinner from '../ui/LoadingSpinner';
import {
  Image,
  Plus,
  Trash,
  ArrowUp,
  ArrowDown,
  LinkSimple,
  ToggleLeft,
  ToggleRight,
  UploadSimple,
  PencilSimple,
} from '@phosphor-icons/react';

const BUCKET = 'catalogo-virtual';
const SUPABASE_URL = 'https://dorztqiunewggydvkjnf.supabase.co';

const CatalogoBanners = () => {
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editLink, setEditLink] = useState('');
  const [editTitulo, setEditTitulo] = useState('');

  const fetchBanners = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('catalogo_banners')
      .select('*')
      .order('ordem', { ascending: true });

    if (!error) setBanners(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchBanners(); }, [fetchBanners]);

  const getImageUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const uid = crypto.randomUUID?.() || String(Date.now());
      const path = `banners/${uid}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false });

      if (uploadError) throw uploadError;

      const maxOrdem = banners.reduce((max, b) => Math.max(max, b.ordem || 0), 0);

      const { error: dbError } = await supabase
        .from('catalogo_banners')
        .insert({ imagem_path: path, ordem: maxOrdem + 1, ativo: true });

      if (dbError) throw dbError;
      await fetchBanners();
    } catch (err) {
      alert('Erro ao enviar banner: ' + err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (banner) => {
    if (!window.confirm('Excluir este banner?')) return;

    await supabase.storage.from(BUCKET).remove([banner.imagem_path]);
    await supabase.from('catalogo_banners').delete().eq('id', banner.id);
    await fetchBanners();
  };

  const handleToggle = async (banner) => {
    await supabase
      .from('catalogo_banners')
      .update({ ativo: !banner.ativo })
      .eq('id', banner.id);
    await fetchBanners();
  };

  const handleMove = async (index, direction) => {
    const newBanners = [...banners];
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= newBanners.length) return;

    const tempOrdem = newBanners[index].ordem;
    newBanners[index].ordem = newBanners[swapIndex].ordem;
    newBanners[swapIndex].ordem = tempOrdem;

    await supabase.from('catalogo_banners').update({ ordem: newBanners[index].ordem }).eq('id', newBanners[index].id);
    await supabase.from('catalogo_banners').update({ ordem: newBanners[swapIndex].ordem }).eq('id', newBanners[swapIndex].id);
    await fetchBanners();
  };

  const startEdit = (banner) => {
    setEditingId(banner.id);
    setEditLink(banner.link_url || '');
    setEditTitulo(banner.titulo || '');
  };

  const saveEdit = async () => {
    await supabase
      .from('catalogo_banners')
      .update({ link_url: editLink || null, titulo: editTitulo || null, updated_at: new Date().toISOString() })
      .eq('id', editingId);
    setEditingId(null);
    await fetchBanners();
  };

  return (
    <>
      {/* Upload */}
      <Card className="shadow-lg rounded-xl bg-white mb-6">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Image size={18} className="text-[#000638]" />
            <CardTitle className="text-sm font-bold text-[#000638]">Banners</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <CardDescription className="text-xs text-gray-500 mb-4">
            Gerencie os banners da página inicial do catálogo. Arraste para reordenar.
          </CardDescription>

          <label className={`flex items-center justify-center gap-2 border-2 border-dashed border-[#000638]/30 rounded-lg p-6 cursor-pointer hover:bg-[#f8f9fb] transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
            <input type="file" accept="image/*" onChange={handleUpload} className="hidden" disabled={uploading} />
            {uploading ? (
              <LoadingSpinner size="sm" text="Enviando..." />
            ) : (
              <>
                <UploadSimple size={24} className="text-[#000638]" />
                <span className="text-sm font-medium text-[#000638]">Clique para adicionar um novo banner</span>
              </>
            )}
          </label>
        </CardContent>
      </Card>

      {/* Lista de banners */}
      <Card className="shadow-lg rounded-xl bg-white">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Plus size={18} className="text-[#000638]" />
              <CardTitle className="text-sm font-bold text-[#000638]">
                Banners Cadastrados ({banners.length})
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner size="md" text="Carregando banners..." />
            </div>
          ) : banners.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Image size={48} className="mb-3" />
              <p className="text-lg font-medium">Nenhum banner cadastrado</p>
              <p className="text-sm mt-1">Adicione banners usando o botão acima</p>
            </div>
          ) : (
            <div className="space-y-4">
              {banners.map((banner, index) => (
                <div
                  key={banner.id}
                  className={`flex items-center gap-4 p-3 rounded-lg border transition-all ${
                    banner.ativo ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-60'
                  }`}
                >
                  {/* Thumbnail */}
                  <div className="w-40 h-20 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                    <img
                      src={getImageUrl(banner.imagem_path)}
                      alt={banner.titulo || 'Banner'}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    {editingId === banner.id ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder="Título do banner..."
                          value={editTitulo}
                          onChange={(e) => setEditTitulo(e.target.value)}
                          className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full text-xs bg-[#f8f9fb] text-[#000638]"
                        />
                        <div className="flex gap-2">
                          <input
                            type="url"
                            placeholder="https://link-de-redirecionamento.com"
                            value={editLink}
                            onChange={(e) => setEditLink(e.target.value)}
                            className="border border-[#000638]/30 rounded-lg px-2 py-1.5 flex-1 text-xs bg-[#f8f9fb] text-[#000638]"
                          />
                          <button
                            onClick={saveEdit}
                            className="px-3 py-1.5 bg-[#000638] text-white rounded-lg text-xs font-medium hover:bg-[#fe0000] transition-colors"
                          >
                            Salvar
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-300 transition-colors"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-[#000638] truncate">
                          {banner.titulo || `Banner ${index + 1}`}
                        </p>
                        {banner.link_url && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <LinkSimple size={12} className="text-blue-500" />
                            <span className="text-xs text-blue-500 truncate">{banner.link_url}</span>
                          </div>
                        )}
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full mt-1 ${banner.ativo ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {banner.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Ações */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => handleMove(index, -1)} disabled={index === 0} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors" title="Mover para cima">
                      <ArrowUp size={16} className="text-gray-600" />
                    </button>
                    <button onClick={() => handleMove(index, 1)} disabled={index === banners.length - 1} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors" title="Mover para baixo">
                      <ArrowDown size={16} className="text-gray-600" />
                    </button>
                    <button onClick={() => startEdit(banner)} className="p-1.5 rounded hover:bg-blue-50 transition-colors" title="Editar">
                      <PencilSimple size={16} className="text-blue-600" />
                    </button>
                    <button onClick={() => handleToggle(banner)} className="p-1.5 rounded hover:bg-gray-100 transition-colors" title={banner.ativo ? 'Desativar' : 'Ativar'}>
                      {banner.ativo ? <ToggleRight size={20} className="text-green-600" /> : <ToggleLeft size={20} className="text-gray-400" />}
                    </button>
                    <button onClick={() => handleDelete(banner)} className="p-1.5 rounded hover:bg-red-50 transition-colors" title="Excluir">
                      <Trash size={16} className="text-red-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
};

export default CatalogoBanners;
