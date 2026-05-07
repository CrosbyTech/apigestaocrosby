import React, { useState, useEffect } from 'react';
import PageTitle from '../components/ui/PageTitle';
import { Card, CardContent } from '../components/ui/cards';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import {
  ChartLineUp,
  FileText,
  Rocket,
  ChartBar,
  WhatsappLogo,
} from '@phosphor-icons/react';
import WhatsAppDashboard from '../components/whatsapp-official/WhatsAppDashboard';
import WhatsAppTemplates from '../components/whatsapp-official/WhatsAppTemplates';
import WhatsAppCampaigns from '../components/whatsapp-official/WhatsAppCampaigns';
import WhatsAppReports from '../components/whatsapp-official/WhatsAppReports';

const API_BASE = import.meta.env.VITE_API_URL || '';

const TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: ChartLineUp },
  { key: 'templates', label: 'Templates', icon: FileText },
  { key: 'campanhas', label: 'Campanhas', icon: Rocket },
  { key: 'relatorios', label: 'Relatórios', icon: ChartBar },
];

const CrosbyManage = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/meta/accounts`);
        const json = await res.json();
        if (json.success) setAccounts(json.data || []);
      } catch (err) {
        console.error('Erro ao buscar contas:', err);
      } finally {
        setLoadingAccounts(false);
      }
    };
    fetchAccounts();
  }, []);

  if (loadingAccounts) {
    return (
      <div className="w-full max-w-7xl mx-auto p-4 flex justify-center py-20">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      <PageTitle
        title="Crosby Manage"
        subtitle="Gestão completa do WhatsApp Business API — contas, templates, campanhas e relatórios"
        icon={WhatsappLogo}
        iconColor="text-emerald-600"
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
        {activeTab === 'dashboard' && <WhatsAppDashboard accounts={accounts} />}
        {activeTab === 'templates' && <WhatsAppTemplates accounts={accounts} />}
        {activeTab === 'campanhas' && <WhatsAppCampaigns accounts={accounts} />}
        {activeTab === 'relatorios' && <WhatsAppReports accounts={accounts} />}
      </div>
    </div>
  );
};

export default CrosbyManage;
