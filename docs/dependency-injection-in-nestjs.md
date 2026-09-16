# Dependency Injection in NestJS: Building a Multi-LLM Provider Architecture

Software architecture rarely announces itself as important. It usually shows up disguised as a small ticket. Ours read: *"the app should be able to talk to more than one LLM, and the customer should be able to choose which one, without us shipping a new build every time."*

That single sentence is why this post exists. What looked like a config tweak turned into a real lesson in **Dependency Injection (DI)** — what it is, why NestJS is built around it, and how it let us swap AI vendors with a one-line environment variable instead of a redeploy.

In this post, I'll walk through what DI actually means, the problem that forced our hand, the architecture we landed on, and the exact implementation, step by step, with the real code from the project. Whether you're new to NestJS or you've used `@Injectable()` a hundred times without thinking about what it's really doing, this should give you a working mental model you can reuse on your own multi-provider problems.

## The Problem: One App, Several LLM Vendors

If you've ever maintained a service that calls a single AI vendor, you know it starts simple: import the SDK, call it, done. The trouble starts the moment a second vendor enters the picture. The challenges go beyond just adding another API call:

- **Every vendor has its own SDK shape.** OpenAI's request/response format isn't DeepSeek's. A naive integration bakes vendor-specific shapes into whatever service calls it.
- **The choice has to be a runtime decision, not a code decision.** Different customers want different vendors — for cost, for compliance, for latency. Nobody wants a rebuild and redeploy just to flip that switch.
- **More vendors are always coming.** Whatever we built for vendor #2 had to not require rewriting anything when vendor #3 showed up.
- **Business logic shouldn't know or care which vendor is active.** The code that turns a prompt into a response has nothing to do with whose API key is in play.

These constraints make "just call the LLM" a genuinely different problem from "call whichever LLM the customer configured, and let us add more without touching what already works."

The instinctive first attempt looks like this:

```ts
class LlmService {
  async generate(prompt: string) {
    if (process.env.LLM_PROVIDER === 'openai') {
      return callOpenAi(prompt);
    } else if (process.env.LLM_PROVIDER === 'deepseek') {
      return callDeepSeek(prompt);
    }
    throw new Error('Unknown provider');
  }
}
```

It works for exactly one vendor swap before it becomes a liability. Every new vendor adds another `else if`. Vendor-specific SDK calls, auth headers, and response parsing all end up living inside code that's supposed to be about business logic, not about who's currently answering the phone.

## Why Dependency Injection Makes Sense

After running into this wall, the fix wasn't a clever trick — it was going back to a principle NestJS is built entirely around: **don't let a class build the things it depends on; hand those things to it instead.**

**It decouples business logic from vendor code.**
A service that depends on an `LlmProvider` interface, instead of a concrete `OpenAiClient` or `DeepSeekClient`, never has to change when a vendor's SDK changes, or when a new vendor is added. TypeScript's structural typing means anything that implements the interface's shape can stand in for anything else that does.

**Switching providers is a runtime decision, not a redeploy.**
With the vendor bound to a DI *token* rather than hard-coded into an import, which concrete class fills that token is decided once, at application bootstrap, from configuration — not baked into the compiled code.

**It scales without breaking anything already working.**
Adding a sixth vendor means adding a class and a couple of registration lines. It never means touching the service, the controller, or any other consumer that already works today.

**It's testable by design.**
Inject a fake `LlmProvider` in a test and you can assert business logic in complete isolation from any real vendor, any network call, any flakiness.

NestJS doesn't just make this pattern possible — it's the backbone of the framework. Three pieces do the work: the **IoC container** (builds the dependency graph and instantiates classes for you, instead of you calling `new` everywhere), **providers** (anything Nest can inject — a service, a value, or the result of a factory function bound to a token), and **modules** (which group providers and controllers, and can even compute their provider list dynamically at runtime).

## Architecture That Works

Here's the shape we landed on:

```
                        ┌─────────────────────┐
HTTP request ────────▶ │   LlmController      │
                        └──────────┬───────────┘
                                   │ depends only on
                                   ▼
                        ┌──────────────────────┐
                        │     LlmService        │  (vendor-agnostic)
                        └──────────┬───────────┘
                                   │ @Inject(LLM_PROVIDER)
                                   ▼
                        ┌──────────────────────┐
                        │  LLM_PROVIDER token   │  ◀── bound at runtime
                        └──────────┬───────────┘
                                   │ resolved via
                                   ▼
                        ┌──────────────────────┐
                        │ LlmProviderRegistry   │  Map<vendor, LlmProvider>
                        └──────────┬───────────┘
                        ┌──────────┴───────────┐
                        ▼                       ▼
               ┌─────────────────┐    ┌─────────────────┐
               │  OpenAiProvider  │    │ DeepSeekProvider │
               └─────────────────┘    └─────────────────┘
                                  ▲
                    env var: LLM_PROVIDER=openai|deepseek
```

