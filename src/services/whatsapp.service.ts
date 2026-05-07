const META_GRAPH_BASE_URL = 'https://graph.facebook.com';
const META_GRAPH_VERSION = 'v22.0';

export type WhatsAppAccount = {
  id: number;
  name: string;
  waba_id: string;
  phone_id: string;
  access_token: string;
};

export type ConversationAnalyticsParams = {
  account: WhatsAppAccount;
  startDate: string;
  endDate: string;
  granularity?: 'HALF_HOUR' | 'DAILY';
  phoneNumbers?: string[];
  dimensions?: string[];
};

export type TemplateButton = {
  type: 'PHONE_NUMBER' | 'URL' | 'QUICK_REPLY';
  text: string;
  phone_number?: string;
  url?: string;
  example?: string[];
};

export type TemplateInput = {
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;
  body: string;
  headerType?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  headerText?: string;
  footerText?: string;
  bodyExamples?: string[][];
  headerExamples?: string[];
  buttons?: TemplateButton[];
  carouselCards?: Array<{
    headerType?: 'IMAGE' | 'VIDEO' | 'TEXT';
    body: string;
    buttons?: TemplateButton[];
  }>;
};

class WhatsAppOfficialService {
  private async graphRequest<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${META_GRAPH_BASE_URL}/${META_GRAPH_VERSION}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error?.message || `Meta Graph API error ${response.status}`);
    }

    return data as T;
  }

  async getConversationAnalytics({
    account,
    startDate,
    endDate,
    granularity = 'DAILY',
    phoneNumbers,
    dimensions = ['CONVERSATION_CATEGORY', 'CONVERSATION_DIRECTION', 'COUNTRY', 'PHONE'],
  }: ConversationAnalyticsParams) {
    const start = Math.floor(new Date(startDate).getTime() / 1000);
    const end = Math.floor(new Date(endDate).getTime() / 1000);
    const params = new URLSearchParams({
      start: String(start),
      end: String(end),
      granularity,
      dimensions: JSON.stringify(dimensions),
    });

    const phones = phoneNumbers?.length ? phoneNumbers : [account.phone_id];
    params.set('phone_numbers', JSON.stringify(phones));

    return this.graphRequest<any>(`/${account.waba_id}/conversation_analytics?${params.toString()}`, account.access_token, {
      method: 'GET',
    });
  }

  async getTemplates(account: WhatsAppAccount, limit = 200) {
    const params = new URLSearchParams({ limit: String(limit) });
    return this.graphRequest<any>(`/${account.waba_id}/message_templates?${params.toString()}`, account.access_token, {
      method: 'GET',
    });
  }

  buildTemplatePayload(template: TemplateInput) {
    const components: any[] = [];

    if (template.headerType) {
      const header: any = { type: 'HEADER', format: template.headerType };
      if (template.headerType === 'TEXT') {
        header.text = template.headerText || '';
        if (template.headerExamples?.length) {
          header.example = { header_text: template.headerExamples };
        }
      }
      components.push(header);
    }

    components.push({
      type: 'BODY',
      text: template.body,
      ...(template.bodyExamples?.length ? { example: { body_text: template.bodyExamples } } : {}),
    });

    if (template.footerText) {
      components.push({ type: 'FOOTER', text: template.footerText });
    }

    if (template.buttons?.length) {
      components.push({
        type: 'BUTTONS',
        buttons: template.buttons.map((button) => {
          if (button.type === 'PHONE_NUMBER') {
            return {
              type: 'PHONE_NUMBER',
              text: button.text,
              phone_number: button.phone_number,
            };
          }

          if (button.type === 'URL') {
            return {
              type: 'URL',
              text: button.text,
              url: button.url,
              ...(button.example?.length ? { example: button.example } : {}),
            };
          }

          return {
            type: 'QUICK_REPLY',
            text: button.text,
          };
        }),
      });
    }

    if (template.carouselCards?.length) {
      components.push({
        type: 'CAROUSEL',
        cards: template.carouselCards.map((card, index) => ({
          card_index: index,
          components: [
            {
              type: 'BODY',
              text: card.body,
            },
            ...(card.buttons?.length
              ? [{
                type: 'BUTTONS',
                buttons: card.buttons.map((button) => ({
                  type: button.type,
                  text: button.text,
                  ...(button.url ? { url: button.url } : {}),
                  ...(button.phone_number ? { phone_number: button.phone_number } : {}),
                })),
              }]
              : []),
          ],
        })),
      });
    }

    return {
      name: template.name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      category: template.category,
      language: template.language,
      components,
    };
  }

  async createTemplate(account: WhatsAppAccount, template: TemplateInput) {
    const payload = this.buildTemplatePayload(template);
    return this.graphRequest<any>(`/${account.waba_id}/message_templates`, account.access_token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async sendTemplateMessage({
    account,
    to,
    templateName,
    languageCode = 'pt_BR',
    components = [],
  }: {
    account: WhatsAppAccount;
    to: string;
    templateName: string;
    languageCode?: string;
    components?: any[];
  }) {
    return this.graphRequest<any>(`/${account.phone_id}/messages`, account.access_token, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          ...(components.length ? { components } : {}),
        },
      }),
    });
  }

  normalizeConversationMetrics(response: any) {
    const points = response?.data?.data_points || response?.data || [];
    const summary = {
      marketing: 0,
      utility: 0,
      authentication: 0,
      service: 0,
      total: 0,
      billable: 0,
    };

    for (const point of points) {
      const conversations = point?.conversation || point?.conversation_category || [];
      for (const item of conversations) {
        const category = String(item.conversation_category || item.category || '').toLowerCase();
        const value = Number(item.conversation || item.count || item.value || 0);
        if (category.includes('marketing')) summary.marketing += value;
        if (category.includes('utility')) summary.utility += value;
        if (category.includes('authentication')) summary.authentication += value;
        if (category.includes('service')) summary.service += value;
        summary.total += value;
        if (item.cost != null || item.billable) summary.billable += value;
      }
    }

    return summary;
  }

  estimateCampaignCost(category: string, volume: number, pricingTable: Record<string, number>) {
    const unitPrice = pricingTable[category.toLowerCase()] || 0;
    return Number((volume * unitPrice).toFixed(4));
  }
}

export const whatsappOfficialService = new WhatsAppOfficialService();
