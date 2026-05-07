import React, { useState } from 'react';
import PageTitle from '../components/ui/PageTitle';
import { Card, CardContent } from '../components/ui/cards';
import { Storefront, Image, ListDashes, Package, Plugs } from '@phosphor-icons/react';
import CatalogoBanners from '../components/catalogo/CatalogoBanners';
import CatalogoCategorias from '../components/catalogo/CatalogoCategorias';
import CatalogoProdutos from '../components/catalogo/CatalogoProdutos';
import CatalogoIntegracoes from '../components/catalogo/CatalogoIntegracoes';

const TABS = [
  { key: 'produtos', label: 'Produtos', icon: Package },
  { key: 'categorias', label: 'Categorias', icon: ListDashes },
  { key: 'banners', label: 'Banners', icon: Image },
  { key: 'integracoes', label: 'Integrações', icon: Plugs },
];

const CatalogoAdmin = () => {
  const [activeTab, setActiveTab] = useState('produtos');

  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      <PageTitle
        title="Catálogo Virtual"
        subtitle="Gerencie produtos, categorias e banners do catálogo"
        icon={Storefront}
        iconColor="text-indigo-600"
      />

      {/* Tabs */}
      <Card className="shadow-lg rounded-xl bg-white mb-6">
        <CardContent className="p-3">
          <div className="flex gap-2">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    activeTab === tab.key
                      ? 'bg-[#000638] text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Icon size={18} weight="bold" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Conteúdo da Tab Ativa */}
      <div className="animate-fade-in">
        {activeTab === 'produtos' && <CatalogoProdutos />}
        {activeTab === 'categorias' && <CatalogoCategorias />}
        {activeTab === 'banners' && <CatalogoBanners />}
        {activeTab === 'integracoes' && <CatalogoIntegracoes />}
      </div>
    </div>
  );
};

export default CatalogoAdmin;