### Core components

1. **`LlmProvider` interface** — the contract every vendor implementation has to satisfy.
2. **Concrete providers** (`OpenAiProvider`, `DeepSeekProvider`) — one class per vendor, each self-contained.
3. **`LlmProviderRegistry`** — a lookup table mapping vendor name to provider instance.
4. **A factory provider bound to `LLM_PROVIDER`** — reads config, asks the registry for the right instance, and that becomes the app-wide singleton.
5. **`LlmModule.forRoot()`** — a dynamic module wiring all of the above into one self-contained unit.
6. **`LlmService` / `LlmController`** — the consumers, which know none of the above exists.

### The request flow, step by step

1. Nest boots `AppModule`, which imports `LlmModule.forRoot()`.
2. `LlmModule.forRoot()` registers `ConfigModule`, both concrete providers, the registry, a bootstrap provider, the `LLM_PROVIDER` factory provider, and `LlmService`.
3. At startup, the bootstrap provider runs once: it takes the already-instantiated `OpenAiProvider` and `DeepSeekProvider` and registers each into `LlmProviderRegistry` under its own vendor name.
4. The `LLM_PROVIDER` factory provider runs next. It reads the `LLM_PROVIDER` env var via `ConfigService` and asks the registry for the matching instance. Whatever it returns becomes the singleton bound to the `LLM_PROVIDER` token for the app's lifetime.
5. A request hits `POST /llm/generate`. `LlmController` validates the body and calls `LlmService.generate(...)`.
6. `LlmService` calls `.generate()` on whatever `LlmProvider` it was injected with — no branch, no vendor name in sight.
7. The concrete provider returns an `LlmResponse`. A real integration would make the actual vendor API call at this exact point.

## Technical Implementation

Let's get into the actual code — every snippet below is real, from the project.

### Defining the contract

Before writing any vendor code, we wrote the interface every vendor has to honor:

```ts
// src/llm/interfaces/llm-provider.interface.ts
export interface LlmGenerateOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface LlmResponse {
  provider: string;
  model: string;
  text: string;
}

export interface LlmProvider {
  getName(): string;
  generate(prompt: string, options?: LlmGenerateOptions): Promise<LlmResponse>;
}
```

Nothing outside `src/llm/providers/` is allowed to import a concrete provider class from here on — only this interface.

### DI tokens

Interfaces disappear at compile time, so Nest needs something real to key its container on:

```ts
// src/llm/tokens/llm.tokens.ts
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export enum LlmVendor {
  OPENAI = 'openai',
  DEEPSEEK = 'deepseek',
}
```

We used a `Symbol` rather than a plain string — it costs nothing, and guarantees this token can never collide with an unrelated `'LLM_PROVIDER'` string token elsewhere in a larger app.

### Concrete provider implementations

Each vendor gets its own class implementing `LlmProvider`, injecting `ConfigService` for its own credentials rather than reaching into `process.env` directly:

```ts
// src/llm/providers/openai.provider.ts
@Injectable()
export class OpenAiProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get('OPENAI_API_KEY', 'placeholder-openai-key');
    this.model = this.configService.get('OPENAI_MODEL', 'gpt-4o-mini');
  }

  getName(): string {
    return LlmVendor.OPENAI;
  }

  generate(prompt: string, options?: LlmGenerateOptions): Promise<LlmResponse> {
    // A real integration calls the OpenAI API here.
    return Promise.resolve({
      provider: this.getName(),
      model: this.model,
      text: `[simulated openai response] "${prompt}"`,
    });
  }
}
```

`DeepSeekProvider` is a mirror image, reading `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` instead. Neither class knows the other exists.

### The registry, instead of an if/else

Each provider **registers itself** into a lookup table — the Strategy pattern — rather than living inside a growing conditional:

```ts
// src/llm/registry/llm-provider.registry.ts
@Injectable()
export class LlmProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();

  register(provider: LlmProvider): void {
    this.providers.set(provider.getName(), provider);
  }

  get(name: string): LlmProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(
        `Unknown LLM provider "${name}". Registered providers: ${[...this.providers.keys()].join(', ')}`,
      );
    }
    return provider;
  }
}
```

Adding a sixth vendor never means editing this file.

### The factory provider: turning an env var into an instance

A **factory provider** tells Nest: "don't just instantiate a class for this token — run this function, inject these arguments, and bind whatever it returns."

