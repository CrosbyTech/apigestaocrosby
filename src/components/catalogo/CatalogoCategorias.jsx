import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../ui/cards';
import LoadingSpinner from '../ui/LoadingSpinner';
import {
  ListDashes,
  Plus,
  Trash,
  PencilSimple,
  CaretRight,
  ToggleLeft,
  ToggleRight,
  FloppyDisk,
  X,
  TreeStructure,
} from '@phosphor-icons/react';

const CatalogoCategorias = () => {
  const [categorias, setCategorias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ nome: '', parent_id: '', ordem: 0 });
  const [expandedCats, setExpandedCats] = useState({});

  const fetchCategorias = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('catalogo_categorias')
      .select('*')
      .order('ordem', { ascending: true });

    if (!error) setCategorias(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchCategorias(); }, [fetchCategorias]);

  // Organizar em árvore
  const rootCats = categorias.filter(c => !c.parent_id);
  const getChildren = (parentId) => categorias.filter(c => c.parent_id === parentId);

  const toggleExpand = (id) => {
    setExpandedCats(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const resetForm = () => {
    setForm({ nome: '', parent_id: '', ordem: 0 });
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (cat) => {
    setForm({ nome: cat.nome, parent_id: cat.parent_id || '', ordem: cat.ordem || 0 });
    setEditingId(cat.id);
    setShowForm(true);
  };

  const startAddSub = (parentId) => {
    setForm({ nome: '', parent_id: parentId, ordem: 0 });
    setEditingId(null);
    setShowForm(true);
    setExpandedCats(prev => ({ ...prev, [parentId]: true }));
  };

  const handleSave = async () => {
    if (!form.nome.trim()) return alert('Nome é obrigatório');

    const slug = form.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    if (editingId) {
      const { error } = await supabase
        .from('catalogo_categorias')
        .update({ nome: form.nome, slug, parent_id: form.parent_id || null, ordem: form.ordem, updated_at: new Date().toISOString() })
        .eq('id', editingId);
      if (error) return alert('Erro: ' + error.message);
    } else {
      const { error } = await supabase
        .from('catalogo_categorias')
        .insert({ nome: form.nome, slug, parent_id: form.parent_id || null, ordem: form.ordem, ativo: true });
      if (error) return alert('Erro: ' + error.message);
    }

    resetForm();
    await fetchCategorias();
  };

  const handleToggle = async (cat) => {
    await supabase.from('catalogo_categorias').update({ ativo: !cat.ativo }).eq('id', cat.id);
    await fetchCategorias();
  };

  const handleDelete = async (cat) => {
    const children = getChildren(cat.id);
    if (children.length > 0) return alert('Remova as subcategorias antes');

    if (!window.confirm(`Excluir "${cat.nome}"?`)) return;
    const { error } = await supabase.from('catalogo_categorias').delete().eq('id', cat.id);
    if (error) return alert('Erro: ' + error.message);
    await fetchCategorias();
  };

  const CategoryRow = ({ cat, level = 0 }) => {
    const children = getChildren(cat.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedCats[cat.id];

    return (
      <>
        <div
          className={`flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-blue-50 transition-colors ${
            cat.ativo ? 'bg-white' : 'bg-gray-50 opacity-60'
          }`}
          style={{ marginLeft: level * 24 }}
        >
          {/* Expand */}
          <button
            onClick={() => toggleExpand(cat.id)}
            className={`p-0.5 rounded transition-transform ${hasChildren ? 'text-gray-500' : 'text-transparent pointer-events-none'}`}
          >
            <CaretRight size={14} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          </button>

          {/* Nome */}
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-[#000638]">{cat.nome}</span>
            {level === 0 && hasChildren && (
              <span className="ml-2 text-xs text-gray-400">({children.length} sub)</span>
            )}
          </div>

          {/* Status */}
          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${cat.ativo ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {cat.ativo ? 'Ativo' : 'Inativo'}
          </span>

          {/* Ordem */}
          <span className="text-xs text-gray-400 w-8 text-center">#{cat.ordem}</span>

          {/* Ações */}
          <div className="flex items-center gap-1">
            <button onClick={() => startAddSub(cat.id)} className="p-1.5 rounded hover:bg-blue-50 transition-colors" title="Adicionar subcategoria">
              <Plus size={14} className="text-blue-600" />
            </button>
            <button onClick={() => startEdit(cat)} className="p-1.5 rounded hover:bg-blue-50 transition-colors" title="Editar">
              <PencilSimple size={14} className="text-blue-600" />
            </button>
            <button onClick={() => handleToggle(cat)} className="p-1.5 rounded hover:bg-gray-100 transition-colors" title={cat.ativo ? 'Desativar' : 'Ativar'}>
              {cat.ativo ? <ToggleRight size={18} className="text-green-600" /> : <ToggleLeft size={18} className="text-gray-400" />}
            </button>
            <button onClick={() => handleDelete(cat)} className="p-1.5 rounded hover:bg-red-50 transition-colors" title="Excluir">
              <Trash size={14} className="text-red-500" />
            </button>
          </div>
        </div>

        {/* Filhos */}
        {isExpanded && children.map(child => (
          <CategoryRow key={child.id} cat={child} level={level + 1} />
        ))}
      </>
    );
  };

  return (
    <>
      {/* Formulário */}
      <Card className="shadow-lg rounded-xl bg-white mb-6">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TreeStructure size={18} className="text-[#000638]" />
              <CardTitle className="text-sm font-bold text-[#000638]">
                {showForm ? (editingId ? 'Editar Categoria' : 'Nova Categoria') : 'Categorias e Subcategorias'}
              </CardTitle>
            </div>
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#000638] text-white rounded-lg text-xs font-medium hover:bg-[#fe0000] transition-colors"
              >
                <Plus size={14} />
                Nova Categoria
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          {showForm ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-1">
                  <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Nome</label>
                  <input
                    type="text"
                    value={form.nome}
                    onChange={(e) => setForm(prev => ({ ...prev, nome: e.target.value }))}
                    placeholder="Nome da categoria..."
                    className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Categoria Pai</label>
                  <select
                    value={form.parent_id}
                    onChange={(e) => setForm(prev => ({ ...prev, parent_id: e.target.value }))}
                    className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                  >
                    <option value="">Nenhuma (Raiz)</option>
                    {rootCats.map(c => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Ordem</label>
                  <input
                    type="number"
                    value={form.ordem}
                    onChange={(e) => setForm(prev => ({ ...prev, ordem: parseInt(e.target.value) || 0 }))}
                    className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={resetForm} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-300 transition-colors">
                  <X size={14} />
                  Cancelar
                </button>
                <button onClick={handleSave} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#000638] text-white rounded-lg text-xs font-medium hover:bg-[#fe0000] transition-colors">
                  <FloppyDisk size={14} />
                  {editingId ? 'Atualizar' : 'Salvar'}
                </button>
              </div>
            </div>
          ) : (
            <CardDescription className="text-xs text-gray-500">
              Organize a árvore de navegação do catálogo com categorias e subcategorias
            </CardDescription>
          )}
        </CardContent>
      </Card>

      {/* Árvore de categorias */}
      <Card className="shadow-lg rounded-xl bg-white">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <ListDashes size={18} className="text-[#000638]" />
            <CardTitle className="text-sm font-bold text-[#000638]">
              Árvore de Categorias ({categorias.length})
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner size="md" text="Carregando categorias..." />
            </div>
          ) : rootCats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <TreeStructure size={48} className="mb-3" />
              <p className="text-lg font-medium">Nenhuma categoria cadastrada</p>
              <p className="text-sm mt-1">Crie categorias para organizar os produtos do catálogo</p>
            </div>
          ) : (
            <div className="space-y-1">
              {rootCats.map(cat => (
                <CategoryRow key={cat.id} cat={cat} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
};

export default CatalogoCategorias;
