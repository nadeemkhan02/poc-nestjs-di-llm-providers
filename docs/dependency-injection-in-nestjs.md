# Dependency Injection in NestJS: How We Learned to Stop Hard-Coding Our LLM and Started Injecting It

A few months ago, a seemingly simple requirement landed on our plate: *"the app should be able to talk to more than one LLM, and the customer should be able to choose which one, without us shipping a new build every time."*

On paper, that sounds like a one-line config change. In practice, it's the kind of requirement that quietly punishes a codebase for every shortcut it ever took. If you've ever grep'd your entire project for `new OpenAI(...)` because a vendor changed their pricing and someone said "let's also support DeepSeek," you already know the feeling.

This post is the story of that problem, and the pattern that got us out of it: **Dependency Injection (DI)**. We'll start from first principles — what DI actually is, in plain English — then walk through exactly how NestJS implements it, and finally build a real, working multi-LLM-provider architecture step by step, the same one we shipped. Every code snippet in this post is real code, not pseudocode — you can find it in [this repository](.).

---

## 1. What Dependency Injection Actually Is

Strip away the framework jargon and DI is a surprisingly small idea:

> **Don't let a class build the things it depends on. Hand those things to it instead.**

That's it. That's the whole concept. Everything else — containers, tokens, providers, modules — is just tooling built around that one sentence.

### A tiny example, without DI

Imagine a class that needs to send a notification:

```ts
class OrderService {
  private emailer = new SmtpEmailer(); // OrderService built its own dependency

  placeOrder(order: Order) {
    // ... business logic
    this.emailer.send(order.customerEmail, 'Order confirmed');
  }
}
```

This looks harmless until you actually have to live with it:

- Want to send SMS instead of email for some customers? You're editing `OrderService`.
- Want to unit-test `placeOrder()` without actually hitting an SMTP server? Good luck — `SmtpEmailer` is baked in.
- Want two different notification channels active at once, chosen per customer? Now you're writing `if/else` branches inside business logic that has nothing to do with notifications.

`OrderService` is **tightly coupled** to `SmtpEmailer`. It knows too much about *how* the notification happens, when all it should care about is *that* it happens.

### The same example, with DI

```ts
interface Notifier {
  send(to: string, message: string): Promise<void>;
}

class OrderService {
  constructor(private readonly notifier: Notifier) {} // handed to it, not built by it

  placeOrder(order: Order) {
    // ... business logic
    this.notifier.send(order.customerEmail, 'Order confirmed');
  }
}
```

`OrderService` now depends on an **interface**, not a concrete class. Something *outside* `OrderService` — a caller, a framework, a "container" — decides at construction time whether that's an `SmtpEmailer`, an `SmsNotifier`, or a `FakeNotifierForTests`. `OrderService` itself never changes.

That's the entire payoff of DI:

- **Swappable implementations** — change behavior without touching the class that uses it.
- **Testability** — inject a fake/mock in tests, a real one in production.
- **Single Responsibility** — a class focuses on its own logic, not on wiring up its collaborators.

Doing this by hand for a handful of classes is manageable. Doing it by hand across a real application — where `OrderService` needs a `Notifier`, which needs a `ConfigService`, which needs a `Logger`, which needs... — turns into a wiring nightmare. That's the problem an **IoC (Inversion of Control) container** solves, and it's exactly what NestJS gives you out of the box.

---

## 2. Our Actual Problem: One App, Several LLM Vendors, One Runtime Switch

Here's the situation we were actually in. Our service needed to call an LLM to generate text. Simple enough — until the requirements grew:

- Some customers wanted OpenAI. Others, for cost or compliance reasons, wanted DeepSeek.
- The choice had to be a **runtime configuration**, not a code branch — nobody wanted to redeploy the app just to flip a vendor.
- We knew a third, fourth, fifth provider was coming eventually. Whatever we built had to *not* require rewriting existing code every time that happened.

The naive version of this — the one every team writes first — looks like:

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

This works for exactly one vendor swap before it becomes a liability. Every new vendor adds another `else if`. Vendor-specific SDK calls, auth headers, and response-shape parsing all live *inside* the same file as the business logic that has nothing to do with any of that. Testing `LlmService` means testing every branch, every vendor's quirks, all at once. And this branch — this exact `if/else` — is the thing that eventually gets copy-pasted into every other service that also needs to call an LLM.

We'd basically recreated the `OrderService`/`SmtpEmailer` problem, just with a vendor name instead of a notification channel. So we reached for the same fix: stop letting the service know *which* vendor it's talking to. Make it depend on an interface, and let something else decide, at runtime, what sits behind that interface.

