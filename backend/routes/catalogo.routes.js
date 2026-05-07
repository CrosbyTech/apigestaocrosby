import express from 'express';
import supabase from '../config/supabase.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';

const router = express.Router();

// =============================================
// BANNERS
// =============================================

// GET /api/catalogo/banners
router.get(
  '/banners',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('catalogo_banners')
      .select('*')
      .order('ordem', { ascending: true });

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, `${data.length} banners encontrados`);
  }),
);

// POST /api/catalogo/banners
router.post(
  '/banners',
  asyncHandler(async (req, res) => {
    const { titulo, imagem_path, link_url, ordem, ativo } = req.body;
    if (!imagem_path) return errorResponse(res, 'imagem_path é obrigatório', 400);

    const { data, error } = await supabase
      .from('catalogo_banners')
      .insert({ titulo, imagem_path, link_url, ordem: ordem || 0, ativo: ativo !== false })
      .select()
      .single();

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Banner criado');
  }),
);

// PUT /api/catalogo/banners/:id
router.put(
  '/banners/:id',
  asyncHandler(async (req, res) => {
    const { titulo, imagem_path, link_url, ordem, ativo } = req.body;
    const { data, error } = await supabase
      .from('catalogo_banners')
      .update({ titulo, imagem_path, link_url, ordem, ativo, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Banner atualizado');
  }),
);

// PUT /api/catalogo/banners/reorder
router.put(
  '/banners/reorder',
  asyncHandler(async (req, res) => {
    const { items } = req.body; // [{ id, ordem }]
    if (!Array.isArray(items)) return errorResponse(res, 'items é obrigatório', 400);

    for (const item of items) {
      await supabase.from('catalogo_banners').update({ ordem: item.ordem }).eq('id', item.id);
    }
    successResponse(res, null, 'Ordem atualizada');
  }),
);

// DELETE /api/catalogo/banners/:id
router.delete(
  '/banners/:id',
  asyncHandler(async (req, res) => {
    // Buscar banner para remover imagem do storage
    const { data: banner } = await supabase
      .from('catalogo_banners')
      .select('imagem_path')
      .eq('id', req.params.id)
      .single();

    if (banner?.imagem_path) {
      await supabase.storage.from('catalogo-virtual').remove([banner.imagem_path]);
    }

    const { error } = await supabase
      .from('catalogo_banners')
      .delete()
      .eq('id', req.params.id);

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, null, 'Banner excluído');
  }),
);

// =============================================
// CATEGORIAS
// =============================================

// GET /api/catalogo/categorias
router.get(
  '/categorias',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('catalogo_categorias')
      .select('*')
      .order('ordem', { ascending: true });

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, `${data.length} categorias encontradas`);
  }),
);

// POST /api/catalogo/categorias
router.post(
  '/categorias',
  asyncHandler(async (req, res) => {
    const { nome, slug, parent_id, ordem, ativo } = req.body;
    if (!nome) return errorResponse(res, 'nome é obrigatório', 400);

    const { data, error } = await supabase
      .from('catalogo_categorias')
      .insert({ nome, slug: slug || nome.toLowerCase().replace(/\s+/g, '-'), parent_id: parent_id || null, ordem: ordem || 0, ativo: ativo !== false })
      .select()
      .single();

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Categoria criada');
  }),
);

