import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../ui/cards';
import LoadingSpinner from '../ui/LoadingSpinner';
import {
  Package,
  Plus,
  Trash,
  PencilSimple,
  MagnifyingGlass,
  ToggleLeft,
  ToggleRight,
  FloppyDisk,
  X,
  UploadSimple,
  Star,
  CaretLeft,
  CaretRight,
  ImageSquare,
} from '@phosphor-icons/react';

const BUCKET = 'catalogo-virtual';
const SUPABASE_URL = 'https://dorztqiunewggydvkjnf.supabase.co';
const ITEMS_PER_PAGE = 20;

const getImageUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

const formatCurrency = (value) =>
  value != null ? Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';

const CatalogoProdutos = () => {
  const [produtos, setProdutos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filterCategoria, setFilterCategoria] = useState('');
  const [filterAtivo, setFilterAtivo] = useState('');

  // Formulário
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    nome: '', descricao: '', codigo_produto: '', marca: '',
    especificacoes: '', preco: '', categoria_id: '', ativo: true,
  });
  const [produtoImagens, setProdutoImagens] = useState([]);
  const [uploadingImages, setUploadingImages] = useState(false);

  const fetchCategorias = useCallback(async () => {
    const { data } = await supabase
      .from('catalogo_categorias')
      .select('*')
      .eq('ativo', true)
      .order('ordem');
    setCategorias(data || []);
  }, []);

  const fetchProdutos = useCallback(async () => {
    setLoading(true);
    const offset = (page - 1) * ITEMS_PER_PAGE;

    let query = supabase
      .from('catalogo_produtos')
      .select('*, catalogo_categorias(id, nome, parent_id), catalogo_produto_imagens(*)', { count: 'exact' });

    if (filterCategoria) query = query.eq('categoria_id', filterCategoria);
    if (filterAtivo !== '') query = query.eq('ativo', filterAtivo === 'true');
    if (search) query = query.or(`nome.ilike.%${search}%,codigo_produto.ilike.%${search}%,marca.ilike.%${search}%`);

    query = query.order('created_at', { ascending: false }).range(offset, offset + ITEMS_PER_PAGE - 1);

    const { data, count, error } = await query;

    if (!error) {
      setProdutos(data || []);
      setTotal(count || 0);
    }
    setLoading(false);
  }, [page, search, filterCategoria, filterAtivo]);

  useEffect(() => { fetchCategorias(); }, [fetchCategorias]);
  useEffect(() => { fetchProdutos(); }, [fetchProdutos]);

  // Build category tree label
  const getCategoryLabel = (cat) => {
    if (!cat) return '—';
    const parent = categorias.find(c => c.id === cat.parent_id);
    return parent ? `${parent.nome} > ${cat.nome}` : cat.nome;
  };

  const getMainImage = (produto) => {
    const imgs = produto.catalogo_produto_imagens || [];
    const main = imgs.find(i => i.principal) || imgs[0];
    return main ? getImageUrl(main.imagem_path) : null;
  };

  const resetForm = () => {
    setForm({ nome: '', descricao: '', codigo_produto: '', marca: '', especificacoes: '', preco: '', categoria_id: '', ativo: true });
    setProdutoImagens([]);
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = async (produto) => {
    setForm({
      nome: produto.nome || '',
      descricao: produto.descricao || '',
      codigo_produto: produto.codigo_produto || '',
      marca: produto.marca || '',
      especificacoes: produto.especificacoes || '',
      preco: produto.preco || '',
      categoria_id: produto.categoria_id || '',
      ativo: produto.ativo,
    });
    setProdutoImagens(produto.catalogo_produto_imagens || []);
    setEditingId(produto.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.nome.trim()) return alert('Nome é obrigatório');

    const payload = {
      nome: form.nome,
      descricao: form.descricao || null,
      codigo_produto: form.codigo_produto || null,
      marca: form.marca || null,
      especificacoes: form.especificacoes || null,
      preco: form.preco ? parseFloat(form.preco) : null,
      categoria_id: form.categoria_id || null,
      ativo: form.ativo,
    };

    if (editingId) {
      payload.updated_at = new Date().toISOString();
      const { error } = await supabase.from('catalogo_produtos').update(payload).eq('id', editingId);
      if (error) return alert('Erro: ' + error.message);
    } else {
      const { data, error } = await supabase.from('catalogo_produtos').insert(payload).select().single();
      if (error) return alert('Erro: ' + error.message);
      setEditingId(data.id);
    }

    resetForm();
    await fetchProdutos();
  };

  const handleDelete = async (produto) => {
    if (!window.confirm(`Excluir "${produto.nome}"?`)) return;

    // Remover imagens do storage
    const imgs = produto.catalogo_produto_imagens || [];
    if (imgs.length > 0) {
      await supabase.storage.from(BUCKET).remove(imgs.map(i => i.imagem_path));
    }

    const { error } = await supabase.from('catalogo_produtos').delete().eq('id', produto.id);
    if (error) return alert('Erro: ' + error.message);
    await fetchProdutos();
  };

  const handleToggle = async (produto) => {
    await supabase.from('catalogo_produtos').update({ ativo: !produto.ativo }).eq('id', produto.id);
    await fetchProdutos();
  };

  // Upload de imagens
  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !editingId) return;

    setUploadingImages(true);
    try {
      for (const file of files) {
        const ext = file.name.split('.').pop();
        const uid = crypto.randomUUID?.() || String(Date.now());
        const path = `produtos/${editingId}/${uid}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { upsert: false });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          continue;
        }

        const isPrincipal = produtoImagens.length === 0;
        await supabase.from('catalogo_produto_imagens').insert({
          produto_id: editingId,
          imagem_path: path,
          principal: isPrincipal,
          ordem: produtoImagens.length,
        });
      }

      // Recarregar imagens
      const { data } = await supabase
        .from('catalogo_produto_imagens')
        .select('*')
        .eq('produto_id', editingId)
        .order('ordem');
      setProdutoImagens(data || []);
    } catch (err) {
      alert('Erro no upload: ' + err.message);
    } finally {
      setUploadingImages(false);
      e.target.value = '';
    }
  };

  const setMainImage = async (imgId) => {
    await supabase.from('catalogo_produto_imagens').update({ principal: false }).eq('produto_id', editingId);
    await supabase.from('catalogo_produto_imagens').update({ principal: true }).eq('id', imgId);
    const { data } = await supabase.from('catalogo_produto_imagens').select('*').eq('produto_id', editingId).order('ordem');
    setProdutoImagens(data || []);
  };

  const deleteImage = async (img) => {
    await supabase.storage.from(BUCKET).remove([img.imagem_path]);
    await supabase.from('catalogo_produto_imagens').delete().eq('id', img.id);
    const { data } = await supabase.from('catalogo_produto_imagens').select('*').eq('produto_id', editingId).order('ordem');
    setProdutoImagens(data || []);
  };

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return (
    <>
      {/* Formulário de Produto */}
      {showForm && (
        <Card className="shadow-lg rounded-xl bg-white mb-6">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package size={18} className="text-[#000638]" />
                <CardTitle className="text-sm font-bold text-[#000638]">
                  {editingId ? 'Editar Produto' : 'Novo Produto'}
                </CardTitle>
              </div>
              <button onClick={resetForm} className="p-1.5 rounded hover:bg-gray-100">
                <X size={18} className="text-gray-500" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Nome *</label>
                <input
                  type="text"
                  value={form.nome}
                  onChange={(e) => setForm(prev => ({ ...prev, nome: e.target.value }))}
                  placeholder="Nome do produto..."
                  className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Código</label>
                <input
                  type="text"
                  value={form.codigo_produto}
                  onChange={(e) => setForm(prev => ({ ...prev, codigo_produto: e.target.value }))}
                  placeholder="Código..."
                  className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Marca</label>
                <input
                  type="text"
                  value={form.marca}
                  onChange={(e) => setForm(prev => ({ ...prev, marca: e.target.value }))}
                  placeholder="Marca..."
                  className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Categoria</label>
                <select
                  value={form.categoria_id}
                  onChange={(e) => setForm(prev => ({ ...prev, categoria_id: e.target.value }))}
                  className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                >
                  <option value="">Sem categoria</option>
                  {categorias.map(c => (
                    <option key={c.id} value={c.id}>
                      {getCategoryLabel(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Preço</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.preco}
                  onChange={(e) => setForm(prev => ({ ...prev, preco: e.target.value }))}
                  placeholder="0.00"
                  className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Especificações</label>
                <input
                  type="text"
                  value={form.especificacoes}
                  onChange={(e) => setForm(prev => ({ ...prev, especificacoes: e.target.value }))}
                  placeholder="Ex: Material, tamanho..."
                  className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Descrição</label>
                <textarea
                  value={form.descricao}
                  onChange={(e) => setForm(prev => ({ ...prev, descricao: e.target.value }))}
                  placeholder="Descrição detalhada do produto..."
                  rows={3}
                  className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs resize-y"
                />
              </div>
            </div>

            {/* Upload de Imagens (apenas para produto já salvo) */}
            {editingId && (
              <div className="mt-4">
                <label className="block text-xs font-semibold mb-2 text-[#000638]">Galeria de Imagens</label>

                {/* Grid de imagens */}
                <div className="flex flex-wrap gap-3 mb-3">
                  {produtoImagens.map((img) => (
                    <div key={img.id} className={`relative w-24 h-24 rounded-lg overflow-hidden border-2 ${img.principal ? 'border-yellow-400' : 'border-gray-200'} group`}>
                      <img src={getImageUrl(img.imagem_path)} alt="" className="w-full h-full object-cover" />
                      {img.principal && (
                        <div className="absolute top-0.5 left-0.5">
                          <Star size={14} weight="fill" className="text-yellow-400 drop-shadow" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                        {!img.principal && (
                          <button onClick={() => setMainImage(img.id)} className="p-1 bg-white rounded" title="Definir como principal">
                            <Star size={14} className="text-yellow-500" />
                          </button>
                        )}
                        <button onClick={() => deleteImage(img)} className="p-1 bg-white rounded" title="Excluir">
                          <Trash size={14} className="text-red-500" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Botão de upload */}
                  <label className={`w-24 h-24 rounded-lg border-2 border-dashed border-[#000638]/30 flex flex-col items-center justify-center cursor-pointer hover:bg-[#f8f9fb] transition-colors ${uploadingImages ? 'opacity-50 pointer-events-none' : ''}`}>
                    <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" disabled={uploadingImages} />
                    {uploadingImages ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <>
                        <UploadSimple size={20} className="text-[#000638]/50" />
                        <span className="text-[10px] text-[#000638]/50 mt-0.5">Adicionar</span>
                      </>
                    )}
                  </label>
                </div>
                <p className="text-[10px] text-gray-400">Estrela = imagem principal. Clique na imagem para ações.</p>
              </div>
            )}

            <div className="flex gap-2 justify-end mt-4">
              <button onClick={resetForm} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-300 transition-colors">
                <X size={14} />
                Cancelar
              </button>
              <button onClick={handleSave} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#000638] text-white rounded-lg text-xs font-medium hover:bg-[#fe0000] transition-colors">
                <FloppyDisk size={14} />
                {editingId ? 'Atualizar' : 'Salvar'}
              </button>
              {!editingId && (
                <p className="text-[10px] text-gray-400 self-center ml-2">Salve primeiro para adicionar imagens</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filtros + Lista */}
      <Card className="shadow-lg rounded-xl bg-white">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package size={18} className="text-[#000638]" />
              <CardTitle className="text-sm font-bold text-[#000638]">
                Produtos ({total})
              </CardTitle>
            </div>
            {!showForm && (
              <button
                onClick={() => { resetForm(); setShowForm(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#000638] text-white rounded-lg text-xs font-medium hover:bg-[#fe0000] transition-colors"
              >
                <Plus size={14} />
                Novo Produto
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          {/* Barra de filtros */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
            <div className="sm:col-span-2 relative">
              <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por nome, código ou marca..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="border border-[#000638]/30 rounded-lg pl-8 pr-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>
            <select
              value={filterCategoria}
              onChange={(e) => { setFilterCategoria(e.target.value); setPage(1); }}
              className="border border-[#000638]/30 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
            >
              <option value="">Todas Categorias</option>
              {categorias.map(c => (
                <option key={c.id} value={c.id}>{getCategoryLabel(c)}</option>
              ))}
            </select>
            <select
              value={filterAtivo}
              onChange={(e) => { setFilterAtivo(e.target.value); setPage(1); }}
              className="border border-[#000638]/30 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
            >
              <option value="">Todos Status</option>
              <option value="true">Ativos</option>
              <option value="false">Inativos</option>
            </select>
          </div>

          {/* Tabela de produtos */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner size="md" text="Carregando produtos..." />
            </div>
          ) : produtos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Package size={48} className="mb-3" />
              <p className="text-lg font-medium">Nenhum produto encontrado</p>
              <p className="text-sm mt-1">
                {search || filterCategoria || filterAtivo ? 'Tente ajustar os filtros' : 'Adicione produtos usando o botão acima'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                    <tr>
                      <th className="px-4 py-3">Imagem</th>
                      <th className="px-4 py-3">Produto</th>
                      <th className="px-4 py-3">Código</th>
                      <th className="px-4 py-3">Marca</th>
                      <th className="px-4 py-3">Categoria</th>
                      <th className="px-4 py-3">Preço</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {produtos.map((produto) => (
                      <tr key={produto.id} className={`border-b hover:bg-blue-50 transition-colors ${produto.ativo ? 'bg-white' : 'bg-gray-50 opacity-70'}`}>
                        <td className="px-4 py-3">
                          <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
                            {getMainImage(produto) ? (
                              <img src={getMainImage(produto)} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <ImageSquare size={20} className="text-gray-300" />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{produto.nome}</div>
                          {produto.descricao && (
                            <div className="text-xs text-gray-400 truncate max-w-[200px]">{produto.descricao}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {produto.codigo_produto ? (
                            <span className="bg-purple-100 text-purple-800 text-xs font-medium px-2 py-1 rounded">
                              {produto.codigo_produto}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{produto.marca || '—'}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {produto.catalogo_categorias ? (
                            <span className="bg-indigo-100 text-indigo-800 text-xs font-medium px-2 py-1 rounded">
                              {getCategoryLabel(produto.catalogo_categorias)}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 font-medium text-green-600">{formatCurrency(produto.preco)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${produto.ativo ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {produto.ativo ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button onClick={() => startEdit(produto)} className="p-1.5 rounded hover:bg-blue-50 transition-colors" title="Editar">
                              <PencilSimple size={16} className="text-blue-600" />
                            </button>
                            <button onClick={() => handleToggle(produto)} className="p-1.5 rounded hover:bg-gray-100 transition-colors" title={produto.ativo ? 'Desativar' : 'Ativar'}>
                              {produto.ativo ? <ToggleRight size={20} className="text-green-600" /> : <ToggleLeft size={20} className="text-gray-400" />}
                            </button>
                            <button onClick={() => handleDelete(produto)} className="p-1.5 rounded hover:bg-red-50 transition-colors" title="Excluir">
                              <Trash size={16} className="text-red-500" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Paginação */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 px-2">
                  <div className="text-xs text-gray-600">
                    Mostrando {(page - 1) * ITEMS_PER_PAGE + 1}-{Math.min(page * ITEMS_PER_PAGE, total)} de {total}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
                    >
                      <CaretLeft size={16} />
                    </button>
                    <span className="text-xs font-medium text-[#000638]">
                      Página {page} de {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
                    >
                      <CaretRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
};

export default CatalogoProdutos;
