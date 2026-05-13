export const branchDeskBase = {
  id: "front_desk_base",
  file: "branch-desk-base.js",
  tier: "base",
  label: "Front Desk Base",
  domain: "smartdesk_front_desk",
  production_status: "advisory",
  description: "Regole operative Base per agenda, clienti, cassa, recall manuale, protocolli manuali e uso non distruttivo.",
  rules: [
    "Usa solo dati reali forniti dal gestionale o dallo snapshot.",
    "Non inventare incassi, clienti, appuntamenti, prezzi o disponibilita.",
    "Ogni azione operativa deve essere proposta e confermata dall'operatore.",
    "Nel Base sono ammessi agenda, clienti, appuntamenti, cassa/incassi, marketing manuale, magazzino base e protocolli manuali.",
    "Se manca un dato, segnalarlo in modo chiaro e indicare il primo campo da compilare.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "manual_assist",
    blocked_actions: ["send_without_consent", "change_price", "delete_records", "publish_content"],
  },
};
