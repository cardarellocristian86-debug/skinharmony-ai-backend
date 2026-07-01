export function semanticDomainAllowlistForPrompt(text: string): string[] | undefined {
  const raw = String(text || '');
  if (/\banalyzer\b|skin analyzer|skinanalyzer|\bipad\b|rossore|sensibilita|discromie|pori|grana|acqua sebo|acqua_sebo|texture_linee_fini|rossore_sensibilita|discromie_uniformita|pori_grana|marker|multi-zone|topographic|\bmk\b|\byz\b|\bxw\b|\bsb\b|\byf\b|\bfs\b/i.test(raw)) return ["analyzer", "ipad"];
  if (/smartdesk|ai gold|agenda|appuntamenti|cassa|incassi|redditivita|richiamare|marketing autopilot|magazzino|fleet intelligence|god mode|protocollo|clienti da recuperare|centro sotto controllo/i.test(raw)) return ["smartdesk"];
  if (/\bsuite\b|site suite|waas|wordpress|mini crm|b2b crm|tenant|template clone|lead|bridge smart desk|page factory|plugin|claim price guard|social channels/i.test(raw)) return ["suite", "wordpress"];
  return undefined;
}
