# Responsible AI

SpeechBridge uses Azure AI Speech to recognise, translate and synthesise human speech.
Speech is personal data, and translation carries real consequences when it is wrong. This
note describes what the system does, where it is weak, and what you owe the people using it.

## What it does

Audio captured from the microphone is streamed to Azure AI Speech, which returns a
transcription and a translation. The translation is synthesised into audio with a neural
voice and played to the other participant. Nothing is stored by this application: no audio
files, no transcripts, no database. The on-screen conversation history lives in browser
memory and disappears when the tab closes.

## Intended use

A demonstration of near-realtime interpreted conversation between two people who do not
share a language, in low-stakes settings: an internal meeting, a customer conversation
about non-critical matters, a proof of concept.

## Uses you should refuse

Machine translation is confidently wrong in ways humans are not. Do not use this — or any
unattended machine interpretation — where a mistranslation causes harm:

- **Medical** consultations, diagnoses, consent, or medication instructions
- **Legal** proceedings, contracts, statements, or advice
- **Emergency and safety-critical** communication
- **Immigration, asylum, or law-enforcement** interviews
- Any setting where a **qualified human interpreter** is required by law or policy

These are exactly the settings where interpretation matters most, and exactly where the
failure modes below are least acceptable.

## Known limitations

**Accuracy varies by language and by speaker.** Recognition is weaker for accents,
dialects and code-switching that are under-represented in training data, and for the lower
resourced languages in the catalogue. Errors compound: a misrecognised word becomes a
confidently mistranslated sentence, with nothing in the interface signalling doubt.

**No confidence is shown.** The interface displays translations as plain statements. It does
not indicate uncertainty, so a wrong translation looks exactly like a right one.

**Sentences are split on pauses.** End-of-utterance is detected after 350 ms of silence, so a
speaker who pauses mid-thought may have their sentence cut in two and translated as two
fragments, losing meaning that depended on the whole.

**Context is not carried between turns.** Each utterance is translated in isolation, so
pronouns, ellipsis and running references can resolve incorrectly.

**Gender and formality are guessed.** Translating into languages that mark grammatical
gender or formality (T-V distinction) requires information English often does not carry.
The service picks something; it may be wrong, and being misgendered is not a trivial error.

**Profanity is masked by default** by Azure Speech, which can itself alter meaning.

## Obligations if you deploy this

- **Tell people they are being recorded and machine-translated**, before they speak. Consent
  is not implied by a microphone icon, and recording laws vary by jurisdiction.
- **Say that it is a machine.** People calibrate trust differently for a machine than for a
  human interpreter, and they are entitled to know which they are getting.
- **Provide a human alternative** for anything consequential.
- **Do not add logging of audio or transcripts** without a lawful basis, a retention policy,
  and a way for people to opt out. The absence of storage in this accelerator is a deliberate
  privacy default; removing it is a decision with obligations attached.

## Azure service behaviour

This application does not store data, but the Azure services it calls have their own
behaviour and commitments. Review these for your deployment:

- [Transparency note for Azure AI Speech](https://learn.microsoft.com/legal/cognitive-services/speech-service/speech-to-text/transparency-note)
- [Data, privacy, and security for Azure AI Speech](https://learn.microsoft.com/legal/cognitive-services/speech-service/data-privacy-security)
- [Microsoft Responsible AI Standard](https://www.microsoft.com/ai/responsible-ai)
- [Azure AI Foundry code of conduct](https://learn.microsoft.com/legal/cognitive-services/openai/code-of-conduct)

Region matters: your Azure AI Services account is provisioned in a region you choose, and
processing happens there. Pick one consistent with your data-residency obligations.
