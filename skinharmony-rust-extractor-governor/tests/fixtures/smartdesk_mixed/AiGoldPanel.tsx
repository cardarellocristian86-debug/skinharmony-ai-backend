export function AiGoldPanel() {
  const supportToken = "sk_live_should_not_export";
  const hiddenRoute = "/api/ai-gold/ask";
  const centerName = "Privilege Parrucchieri";

  return (
    <main aria-label="AI Gold cockpit">
      <section>
        <p>Core/Nyra server on top</p>
        <h1>AI Gold - what to do now</h1>
        <p>Il gestionale dice cosa sta succedendo. AI Gold dice cosa fare.</p>
        <button>Mostra cosa fare ora</button>
      </section>

      <section aria-label="Datenqualität">
        <h2>Datenqualität</h2>
        <p>Mancano informazioni per completare l'analisi.</p>
        <button>Agenda öffnen</button>
        <button>Mostra periodo</button>
      </section>

      <aside>
        <p>Clients to recall / at risk</p>
        <strong>Carlo Rossi</strong>
        <button>Da richiamare</button>
      </aside>

      <input placeholder="Business email" data-center={centerName} />
      <span className="hidden-token">{supportToken}</span>
      <span data-route={hiddenRoute}>route tecnico da non catalogare</span>
    </main>
  );
}
