# POC: Multi-LLM Provider Architecture in NestJS

A standalone proof-of-concept demonstrating how NestJS's dependency injection
(DI) system can decouple business logic from any specific LLM vendor
(OpenAI, DeepSeek, or a future provider), so the active vendor is a
**runtime configuration choice**, not a code choice.

This is a learning/reference project for a quarterly goal — it is
intentionally isolated from the production CLEARnotes codebase and makes
**no real network calls**. Every provider returns a simulated response so
the POC runs with nothing but placeholder env vars.

## Problem this solves

Without an abstraction, a codebase that calls an LLM directly ends up with
vendor-specific code (SDK calls, request/response shapes, error handling)
scattered across every service that needs AI. Switching vendors, or
supporting more than one, means hunting down every call site.

## The pattern

```
Controller → LlmService → LLM_PROVIDER (interface) → OpenAiProvider | DeepSeekProvider
                                ↑
                    resolved by a factory provider
                    based on the LLM_PROVIDER env var
```

- **`LlmProvider` interface** (`src/llm/interfaces/llm-provider.interface.ts`)
  The single contract (`getName()`, `generate()`) every vendor must satisfy.
  Nothing outside the `llm` folder ever imports a concrete provider class —
  only this interface.

- **DI token** (`src/llm/tokens/llm.tokens.ts`)
  `LLM_PROVIDER` is a `Symbol` used as an injection token. Binding an
  interface to a token (instead of a concrete class) is what lets the
  *implementation behind the token* be decided at runtime.

- **Concrete providers** (`src/llm/providers/*.provider.ts`)
  `OpenAiProvider` and `DeepSeekProvider` each implement `LlmProvider`
  independently. Adding a third vendor means adding one new file here —
  nothing else in the app changes.

- **Registry** (`src/llm/registry/llm-provider.registry.ts`)
  A Strategy-pattern lookup table (`Map<name, LlmProvider>`). This is what
  keeps vendor selection out of `if/else` or `switch` statements — the
  active vendor name is just a map key.

- **Factory provider + Dynamic module** (`src/llm/llm.module.ts`)
  `LlmModule.forRoot()` is a dynamic module that:
  1. Registers `ConfigModule` (reads `.env`)
  2. Registers both concrete providers
  3. Registers every provider into the `LlmProviderRegistry` at bootstrap
  4. Uses a **factory provider** to resolve `LLM_PROVIDER` (the token) to
     whichever concrete instance matches the `LLM_PROVIDER` env var

  This is the crux of the "swap without touching business logic" goal:
  the factory is the *only* place that knows env config exists.

- **`LlmService`** (`src/llm/llm.service.ts`)
  The façade all business logic actually depends on. It injects
  `LLM_PROVIDER` and only ever calls interface methods. This class is
  identical regardless of which vendor is active.

- **`LlmController`** (`src/llm/llm.controller.ts`)
  Demo HTTP endpoints proving the above — this file never imports
  `OpenAiProvider` or `DeepSeekProvider` directly.

## Why a factory provider + dynamic module (and not just `useClass`)

A static `useClass: OpenAiProvider` binding would require a code change (and
a rebuild) to switch vendors. A factory provider defers that decision to
runtime, driven by config — which is what "switching providers with minimal
code changes" in the goal actually requires: **zero code changes**, just an
env var.

## Running it

```bash
npm install
cp .env.example .env   # placeholders only — real keys are never used or needed
npm run start:dev
```

```bash
# Which vendor is currently active?
curl http://localhost:3000/llm/active-provider

# Ask it to "generate" (simulated — no real API call)
curl -X POST http://localhost:3000/llm/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "summarise this consultation"}'
```

Change `LLM_PROVIDER` in `.env` from `openai` to `deepseek`, restart, and
call the same two endpoints again — the response's `provider`/`model`
fields change; `LlmService`, `LlmController`, and every consumer stay
byte-for-byte identical.

## Tests

```bash
npm test
```

`src/llm/tests/llm.module.integration.spec.ts` is the key test: it boots
`LlmModule.forRoot()` twice, once per `LLM_PROVIDER` value, and asserts the
correct concrete provider was wired up each time — this is the automated
proof of "seamless switching."

## Adding a third provider

1. Create `src/llm/providers/<vendor>.provider.ts` implementing `LlmProvider`
2. Add it to `LlmModule.forRoot()`'s `providers` array and to the
   registry-bootstrap factory's `inject`/registration list
3. Add a matching env var / `.env.example` entry
4. Nothing in `LlmService`, `LlmController`, or any other consumer changes

## Non-goals / scope

- No real HTTP calls to OpenAI or DeepSeek (each provider has the real call
  sketched in a comment for reference)
- No real API keys anywhere in this repo — `.env` is git-ignored and
  `.env.example` contains placeholders only
- No AWS/Cognito/Prisma/S3/Docker — out of scope for a DI-pattern POC
- Not wired into, and has no dependency on, `33n_service_core` or any other
  CLEARnotes service