That "something else" is exactly what NestJS's DI system is built to do.

---

## 3. How NestJS Implements Dependency Injection

NestJS doesn't just support DI as a nice-to-have pattern — it's the backbone of the framework. Three concepts do all the work: **the IoC container**, **providers**, and **modules**.

### 3.1 The IoC Container

When your app boots, NestJS builds a dependency graph of every class you've registered, figures out what each one needs in its constructor, instantiates them in the right order, and hands each class its dependencies automatically. You never write `new LlmService(new SomeDependency())` yourself — Nest does it for you, based on constructor parameter types and `@Inject()` decorators.

This is the "container" in Inversion of Control: control over *object creation* is inverted, taken away from your classes and handed to the framework.

### 3.2 Providers

A **provider** is anything Nest can inject: a service, a repository, a factory, a plain value. Providers are declared in a module's `providers` array, and by default Nest binds a provider to its own class as the lookup key.

But Nest lets you go further than "class maps to itself." You can tell Nest: *"when someone asks for this token, run this value instead"*:

```ts
{ provide: SomeToken, useClass: SomeImplementation }
{ provide: SomeToken, useValue: someObject }
{ provide: SomeToken, useFactory: () => computeSomething() }
```

That `provide` key doesn't have to be a class — it can be a string, or better, a `Symbol`. This is the mechanism that decouples *what a consumer asks for* from *what actually gets built*, and it's the single most important trick in this entire post.

### 3.3 Modules

A `@Module()` groups related providers and controllers together, declares what it needs from other modules (`imports`), and what it's willing to share (`exports`). Modules are how a Nest app stays organized as it grows — and, as we'll see, a module can even compute its own provider list dynamically, based on configuration.

With those three pieces, here's how we actually built the multi-vendor LLM architecture.

---

## 4. The Implementation, Step by Step

Here's the target we're building toward:

```
                        ┌─────────────────────┐
HTTP request ────────▶  │   LlmController      │
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

Everything above the `LLM_PROVIDER` line has zero idea that OpenAI or DeepSeek exist. That's the whole point.

### Step 1 — Define the contract

Before writing a single line of vendor code, we wrote the interface every vendor has to honor:

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

This is the contract. From here on, nothing outside `src/llm/providers/` is allowed to import a concrete provider class — only this interface. That rule is what makes vendors truly interchangeable.

### Step 2 — Create a DI token

An interface disappears at compile time — TypeScript interfaces don't exist at runtime, so you can't `@Inject(LlmProvider)`. Nest needs something real to key its container on. That's a **token**:

```ts
// src/llm/tokens/llm.tokens.ts
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export enum LlmVendor {
  OPENAI = 'openai',
  DEEPSEEK = 'deepseek',
}
```

We used a `Symbol` instead of a plain string. It costs nothing, and it guarantees this token can never accidentally collide with some other `'LLM_PROVIDER'` string token elsewhere in a larger application.

### Step 3 — Implement the actual providers

Each vendor gets its own class implementing `LlmProvider`, and — this is the important bit — each one injects `ConfigService` for its own credentials, instead of reaching into `process.env` directly:

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
    // (In production this calls the real OpenAI API; simulated here.)
    return Promise.resolve({
      provider: this.getName(),
      model: this.model,
      text: `[simulated openai response] "${prompt}"`,
    });
  }
}
```

`DeepSeekProvider` is a mirror image, reading `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` instead. Neither class knows the other exists.

### Step 4 — A registry instead of an `if/else`

This is where we avoided recreating the exact `switch`-on-vendor-name problem we were trying to escape. Instead of a giant conditional somewhere picking a provider, each provider **registers itself** into a lookup table:

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

