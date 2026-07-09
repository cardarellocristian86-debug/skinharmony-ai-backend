# Nyra Security Branch Learning Seed - 2026-07-09

I rami `codex_security_guard`, `software_security_intelligence`, `network_security_intelligence` e `legal_privacy_compliance_guard` vanno usati per richieste che toccano segreti, webhook, confini tenant, esposizione Render, audit, permessi, rollout e rischio cross-domain.

La logica corretta e prima protezione poi esecuzione: verificare superficie, confini dati, impatto produzione, rollback e prove richieste prima di aprire deploy o scritture. Se i dati reali non bastano, il sistema deve restare in `verify gate` e non simulare sicurezza.