```ts
// src/llm/llm.module.ts (excerpt)
const llmProviderFactory: Provider = {
  provide: LLM_PROVIDER,
  inject: [ConfigService, LlmProviderRegistry, 'LLM_PROVIDER_BOOTSTRAP'],
  useFactory: (configService: ConfigService, registry: LlmProviderRegistry) => {
    const activeVendor = configService.get('LLM_PROVIDER', LlmVendor.OPENAI);
    return registry.get(activeVendor);
  },
};
```

The `'LLM_PROVIDER_BOOTSTRAP'` entry in `inject` is never touched inside the factory body — its only job is to force Nest's dependency graph to build the bootstrap provider first, guaranteeing the registry is populated before this factory reads from it.

### Wiring it into a dynamic module

A dynamic module computes its provider list via a static method instead of hard-coding it in the decorator, keeping all the wiring in one place:

```ts
// src/llm/llm.module.ts
@Module({})
export class LlmModule {
  static forRoot(): DynamicModule {
    return {
      module: LlmModule,
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [
        OpenAiProvider,
        DeepSeekProvider,
        LlmProviderRegistry,
        llmProviderBootstrap,
        llmProviderFactory,
        LlmService,
      ],
      exports: [LlmService],
      global: true,
    };
  }
}
```

`app.module.ts` stays almost embarrassingly simple: `imports: [LlmModule.forRoot()]`.

### Consuming it, knowing nothing

Here's the entire service that uses the LLM:

```ts
// src/llm/llm.service.ts
@Injectable()
export class LlmService {
  constructor(@Inject(LLM_PROVIDER) private readonly provider: LlmProvider) {}

  getActiveVendor(): string {
    return this.provider.getName();
  }

  generate(prompt: string, options?: LlmGenerateOptions): Promise<LlmResponse> {
    return this.provider.generate(prompt, options);
  }
}
```

And the controller on top of it never imports a vendor class either:

```ts
// src/llm/llm.controller.ts
@Controller('llm')
export class LlmController {
  constructor(private readonly llmService: LlmService) {}

  @Get('active-provider')
  getActiveProvider() {
    return { activeProvider: this.llmService.getActiveVendor() };
  }

  @Post('generate')
  async generate(@Body() dto: GenerateDto) {
    return this.llmService.generate(dto.prompt, {
      maxTokens: dto.maxTokens,
      temperature: dto.temperature,
    });
  }
}
```

## Security and Configuration Considerations

Even in a proof-of-concept with no real vendor calls, a few habits carry straight into production:

- **Never commit real API keys.** `.env` is git-ignored; `.env.example` holds placeholders only, and that's the only file meant to be committed.
- **Read all secrets through `ConfigService`, never `process.env` directly**, inside provider classes. It's one seam, and it's mockable in tests.
- **Global `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`** on every request DTO, so an unexpected field is rejected outright instead of silently ignored — this matters more, not less, once you're forwarding user-supplied prompts to a third-party vendor.
- **Fail fast and loud on bad configuration.** An unrecognized `LLM_PROVIDER` value throws a descriptive error at bootstrap. A silent fallback to some default vendor would be far worse — it would look like it worked while quietly sending traffic to the wrong place.

## Advanced Patterns That Make a Difference

A couple of details in this design look small but matter a lot once the app grows.

**Symbol tokens instead of string tokens.**
`Symbol('LLM_PROVIDER')` guarantees uniqueness in a way a string literal never can. In a larger application with multiple modules, two unrelated features reusing the string `'LLM_PROVIDER'` as a token would silently collide; two `Symbol()` calls never can.

**An explicit bootstrap dependency, not array-order luck.**

```ts
{
  provide: 'LLM_PROVIDER_BOOTSTRAP',
  inject: [LlmProviderRegistry, OpenAiProvider, DeepSeekProvider],
  useFactory: (registry, openAiProvider, deepSeekProvider) => {
    registry.register(openAiProvider);
    registry.register(deepSeekProvider);
    return true;
  },
}
```

Nest resolves providers by dependency graph, not by their position in the `providers` array. Depending on `'LLM_PROVIDER_BOOTSTRAP'` from the main factory turns "the registry happens to be populated first" into a guarantee the framework itself enforces.

**`forRootAsync()` as the natural next step.**
This project's config source (`ConfigService` reading `.env`) is synchronous and available at module definition time, so `forRoot()` is enough. The moment provider selection needs to come from something asynchronous — a remote feature-flag service, a database lookup — `forRootAsync()` is the same pattern with an async factory, no redesign required.

## Benefits and Outcomes