This is the [Strategy pattern](https://refactoring.guru/design-patterns/strategy), and it scales the way an `if/else` never does: adding a sixth vendor never means editing this file.

### Step 5 — A factory provider that reads config and picks the vendor

This is the piece that actually turns an environment variable into a live class instance. A **factory provider** tells Nest: *"don't just instantiate a class for this token — run this function, inject these arguments into it, and bind whatever it returns."*

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

Notice the third entry in `inject`: `'LLM_PROVIDER_BOOTSTRAP'`. It's never touched inside the factory body — its only job is to force Nest's dependency graph to build the bootstrap provider (which populates the registry, see below) *before* this factory runs. Nest resolves providers by dependency graph, not by array order, so without this explicit edge, "did the registry get populated in time?" would depend on incidental ordering — exactly the kind of bug that works on your machine and breaks in CI.

The bootstrap provider itself:

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

### Step 6 — Wrap it all in a Dynamic Module

Rather than scatter `OpenAiProvider`, `DeepSeekProvider`, the registry, and the factory across the app's root module, we packaged the entire thing behind a single call: `LlmModule.forRoot()`. This is a **dynamic module** — a module whose provider list is computed by a static method instead of hard-coded in the decorator:

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

And the root module stays almost embarrassingly simple:

```ts
// src/app.module.ts
@Module({
  imports: [LlmModule.forRoot()],
  controllers: [AppController, LlmController],
  providers: [AppService],
})
export class AppModule {}
```

Everything about *how* the vendor gets chosen is encapsulated inside `LlmModule`. `AppModule` doesn't know, and doesn't need to.

### Step 7 — Consume it, knowing nothing

This is the payoff. Here's the entire service that uses the LLM:

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

No `if`, no `switch`, no import of `OpenAiProvider` or `DeepSeekProvider`. `@Inject(LLM_PROVIDER)` asks the container for "whatever is bound to this token," and by the time this constructor runs, the factory from Step 5 has already made that decision. The controller sitting on top of this service is equally oblivious:

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

### Step 8 — Prove the switch actually works

Claims like "you can swap vendors with zero code changes" are cheap until you test them. We wrote an integration test that boots `LlmModule.forRoot()` twice — once with `LLM_PROVIDER=openai`, once with `LLM_PROVIDER=deepseek` — and asserts `LlmService` resolves the correct vendor both times, without a single line of `LlmService` changing between runs.

You can see the same thing manually against the compiled build:

```bash
npm run build

LLM_PROVIDER=openai PORT=3111 node dist/main.js &
curl http://localhost:3111/llm/active-provider   # {"activeProvider":"openai"}
kill %1

LLM_PROVIDER=deepseek PORT=3111 node dist/main.js &
curl http://localhost:3111/llm/active-provider   # {"activeProvider":"deepseek"}
```

Same compiled `dist/main.js`, same controller, same service — only the environment variable changed. That's the requirement we started with, satisfied exactly as asked.

---

## 5. Best Practices We Took Away From This

A few habits made this architecture hold up, and we'd carry them into any DI-heavy Nest module going forward:

- **Depend on interfaces, not concrete classes, across module boundaries.** `LlmService` never imports a provider class directly — only the `LlmProvider` interface and the `LLM_PROVIDER` token.
- **Confine vendor-specific code to one folder.** Nothing outside `src/llm/providers/` imports `OpenAiProvider` or `DeepSeekProvider` directly. If a vendor SDK changes its API, the blast radius is one file.
- **Prefer a registry over a growing `if/else`/`switch`.** A lookup table is append-only and merge-conflict-free; a conditional chain is neither.
- **Use `Symbol` tokens, not string tokens**, for anything beyond a quick prototype — they can't collide with an unrelated token of the same name elsewhere in the app.
- **Make ordering explicit, not incidental.** The `'LLM_PROVIDER_BOOTSTRAP'` dependency edge exists purely so the DI graph — not array position — guarantees the registry is ready before it's read.
- **Fail loudly on misconfiguration.** An unrecognized `LLM_PROVIDER` value throws a clear error at bootstrap. A silent fallback would have turned a typo into a support ticket weeks later.
- **Reach for `forRoot()` when config is synchronous, `forRootAsync()` when it isn't.** If provider selection ever needed to come from a remote feature-flag service instead of `.env`, that's the natural next step — same shape, async factory.
- **Write the integration test that proves the cross-cutting claim.** Unit tests proved each provider and the registry worked in isolation; only the integration test proved switching actually worked end to end.

---

## 6. Wrapping Up

What started as "just add a second LLM vendor" turned into a small but genuine architecture decision, and Dependency Injection is what made the right answer easy instead of painful. The core idea never got more complicated than the `OrderService`/`Notifier` example at the top of this post — a class asking for an interface instead of building a concrete implementation itself. NestJS's IoC container, providers, and dynamic modules are just the machinery that lets that idea scale from a two-line constructor to a real, swappable, testable subsystem.

If you're facing a similar fork in the road — multiple implementations of the same idea, a runtime decision about which one to use, a business-logic layer that shouldn't have to care — this pattern is worth reaching for before the first `if/else` on a vendor name makes it into your codebase. It's much cheaper to build it this way from the start than to refactor your way there after the third vendor shows up.

The full, runnable proof-of-concept — interfaces, tokens, both providers, the registry, the factory, the dynamic module, and the tests — lives in this repository if you want to see it end to end or use it as a starting template for your own multi-provider setup.
