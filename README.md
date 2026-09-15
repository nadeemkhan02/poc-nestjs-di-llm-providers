# POC: Multi-LLM Provider Architecture in NestJS

A standalone proof-of-concept demonstrating how NestJS's dependency
injection (DI) system can decouple business logic from any specific LLM
vendor (OpenAI, DeepSeek, or a future provider), so the active vendor is a
**runtime configuration choice**, not a code choice.

This is a learning/reference project built for a quarterly goal. It is
intentionally isolated from the production CLEARnotes codebase, has no
dependency on `33n_service_core` or any other CLEARnotes service, and makes
**no real network calls** — every provider returns a simulated response so
the POC runs and is testable with nothing but placeholder env vars.

## Table of contents

- [Objective](#objective)
- [Problem this solves](#problem-this-solves)
- [Architecture at a glance](#architecture-at-a-glance)
- [Request flow, step by step](#request-flow-step-by-step)
- [DI patterns used, and why](#di-patterns-used-and-why)
- [Project structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Proving "seamless switching" end to end](#proving-seamless-switching-end-to-end)
- [Testing](#testing)
- [Adding a new LLM provider](#adding-a-new-llm-provider)
- [Design decisions and trade-offs](#design-decisions-and-trade-offs)
- [Best practices demonstrated](#best-practices-demonstrated)
- [Non-goals and scope](#non-goals-and-scope)
- [Known limitations](#known-limitations)
- [Roadmap ideas](#roadmap-ideas)

## Objective

Design and implement a scalable Multi-LLM Provider Architecture in NestJS
using dependency injection principles, demonstrating how multiple AI
providers can be integrated behind a common interface — enabling provider
selection and replacement without touching business logic.

**Deliverables and where they live in this repo:**

| Deliverable | Where |
|---|---|
| Research NestJS DI patterns for AI service integration | This README — [DI patterns used, and why](#di-patterns-used-and-why) |
| Provider abstraction layer with a common interface | `src/llm/interfaces/llm-provider.interface.ts` |
| OpenAI + DeepSeek implementations, extensible to more | `src/llm/providers/openai.provider.ts`, `src/llm/providers/deepseek.provider.ts` |
| Providers, factory providers, dynamic modules | `src/llm/llm.module.ts` |
| Validate seamless provider switching | `src/llm/tests/llm.module.integration.spec.ts` + [manual walkthrough](#proving-seamless-switching-end-to-end) |
| Document architecture and best practices | This README |

## Problem this solves

Without an abstraction, a codebase that calls an LLM directly ends up with
vendor-specific code (SDK calls, request/response shapes, error handling,
auth) scattered across every service that needs AI. Switching vendors, or
supporting more than one at once, means hunting down every call site and
editing business logic that has nothing to do with which AI vendor is in
use.

This POC's answer: business logic depends on one interface
(`LlmProvider`); which concrete implementation satisfies that interface at
runtime is a config decision, resolved once, in one place.

## Architecture at a glance

```
                          ┌─────────────────────┐
  HTTP request  ───────▶  │   LlmController      │
                          └──────────┬───────────┘
                                     │ depends only on
                                     ▼
                          ┌──────────────────────┐
                          │     LlmService        │   (vendor-agnostic façade)
                          └──────────┬───────────┘
                                     │ @Inject(LLM_PROVIDER)
                                     ▼
                          ┌──────────────────────┐
                          │  LLM_PROVIDER token   │   ◀── bound at runtime by
                          │   (LlmProvider iface) │       a factory provider
                          └──────────┬───────────┘
                                     │ resolved via
                                     ▼
                          ┌──────────────────────┐
                          │ LlmProviderRegistry   │   Map<vendorName, LlmProvider>
                          └──────────┬───────────┘
                          ┌──────────┴───────────┐
                          ▼                       ▼
                 ┌─────────────────┐    ┌─────────────────┐
                 │  OpenAiProvider  │    │ DeepSeekProvider │
                 └─────────────────┘    └─────────────────┘
                          ▲                       ▲
                          └───────────┬───────────┘
                                      │
                          env var: LLM_PROVIDER=openai|deepseek
```

Everything above the `LLM_PROVIDER` token line (`LlmController`,
`LlmService`) has zero knowledge that OpenAI or DeepSeek exist. Everything
below the line can grow (add a third, fourth, fifth vendor) without
touching anything above it.

## Request flow, step by step

1. Nest boots `AppModule`, which imports `LlmModule.forRoot()`.
2. `LlmModule.forRoot()` registers `ConfigModule` (loads `.env`),
   `OpenAiProvider`, `DeepSeekProvider`, `LlmProviderRegistry`, a bootstrap
   provider, the `LLM_PROVIDER` factory provider, and `LlmService`.
3. At startup, the bootstrap provider runs once: it asks Nest for the
   already-instantiated `OpenAiProvider` and `DeepSeekProvider` and
   registers each into `LlmProviderRegistry` under its own vendor name.
4. The `LLM_PROVIDER` factory provider runs next (Nest's DI graph forces
   this ordering — see [Design decisions](#design-decisions-and-trade-offs)).
   It reads the `LLM_PROVIDER` env var via `ConfigService` and asks the
   registry for the matching provider instance. Whatever it returns becomes
   the singleton bound to the `LLM_PROVIDER` token for the app's lifetime.
5. A request hits `POST /llm/generate`. `LlmController` validates the body
   against `GenerateDto` (via the global `ValidationPipe`) and calls
   `LlmService.generate(...)`.
6. `LlmService` calls `.generate()` on whatever `LlmProvider` it was
   injected with — it has no branch, no `if (vendor === 'openai')`, no
   knowledge of which vendor it's holding.
7. The concrete provider (`OpenAiProvider` or `DeepSeekProvider`) returns an
   `LlmResponse`. In this POC that response is simulated (see
   [Known limitations](#known-limitations)); a real provider would make the
   actual vendor API call here instead.

## DI patterns used, and why

### 1. Interface-based abstraction (`LlmProvider`)

```ts
export interface LlmProvider {
  getName(): string;
  generate(prompt: string, options?: LlmGenerateOptions): Promise<LlmResponse>;
}
```

The interface is the contract. Nothing outside `src/llm/providers/` ever
imports a concrete provider class — only this interface, via the DI token
below. This is what makes vendors interchangeable: TypeScript's structural
typing means any class implementing this shape can stand in for any other.

### 2. DI tokens (`LLM_PROVIDER`)

```ts
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
```

NestJS's DI container binds providers by *token*, not by class reference,
whenever you use the `provide` / `useFactory` / `useClass` / `useValue`
provider shape. A `Symbol` (rather than a string) avoids any accidental
collision with another token of the same name elsewhere in a larger app.
Binding an *interface* to a *token* — rather than injecting a concrete class
directly — is the mechanism that lets the implementation behind that token
be decided at runtime instead of at compile time.

### 3. Strategy pattern via a registry (`LlmProviderRegistry`)

```ts
@Injectable()
export class LlmProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();
  register(provider: LlmProvider): void { this.providers.set(provider.getName(), provider); }
  get(name: string): LlmProvider { /* throws a clear error if not found */ }
}
```

This is what keeps vendor selection out of `if/else` or `switch`
statements. Each concrete provider self-registers under its own name;
picking one is a `Map.get(name)` lookup. Adding a new vendor never means
editing this class.

### 4. Factory providers

```ts
const llmProviderFactory: Provider = {
  provide: LLM_PROVIDER,
  inject: [ConfigService, LlmProviderRegistry, 'LLM_PROVIDER_BOOTSTRAP'],
  useFactory: (configService, registry) =>
    registry.get(configService.get('LLM_PROVIDER', LlmVendor.OPENAI)),
};
```

A factory provider is how you tell Nest "don't just instantiate a class —
run this function, with these other providers injected as arguments, and
use whatever it returns as the value for this token." This is the exact
mechanism that turns an env var into a concrete class instance at
application bootstrap, with the decision made in exactly one place.

The `'LLM_PROVIDER_BOOTSTRAP'` entry in `inject` isn't used inside the
factory body — it exists purely to make Nest's dependency graph
instantiate the bootstrap provider (which populates the registry) *before*
this factory runs. Without that edge, provider instantiation order would
depend on incidental array ordering rather than an explicit dependency.

### 5. Dynamic modules (`LlmModule.forRoot()`)

```ts
@Module({})
export class LlmModule {
  static forRoot(): DynamicModule {
    return {
      module: LlmModule,
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [ /* ... */ ],
      exports: [LlmService],
      global: true,
    };
  }
}
```

A dynamic module is a module whose provider list is computed by a static
method rather than hard-coded in the `@Module()` decorator. This keeps all
the wiring (config loading, concrete providers, registry, factory) in one
place (`llm.module.ts`), so `app.module.ts` stays a one-line import and
the module is self-sufficient enough to be dropped into another app.

## Project structure

```
src/
  app.module.ts              Root module — imports LlmModule.forRoot()
  app.controller.ts           Default Nest health-check controller (untouched scaffold)
  app.service.ts
  main.ts                     Bootstrap: global ValidationPipe
  llm/
    interfaces/
      llm-provider.interface.ts   LlmProvider contract, LlmResponse, LlmGenerateOptions
    tokens/
      llm.tokens.ts                LLM_PROVIDER symbol, LlmVendor enum
    providers/
      openai.provider.ts           Simulated OpenAI implementation
      deepseek.provider.ts         Simulated DeepSeek implementation
    registry/
      llm-provider.registry.ts     Strategy-pattern lookup table
    dto/
      generate.dto.ts               class-validator request DTO
    llm.module.ts                   Dynamic module + factory provider (the core of this POC)
    llm.service.ts                  Vendor-agnostic façade
    llm.controller.ts               Demo REST endpoints
    tests/
      llm-provider.registry.spec.ts
      openai.provider.spec.ts
      deepseek.provider.spec.ts
      llm.service.spec.ts
      llm.controller.spec.ts
      llm.module.integration.spec.ts   ← the "seamless switching" proof
test/
  app.e2e-spec.ts, jest-e2e.json    Default Nest e2e scaffold
.env.example                        Placeholder env vars — copy to .env
```

## Prerequisites

- Node.js 18+ (developed and tested on Node 24)
- npm
- Nothing else — no Docker, no database, no AWS account, no real API keys

## Getting started

```bash
git clone https://github.com/nadeemkhan02/poc-nestjs-di-llm-providers.git
cd poc-nestjs-di-llm-providers
npm install
cp .env.example .env   # placeholders only — see below
npm run start:dev
```

The app listens on `http://localhost:3000` (or `$PORT` if set).

## Environment variables

All values in `.env.example` are placeholders. Because this POC never
makes a real network call, any string works for the API key variables —
they exist to demonstrate realistic config wiring (`ConfigService`
injection, env-driven behavior), not to authenticate against a real
vendor.

| Variable | Purpose | Example |
|---|---|---|
| `LLM_PROVIDER` | Which registered vendor `LlmService` resolves to. Must match a name a provider registers itself under (see `LlmVendor` in `llm.tokens.ts`). | `openai` or `deepseek` |
| `OPENAI_API_KEY` | Placeholder only, never sent anywhere in this POC. | `your-openai-api-key-placeholder` |
| `OPENAI_MODEL` | Model name `OpenAiProvider` reports in its simulated response. | `gpt-4o-mini` |
| `DEEPSEEK_API_KEY` | Placeholder only, never sent anywhere in this POC. | `your-deepseek-api-key-placeholder` |
| `DEEPSEEK_MODEL` | Model name `DeepSeekProvider` reports in its simulated response. | `deepseek-chat` |
| `PORT` | HTTP port for `main.ts` to listen on. | `3000` |

**Never commit a real API key to this repo.** `.env` is git-ignored;
`.env.example` is the only file meant to be committed, and it must stay
placeholder-only.

## API reference

### `GET /llm/active-provider`

Returns which vendor is currently wired up.

```bash
curl http://localhost:3000/llm/active-provider
```

```json
{ "activeProvider": "openai" }
```

### `POST /llm/generate`

Runs the active provider's (simulated) `generate()`.

Request body (`GenerateDto`, validated with `class-validator`,
`whitelist: true`, `forbidNonWhitelisted: true`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `prompt` | `string` | yes | |
| `maxTokens` | `number` | no | must be ≥ 1 |
| `temperature` | `number` | no | |

```bash
curl -X POST http://localhost:3000/llm/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "summarise this consultation", "maxTokens": 100}'
```

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "text": "[simulated openai response] \"summarise this consultation\""
}
```

An unknown field or missing `prompt` returns `400 Bad Request` with a
descriptive `message` array, e.g.:

```json
{ "message": ["property unknownField should not exist"], "error": "Bad Request", "statusCode": 400 }
```

## Proving "seamless switching" end to end

This is the core claim of the POC — verified two ways:

**1. Automated** — `src/llm/tests/llm.module.integration.spec.ts` boots
`LlmModule.forRoot()` twice in the same test file, once with
`process.env.LLM_PROVIDER = 'openai'` and once with `'deepseek'`, and
asserts `LlmService.getActiveVendor()` and `.generate()` resolve to the
correct vendor each time — with `LlmService`'s own source code never
changing between runs.

**2. Manual**, if you want to see it with your own eyes:

```bash
npm run build

LLM_PROVIDER=openai PORT=3111 node dist/main.js &
curl http://localhost:3111/llm/active-provider   # {"activeProvider":"openai"}
kill %1

LLM_PROVIDER=deepseek PORT=3111 node dist/main.js &
curl http://localhost:3111/llm/active-provider   # {"activeProvider":"deepseek"}
kill %1
```

Same compiled `dist/main.js`, same `LlmController`/`LlmService` source,
only the env var changed.

## Testing

```bash
npm test           # unit + integration tests, single run
npm run test:watch # watch mode
npm run test:cov   # coverage report
```

Current coverage: 7 spec files / 16 tests, spanning:
- `LlmProviderRegistry` (register/get/list/unknown-vendor error)
- `OpenAiProvider` / `DeepSeekProvider` (vendor name, simulated response, env fallback)
- `LlmService` (delegates to whatever provider was injected)
- `LlmController` (delegates to `LlmService`, doesn't reimplement logic)
- `LlmModule` integration (the provider-switching proof, plus a
  fail-fast check for an unregistered `LLM_PROVIDER` value)

## Adding a new LLM provider

1. Add a name to `LlmVendor` in `src/llm/tokens/llm.tokens.ts`.
2. Create `src/llm/providers/<vendor>.provider.ts` implementing
   `LlmProvider` (copy `openai.provider.ts` as a template).
3. In `src/llm/llm.module.ts`:
   - add the new provider class to the `providers` array
   - add it to the bootstrap factory's `inject` array and register it
     inside that factory's body
4. Add `<VENDOR>_API_KEY` / `<VENDOR>_MODEL` (or whatever config it needs)
   to `.env.example`.
5. Add a `*.provider.spec.ts` test mirroring the existing ones.

**Nothing in `LlmService`, `LlmController`, or any future consumer changes.**
That's the point of the abstraction.

## Design decisions and trade-offs

- **Factory provider instead of `useClass: OpenAiProvider`.** A static
  `useClass` binding is a compile-time decision — switching vendors would
  require a code change and a rebuild. A factory provider defers the
  decision to runtime config, which is what "switch providers with minimal
  code changes" actually requires: zero code changes, one env var.
- **Registry (Strategy pattern) instead of a `switch` on vendor name.** A
  `switch` statement grows by one `case` per vendor and lives in whichever
  file happens to contain it. A registry is a flat, append-only lookup
  table that any provider can register into from anywhere, with no shared
  file to merge-conflict over as the app scales.
- **`Symbol` token instead of a string token.** Strings can collide with
  another token of the same literal value elsewhere in a larger
  application; symbols cannot.
- **An explicit `'LLM_PROVIDER_BOOTSTRAP'` dependency edge**, rather than
  relying on provider array order, to guarantee the registry is populated
  before the factory provider reads from it. Nest's DI resolves providers
  by dependency graph, not by array position — an implicit ordering
  assumption would be fragile.
- **`forRoot()` over `forRootAsync()`.** This POC's config source
  (`ConfigService` reading `.env`) is synchronous and available at module
  definition time, so `forRoot()` is sufficient. A `forRootAsync()`
  variant would be the natural extension if provider selection ever needed
  to depend on an async source (e.g., a remote feature-flag service).

## Best practices demonstrated

- Depend on interfaces, not concrete classes, across module boundaries
- Keep all vendor-specific code inside `src/llm/providers/` — nothing else
  in the app imports those files directly
- Fail fast and loud: an unknown `LLM_PROVIDER` value throws a descriptive
  error at bootstrap, not a silent fallback or a runtime `undefined`
- Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` so
  unexpected request fields are rejected, not silently ignored
- Co-locate tests per unit (`*.spec.ts` next to what they test, mirroring
  this repo's module) and add one integration test that proves the
  cross-cutting behavior (provider switching) that no single unit test can

## Non-goals and scope

- No real HTTP calls to OpenAI or DeepSeek (each provider has the real
  call sketched in a comment for reference)
- No real API keys anywhere in this repo — `.env` is git-ignored and
  `.env.example` contains placeholders only
- No AWS/Cognito/Prisma/S3/Docker — out of scope for a DI-pattern POC
- Not wired into, and has no runtime dependency on, `33n_service_core` or
  any other CLEARnotes service — this is a standalone learning repo

## Known limitations

- Responses are simulated strings, not real model output — this POC
  validates the *architecture*, not model quality or latency
- No retry/backoff, rate-limiting, or streaming — a real integration would
  need all three; the interface (`LlmProvider.generate()`) is shaped to
  make adding them straightforward without changing consumers
- No authentication/authorization on the demo endpoints — this is a local
  learning app, not a deployable service

## Roadmap ideas

- Wire a real HTTP call behind one provider (guarded by an env flag) to
  demonstrate the interface holding up against a real vendor response
  shape
- Add a `forRootAsync()` variant for config sourced asynchronously
- Add a streaming variant of `LlmProvider.generate()` (`AsyncIterable`)
  once a real vendor call exists to stream from