Once this was in place, the payoff showed up immediately:

- **Zero code changes to add a vendor.** A new class, two registration lines, one `.env` entry — nothing in `LlmService`, `LlmController`, or any other consumer changes.
- **Vendor switching became a one-line config change**, verifiable without touching a line of business logic.
- **Tests got dramatically simpler.** `LlmService`'s tests inject a fake `LlmProvider` and assert delegation — no vendor SDK, no network mocking, no flakiness.
- **Vendor-specific bugs stay vendor-specific.** A bug in how `DeepSeekProvider` builds its request body can't leak into `OpenAiProvider` or `LlmService`, because nothing shares code across that boundary except the interface.

## Common Challenges (And How I Solved Them)

**"Which provider gets built first?"**
The registry needs both concrete providers registered before the factory reads from it — but Nest doesn't guarantee array order. The fix was making that ordering an explicit DI dependency (the `'LLM_PROVIDER_BOOTSTRAP'` token above) instead of hoping array position held.

**"What happens with a typo in `LLM_PROVIDER`?"**
Early on, an unrecognized value silently fell through. We changed `LlmProviderRegistry.get()` to throw immediately, naming the bad value and listing what's actually registered — a bootstrap-time crash is far easier to diagnose than a runtime `undefined` three layers deep.

**"How do we prove switching actually works, not just that it compiles?"**
Unit tests alone can't prove this — they test one provider or the registry in isolation. The fix was a dedicated integration test that boots the whole module twice, once per vendor, and asserts the resolved instance differs each time.

## Environment Setup

All values below are placeholders — this proof-of-concept never makes a real network call, so any string works for the key variables. They exist to demonstrate realistic config wiring, not to authenticate against a real vendor.

```bash
# .env
LLM_PROVIDER=openai

OPENAI_API_KEY=your-openai-api-key-placeholder
OPENAI_MODEL=gpt-4o-mini

DEEPSEEK_API_KEY=your-deepseek-api-key-placeholder
DEEPSEEK_MODEL=deepseek-chat

PORT=3000
```

```bash
git clone https://github.com/nadeemkhan02/poc-nestjs-di-llm-providers.git
cd poc-nestjs-di-llm-providers
npm install
cp .env.example .env
npm run start:dev
```

## Testing Your Setup

The core claim — "seamless switching" — is checked two ways.

**Automated**, via an integration test that boots `LlmModule.forRoot()` twice in the same file, once per vendor, and asserts `LlmService.getActiveVendor()` and `.generate()` resolve correctly each time, with `LlmService`'s own source never changing:

```bash
npm test           # unit + integration tests, single run
npm run test:cov   # coverage report
```

**Manual**, against the actual compiled build, if you want to see it with your own eyes:

```bash
npm run build

LLM_PROVIDER=openai PORT=3111 node dist/main.js &
curl http://localhost:3111/llm/active-provider   # {"activeProvider":"openai"}
kill %1

LLM_PROVIDER=deepseek PORT=3111 node dist/main.js &
curl http://localhost:3111/llm/active-provider   # {"activeProvider":"deepseek"}
```

Same compiled `dist/main.js`, same controller and service source — only the environment variable changed.

## What's Next?

A few natural extensions, not yet built:

- **Wire a real HTTP call behind one provider**, guarded by an env flag, to prove the interface holds up against a real vendor response shape instead of a simulated one.
- **Add a `forRootAsync()` variant** for a config source that's asynchronous — a remote feature-flag service deciding the active vendor, for example.
- **Add a streaming variant of `LlmProvider.generate()`** (`AsyncIterable<string>`) once a real vendor call exists to stream tokens from, without changing the interface's shape for existing consumers.

## Final Thoughts

What started as a one-line ticket — "let customers pick their LLM" — turned into one of the more satisfying small architecture problems I've worked through, because the fix never got more complicated than the idea it started from: don't let a class build the thing it depends on, hand it the thing instead. NestJS's IoC container, providers, and dynamic modules are just the machinery that lets that one idea scale from a two-line constructor to a real, swappable, testable subsystem.

If you're facing a similar fork in the road — multiple implementations of the same idea, a runtime decision about which one to use, business logic that shouldn't have to care — it's worth reaching for this pattern before the first `if/else` on a vendor name makes it into your codebase. It's a lot cheaper to build it this way from day one than to refactor your way there after the third vendor shows up.

The full, runnable proof-of-concept — interface, tokens, both providers, the registry, the factory, the dynamic module, and the tests — lives in this repository if you want to see it end to end or use it as a starting point for your own multi-provider setup. Good luck with your own implementation, and feel free to open an issue if you run into a rough edge.