// PUT /api/catalogo/categorias/:id
router.put(
  '/categorias/:id',
  asyncHandler(async (req, res) => {
    const { nome, slug, parent_id, ordem, ativo } = req.body;
    const { data, error } = await supabase
      .from('catalogo_categorias')
      .update({ nome, slug, parent_id, ordem, ativo, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Categoria atualizada');
  }),
);

// DELETE /api/catalogo/categorias/:id
router.delete(
  '/categorias/:id',
  asyncHandler(async (req, res) => {
    // Verificar se tem subcategorias
    const { data: subs } = await supabase
      .from('catalogo_categorias')
      .select('id')
      .eq('parent_id', req.params.id);

    if (subs && subs.length > 0) {
      return errorResponse(res, 'Remova as subcategorias antes de excluir esta categoria', 400, 'HAS_CHILDREN');
    }

    // Verificar se tem produtos vinculados
    const { data: prods } = await supabase
      .from('catalogo_produtos')
      .select('id')
      .eq('categoria_id', req.params.id)
      .limit(1);

    if (prods && prods.length > 0) {
      return errorResponse(res, 'Remova os produtos desta categoria antes de excluí-la', 400, 'HAS_PRODUCTS');
    }

    const { error } = await supabase
      .from('catalogo_categorias')
      .delete()
      .eq('id', req.params.id);

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, null, 'Categoria excluída');
  }),
);

// =============================================
// PRODUTOS
// =============================================

// GET /api/catalogo/produtos
router.get(
  '/produtos',
  asyncHandler(async (req, res) => {
    const { categoria_id, ativo, search, page, pageSize } = req.query;
    const limit = Math.min(parseInt(pageSize) || 50, 200);
    const offset = ((parseInt(page) || 1) - 1) * limit;

    let query = supabase
      .from('catalogo_produtos')
      .select('*, catalogo_categorias(id, nome, parent_id), catalogo_produto_imagens(*)', { count: 'exact' });

    if (categoria_id) query = query.eq('categoria_id', categoria_id);
    if (ativo !== undefined) query = query.eq('ativo', ativo === 'true');
    if (search) query = query.or(`nome.ilike.%${search}%,codigo_produto.ilike.%${search}%,marca.ilike.%${search}%`);

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, { items: data, total: count, page: parseInt(page) || 1, pageSize: limit }, `${data.length} produtos encontrados`);
  }),
);

// GET /api/catalogo/produtos/:id
router.get(
  '/produtos/:id',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('catalogo_produtos')
      .select('*, catalogo_categorias(id, nome, parent_id), catalogo_produto_imagens(*)')
      .eq('id', req.params.id)
      .single();

    if (error) return errorResponse(res, error.message, 404, 'NOT_FOUND');
    successResponse(res, data, 'Produto encontrado');
  }),
);

// POST /api/catalogo/produtos
router.post(
  '/produtos',
  asyncHandler(async (req, res) => {
    const { nome, descricao, codigo_produto, marca, especificacoes, preco, categoria_id, ativo } = req.body;
    if (!nome) return errorResponse(res, 'nome é obrigatório', 400);

    const { data, error } = await supabase
      .from('catalogo_produtos')
      .insert({
        nome,
        descricao,
        codigo_produto,
        marca,
        especificacoes,
        preco: preco ? parseFloat(preco) : null,
        categoria_id: categoria_id || null,
        ativo: ativo !== false,
      })
      .select()
      .single();

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Produto criado');
  }),
);

