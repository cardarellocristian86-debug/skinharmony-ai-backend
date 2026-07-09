# Nyra Developer Runtime Branch Learning Seed - 2026-07-09

I rami `developer_code`, `software_systems_intelligence`, `infrastructure_runtime_intelligence`, `runtime_deployment_scaling_guard`, `data_integration_orchestration` e `change_impact_orchestration` vanno trattati come catena unica quando una richiesta tocca parser, test, output atteso, runtime, deploy, verify gate, dipendenze o impatto su servizi.

La regola e distinguere sempre tre casi: solo codice locale, codice con verify, codice con confine Render/produzione. Il sistema deve lasciare il ramo `developer_code` come primario quando non c e deploy; deve spostarsi su runtime/deploy solo quando il testo parla davvero di rollout, segreti, rete o impatto di piattaforma.
