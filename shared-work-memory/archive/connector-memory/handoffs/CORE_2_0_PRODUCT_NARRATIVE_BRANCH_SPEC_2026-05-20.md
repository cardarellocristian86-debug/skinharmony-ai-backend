# CORE_2_0_PRODUCT_NARRATIVE_BRANCH_SPEC_2026-05-20

## Nome ramo
`product_narrative_orchestration`

## Scopo
Selezionare il modo corretto di raccontare un prodotto prima che Nyra scriva il copy.

## Input minimi
- brand
- target
- product family
- pricing positioning
- source site reference
- formulation snapshot

## Output attesi
- `narrative_mode`
- `tone_mode`
- `claim_intensity`
- `source_site_usage_mode`
- `sector_pack`
- `repetition_pressure`
- `recommended_structure`
- `blocked_terms`
- `allowed_cta_mode`

## Narrative mode
Valori iniziali:
- `hero_active`
- `formula_profile`
- `ritual_experience`
- `professional_solution`

## Tone mode
Valori iniziali:
- `premium_soft`
- `clinical_soft`
- `professional_authoritative`
- `consumer_clear`

## Sector pack
Valori iniziali:
- `beauty_luxury`
- `beauty_professional`
- `beauty_retail`
- `hair_professional`
- `wellness_ritual`

## Repetition pressure
Valori iniziali:
- `low`
- `medium`
- `high`

## Claim intensity
Valori iniziali:
- `ready`
- `conservative`
- `review_required`

## Source site usage mode
Valori iniziali:
- `style_reference_only`
- `structure_reference`
- `full_layout_reference`

## Regole
1. Se il sito madre esiste, usarlo come riferimento di:
   - tono
   - gerarchia
   - densità narrativa
   - struttura blocchi
2. Non copiare il testo del sito madre.
3. Se il prodotto ha attivi forti solo in traccia e profilo formula ricco:
   - preferire `formula_profile` o `ritual_experience`
4. Se il prodotto ha attivo forte chiaro e ben posizionato:
   - consentire `hero_active`
5. Nyra riceve il ramo selezionato e scrive solo dentro quel perimetro.
6. Se `repetition_pressure = high`, Nyra deve evitare eco lessicali e strutture ripetitive.
7. Se `source_site_usage_mode` e diverso da `style_reference_only`, il connector deve comunque vietare frasi troppo simili alla sorgente.

## Regola linguaggio
Bloccare nei testi pagina termini interni non cliente-facing:
- monolite
- payload
- bridge
- workflow
- orchestration
- runtime

## CTA mode
Valori iniziali:
- `discover`
- `consultation`
- `request_quote`
- `professional_presentation`

## Struttura raccomandata
- hero
- emotional tension
- formula reading
- audience fit
- benefits
- faq
- cta