// PUT /api/catalogo/produtos/:id
router.put(
  '/produtos/:id',
  asyncHandler(async (req, res) => {
    const { nome, descricao, codigo_produto, marca, especificacoes, preco, categoria_id, ativo } = req.body;
    const { data, error } = await supabase
      .from('catalogo_produtos')
      .update({
        nome,
        descricao,
        codigo_produto,
        marca,
        especificacoes,
        preco: preco !== undefined ? (preco ? parseFloat(preco) : null) : undefined,
        categoria_id,
        ativo,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Produto atualizado');
  }),
);

// DELETE /api/catalogo/produtos/:id
router.delete(
  '/produtos/:id',
  asyncHandler(async (req, res) => {
    // Buscar imagens para remover do storage
    const { data: imagens } = await supabase
      .from('catalogo_produto_imagens')
      .select('imagem_path')
      .eq('produto_id', req.params.id);

    if (imagens && imagens.length > 0) {
      const paths = imagens.map(i => i.imagem_path);
      await supabase.storage.from('catalogo-virtual').remove(paths);
    }

    const { error } = await supabase
      .from('catalogo_produtos')
      .delete()
      .eq('id', req.params.id);

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, null, 'Produto excluído');
  }),
);

// =============================================
// IMAGENS DO PRODUTO
// =============================================

// POST /api/catalogo/produtos/:id/imagens
router.post(
  '/produtos/:id/imagens',
  asyncHandler(async (req, res) => {
    const { imagem_path, principal, ordem } = req.body;
    if (!imagem_path) return errorResponse(res, 'imagem_path é obrigatório', 400);

    // Se marcada como principal, desmarcar as outras
    if (principal) {
      await supabase
        .from('catalogo_produto_imagens')
        .update({ principal: false })
        .eq('produto_id', req.params.id);
    }

    const { data, error } = await supabase
      .from('catalogo_produto_imagens')
      .insert({ produto_id: req.params.id, imagem_path, principal: principal || false, ordem: ordem || 0 })
      .select()
      .single();

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Imagem adicionada');
  }),
);

// PUT /api/catalogo/produto-imagens/:id/principal
router.put(
  '/produto-imagens/:id/principal',
  asyncHandler(async (req, res) => {
    // Buscar a imagem para saber o produto
    const { data: img } = await supabase
      .from('catalogo_produto_imagens')
      .select('produto_id')
      .eq('id', req.params.id)
      .single();

    if (!img) return errorResponse(res, 'Imagem não encontrada', 404);

    // Desmarcar todas
    await supabase
      .from('catalogo_produto_imagens')
      .update({ principal: false })
      .eq('produto_id', img.produto_id);

    // Marcar esta
    const { data, error } = await supabase
      .from('catalogo_produto_imagens')
      .update({ principal: true })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, data, 'Imagem principal definida');
  }),
);

// DELETE /api/catalogo/produto-imagens/:id
router.delete(
  '/produto-imagens/:id',
  asyncHandler(async (req, res) => {
    const { data: img } = await supabase
      .from('catalogo_produto_imagens')
      .select('imagem_path')
      .eq('id', req.params.id)
      .single();

    if (img?.imagem_path) {
      await supabase.storage.from('catalogo-virtual').remove([img.imagem_path]);
    }

    const { error } = await supabase
      .from('catalogo_produto_imagens')
      .delete()
      .eq('id', req.params.id);

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    successResponse(res, null, 'Imagem excluída');
  }),
);

// =============================================
// CONFIGURAÇÕES DE MARKETING / INTEGRAÇÕES
// =============================================

// GET /api/catalogo/configuracoes - todas as configs
router.get(
  '/configuracoes',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('catalogo_configuracoes')
      .select('*')
      .order('chave');

    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');

    // Transforma array em objeto { chave: valor }
    const config = {};
    for (const row of data || []) {
      config[row.chave] = row.valor;
    }
    successResponse(res, config, 'Configurações carregadas');
  }),
);

// PUT /api/catalogo/configuracoes - atualiza uma ou mais chaves
router.put(
  '/configuracoes',
  asyncHandler(async (req, res) => {
    const updates = req.body; // { chave1: valor1, chave2: valor2 }
    if (!updates || typeof updates !== 'object') {
      return errorResponse(res, 'Body deve ser um objeto { chave: valor }', 400);
    }

    const ALLOWED_KEYS = ['meta_pixel_id', 'ga4_measurement_id', 'utm_config'];
    const results = [];

    for (const [chave, valor] of Object.entries(updates)) {
      if (!ALLOWED_KEYS.includes(chave)) continue;

      const { data, error } = await supabase
        .from('catalogo_configuracoes')
        .upsert(
          { chave, valor, updated_at: new Date().toISOString() },
          { onConflict: 'chave' },
        )
        .select()
        .single();

      if (error) {
        results.push({ chave, error: error.message });
      } else {
        results.push({ chave, success: true });
      }
    }

    successResponse(res, results, 'Configurações atualizadas');
  }),
);

export default router;
