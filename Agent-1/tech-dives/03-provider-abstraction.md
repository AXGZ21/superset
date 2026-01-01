# Technical Deep Dive: Provider Abstraction Layer

## Sources: OpenCode (18+ providers), Chorus (8+ providers), Mux (8+ providers)

## Executive Summary

OpenCode, Chorus, and Mux demonstrate sophisticated **provider abstraction layers** that enable support for 18+ AI providers through a unified interface. This removes vendor lock-in and allows users to choose the best model for each task.

---

## Architecture Overview

### Provider Interface Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PROVIDER ABSTRACTION LAYER                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌───────────────────────────────────────────────────────────────┐         │
│   │                    Unified Provider Interface                  │         │
│   │  create() | stream() | complete() | listModels() | validate() │         │
│   └───────────────────────────────────────────────────────────────┘         │
│                                    │                                        │
│         ┌──────────────────────────┼──────────────────────────┐             │
│         │                          │                          │             │
│         ▼                          ▼                          ▼             │
│   ┌─────────────┐           ┌─────────────┐           ┌─────────────┐      │
│   │  Anthropic  │           │   OpenAI    │           │   Google    │      │
│   │  Provider   │           │   Provider  │           │   Provider  │      │
│   └─────────────┘           └─────────────┘           └─────────────┘      │
│         │                          │                          │             │
│         ▼                          ▼                          ▼             │
│   Claude Sonnet              GPT-4o                    Gemini Pro           │
│   Claude Opus                GPT-4 Turbo               Gemini Flash         │
│   Claude Haiku               GPT-3.5                   ...                  │
│                                                                              │
│   + xAI, DeepSeek, OpenRouter, Bedrock, Ollama, Groq, Fireworks, ...       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## OpenCode's Provider System (Most Comprehensive)

### Provider Registry Pattern

```typescript
// Based on OpenCode's provider architecture

// Provider capability flags
interface ProviderCapabilities {
  streaming: boolean;
  functionCalling: boolean;
  vision: boolean;
  jsonMode: boolean;
  systemPrompt: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
  costPerInputToken: number;
  costPerOutputToken: number;
}

// Unified provider interface
interface AIProvider {
  id: string;
  name: string;
  capabilities: ProviderCapabilities;

  // Lifecycle
  initialize(config: ProviderConfig): Promise<void>;
  validate(): Promise<ValidationResult>;

  // Model operations
  listModels(): Promise<ModelInfo[]>;
  getModel(modelId: string): ModelInfo | null;

  // Inference
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest): AsyncGenerator<StreamChunk>;

  // Cost tracking
  estimateCost(request: CompletionRequest): CostEstimate;
  trackUsage(usage: TokenUsage): void;
}

// Provider registry with lazy loading
class ProviderRegistry {
  private providers: Map<string, AIProvider> = new Map();
  private loaders: Map<string, () => Promise<AIProvider>> = new Map();

  register(id: string, loader: () => Promise<AIProvider>): void {
    this.loaders.set(id, loader);
  }

  async get(id: string): Promise<AIProvider | null> {
    // Return cached provider
    if (this.providers.has(id)) {
      return this.providers.get(id)!;
    }

    // Lazy load provider
    const loader = this.loaders.get(id);
    if (!loader) return null;

    const provider = await loader();
    this.providers.set(id, provider);
    return provider;
  }

  async listAvailable(): Promise<ProviderInfo[]> {
    return Array.from(this.loaders.keys()).map(id => ({
      id,
      loaded: this.providers.has(id),
    }));
  }
}
```

### Provider Implementation Example (Anthropic)

```typescript
// Anthropic provider implementation

import Anthropic from '@anthropic-ai/sdk';

class AnthropicProvider implements AIProvider {
  id = 'anthropic';
  name = 'Anthropic';

  capabilities: ProviderCapabilities = {
    streaming: true,
    functionCalling: true,
    vision: true,
    jsonMode: false,  // Uses tool use instead
    systemPrompt: true,
    maxContextTokens: 200000,
    maxOutputTokens: 8192,
    costPerInputToken: 0.000003,   // $3/1M tokens
    costPerOutputToken: 0.000015,  // $15/1M tokens
  };

  private client: Anthropic | null = null;

  async initialize(config: ProviderConfig): Promise<void> {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,  // Support custom endpoints
    });
  }

  async validate(): Promise<ValidationResult> {
    try {
      // Simple validation request
      await this.client!.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve([
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        contextWindow: 200000,
        maxOutput: 64000,
        costInput: 3,
        costOutput: 15,
      },
      {
        id: 'claude-opus-4-20250514',
        name: 'Claude Opus 4',
        contextWindow: 200000,
        maxOutput: 32000,
        costInput: 15,
        costOutput: 75,
      },
      // ... more models
    ]);
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const response = await this.client!.messages.stream({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: this.convertMessages(request.messages),
      tools: request.tools ? this.convertTools(request.tools) : undefined,
    });

    for await (const event of response) {
      if (event.type === 'content_block_delta') {
        yield {
          type: 'text',
          content: event.delta.text,
        };
      } else if (event.type === 'message_delta') {
        yield {
          type: 'usage',
          inputTokens: event.usage.input_tokens,
          outputTokens: event.usage.output_tokens,
        };
      }
    }
  }

  private convertMessages(messages: Message[]): Anthropic.MessageParam[] {
    return messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
  }
}
```

### Provider Implementation Example (OpenAI)

```typescript
// OpenAI provider implementation

import OpenAI from 'openai';

class OpenAIProvider implements AIProvider {
  id = 'openai';
  name = 'OpenAI';

  capabilities: ProviderCapabilities = {
    streaming: true,
    functionCalling: true,
    vision: true,
    jsonMode: true,
    systemPrompt: true,
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
    costPerInputToken: 0.000005,
    costPerOutputToken: 0.000015,
  };

  private client: OpenAI | null = null;

  async initialize(config: ProviderConfig): Promise<void> {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      organization: config.organization,
    });
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const response = await this.client!.chat.completions.create({
      model: request.model,
      max_tokens: request.maxTokens,
      messages: this.convertMessages(request),
      tools: request.tools ? this.convertTools(request.tools) : undefined,
      stream: true,
    });

    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        yield { type: 'text', content: delta.content };
      }

      if (delta?.tool_calls) {
        yield { type: 'tool_call', toolCalls: delta.tool_calls };
      }
    }
  }

  private convertMessages(request: CompletionRequest): OpenAI.ChatCompletionMessageParam[] {
    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    // Add system message if present
    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }

    // Convert messages
    for (const m of request.messages) {
      messages.push({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      });
    }

    return messages;
  }
}
```

---

## Chorus's Model Picker Pattern

Chorus implements a **model picker** UI that lets users select from multiple providers:

```typescript
// Model picker component from Chorus

interface ModelConfig {
  provider: string;
  modelId: string;
  displayName: string;
  systemPrompt?: string;
}

function ModelPicker({
  value,
  onChange,
  onMultiSelect
}: ModelPickerProps) {
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const { providers } = useProviderRegistry();

  // Group models by provider
  const modelsByProvider = useMemo(() => {
    const grouped: Record<string, ModelInfo[]> = {};

    for (const provider of providers) {
      grouped[provider.id] = provider.models;
    }

    return grouped;
  }, [providers]);

  return (
    <div className="model-picker">
      {/* Provider tabs */}
      <Tabs value={activeProvider} onValueChange={setActiveProvider}>
        <TabsList>
          {providers.map(p => (
            <TabsTrigger key={p.id} value={p.id}>
              <ProviderIcon provider={p.id} />
              {p.name}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Models for each provider */}
        {providers.map(p => (
          <TabsContent key={p.id} value={p.id}>
            <div className="grid grid-cols-2 gap-2">
              {modelsByProvider[p.id]?.map(model => (
                <ModelCard
                  key={model.id}
                  model={model}
                  selected={value?.modelId === model.id}
                  onClick={() => onChange({
                    provider: p.id,
                    modelId: model.id,
                    displayName: model.name,
                  })}
                />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Multi-model comparison mode */}
      {onMultiSelect && (
        <div className="mt-4">
          <Button
            variant="outline"
            onClick={() => onMultiSelect(selectedProviders)}
          >
            Compare {selectedProviders.length} Models
          </Button>
        </div>
      )}
    </div>
  );
}

function ModelCard({ model, selected, onClick }: ModelCardProps) {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-colors",
        selected && "border-primary bg-primary/5"
      )}
      onClick={onClick}
    >
      <CardHeader className="p-3">
        <CardTitle className="text-sm">{model.name}</CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatContextWindow(model.contextWindow)}</span>
          <span>•</span>
          <span>${model.costInput}/M in</span>
          <span>•</span>
          <span>${model.costOutput}/M out</span>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## Mux's Multi-Provider Streaming

Mux implements **parallel streaming** from multiple providers for comparison:

```typescript
// Multi-provider comparison from Mux

interface ComparisonRequest {
  prompt: string;
  models: ModelConfig[];
  options?: {
    timeout?: number;
    streamResults?: boolean;
  };
}

interface ComparisonResult {
  modelId: string;
  provider: string;
  response: string;
  usage: TokenUsage;
  latency: number;
  error?: string;
}

async function* streamComparison(
  request: ComparisonRequest
): AsyncGenerator<ComparisonUpdate> {
  const { prompt, models } = request;

  // Start all streams in parallel
  const streams = models.map(async function* (model) {
    const provider = await registry.get(model.provider);
    if (!provider) {
      yield { modelId: model.modelId, error: 'Provider not found' };
      return;
    }

    const startTime = Date.now();
    let fullResponse = '';

    try {
      for await (const chunk of provider.stream({
        model: model.modelId,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 4096,
      })) {
        if (chunk.type === 'text') {
          fullResponse += chunk.content;
          yield {
            modelId: model.modelId,
            provider: model.provider,
            type: 'delta',
            content: chunk.content,
          };
        }
      }

      yield {
        modelId: model.modelId,
        provider: model.provider,
        type: 'complete',
        response: fullResponse,
        latency: Date.now() - startTime,
      };
    } catch (error) {
      yield {
        modelId: model.modelId,
        provider: model.provider,
        type: 'error',
        error: error.message,
      };
    }
  });

  // Merge streams using race pattern
  for await (const update of mergeAsyncIterators(streams)) {
    yield update;
  }
}

// Helper to merge multiple async iterators
async function* mergeAsyncIterators<T>(
  iterators: AsyncGenerator<T>[]
): AsyncGenerator<T> {
  const pending = new Set(iterators.map((iter, i) => ({ iter, index: i })));

  while (pending.size > 0) {
    const promises = Array.from(pending).map(async ({ iter, index }) => {
      const result = await iter.next();
      return { result, index };
    });

    const { result, index } = await Promise.race(promises);

    if (result.done) {
      pending.delete([...pending].find(p => p.index === index)!);
    } else {
      yield result.value;
    }
  }
}
```

---

## Cost Tracking System

### Per-Message Cost Display

```typescript
// Cost tracking component

interface CostTracker {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  provider: string;
  model: string;
}

function CostDisplay({ tracker }: { tracker: CostTracker }) {
  const formatCost = (cost: number) => {
    if (cost < 0.01) return `$${(cost * 100).toFixed(3)}¢`;
    return `$${cost.toFixed(4)}`;
  };

  return (
    <div className="cost-display text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <Coins className="h-3 w-3" />
        {formatCost(tracker.totalCost)}
      </span>
      <span className="text-muted-foreground/60">
        ({tracker.inputTokens.toLocaleString()} in /
        {tracker.outputTokens.toLocaleString()} out)
      </span>
    </div>
  );
}

// Cost calculation utility
function calculateCost(
  model: ModelInfo,
  usage: TokenUsage
): number {
  const inputCost = (usage.inputTokens / 1_000_000) * model.costInput;
  const outputCost = (usage.outputTokens / 1_000_000) * model.costOutput;
  return inputCost + outputCost;
}

// Session cost aggregation
class SessionCostTracker {
  private costs: CostTracker[] = [];

  add(tracker: CostTracker): void {
    this.costs.push(tracker);
  }

  get totalCost(): number {
    return this.costs.reduce((sum, t) => sum + t.totalCost, 0);
  }

  get byProvider(): Record<string, number> {
    const grouped: Record<string, number> = {};
    for (const t of this.costs) {
      grouped[t.provider] = (grouped[t.provider] || 0) + t.totalCost;
    }
    return grouped;
  }

  get byModel(): Record<string, number> {
    const grouped: Record<string, number> = {};
    for (const t of this.costs) {
      const key = `${t.provider}/${t.model}`;
      grouped[key] = (grouped[key] || 0) + t.totalCost;
    }
    return grouped;
  }
}
```

---

## Superset Integration Strategy

### Step 1: Create Provider Registry

```typescript
// apps/desktop/src/main/lib/providers/registry.ts

import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { GoogleProvider } from './google';
import { OllamaProvider } from './ollama';
// ... more providers

export const providerRegistry = new ProviderRegistry();

// Register all providers (lazy loaded)
providerRegistry.register('anthropic', () => import('./anthropic').then(m => new m.AnthropicProvider()));
providerRegistry.register('openai', () => import('./openai').then(m => new m.OpenAIProvider()));
providerRegistry.register('google', () => import('./google').then(m => new m.GoogleProvider()));
providerRegistry.register('xai', () => import('./xai').then(m => new m.XAIProvider()));
providerRegistry.register('deepseek', () => import('./deepseek').then(m => new m.DeepSeekProvider()));
providerRegistry.register('openrouter', () => import('./openrouter').then(m => new m.OpenRouterProvider()));
providerRegistry.register('bedrock', () => import('./bedrock').then(m => new m.BedrockProvider()));
providerRegistry.register('ollama', () => import('./ollama').then(m => new m.OllamaProvider()));
providerRegistry.register('groq', () => import('./groq').then(m => new m.GroqProvider()));
providerRegistry.register('fireworks', () => import('./fireworks').then(m => new m.FireworksProvider()));
```

### Step 2: Add Provider Settings UI

```typescript
// Provider configuration in settings

function ProviderSettings() {
  const { providers, updateProvider, validateProvider } = useProviderSettings();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">AI Providers</h3>
        <p className="text-sm text-muted-foreground">
          Configure API keys for different AI providers
        </p>
      </div>

      <div className="space-y-4">
        {providers.map(provider => (
          <Card key={provider.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <ProviderIcon provider={provider.id} />
                <CardTitle className="text-base">{provider.name}</CardTitle>
              </div>
              <Badge variant={provider.isValid ? 'default' : 'secondary'}>
                {provider.isValid ? 'Connected' : 'Not Configured'}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={`${provider.id}-key`}>API Key</Label>
                  <Input
                    id={`${provider.id}-key`}
                    type="password"
                    value={provider.apiKey}
                    onChange={e => updateProvider(provider.id, { apiKey: e.target.value })}
                    placeholder={`Enter ${provider.name} API key`}
                  />
                </div>

                {provider.supportsCustomEndpoint && (
                  <div className="space-y-2">
                    <Label htmlFor={`${provider.id}-endpoint`}>Custom Endpoint (Optional)</Label>
                    <Input
                      id={`${provider.id}-endpoint`}
                      value={provider.baseURL}
                      onChange={e => updateProvider(provider.id, { baseURL: e.target.value })}
                      placeholder="https://api.example.com"
                    />
                  </div>
                )}

                <Button
                  variant="outline"
                  onClick={() => validateProvider(provider.id)}
                >
                  Test Connection
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

### Step 3: Add Model Selection to Workspace

```typescript
// Workspace model selector

function WorkspaceModelSelector({ workspaceId }: { workspaceId: string }) {
  const { model, setModel } = useWorkspaceModel(workspaceId);
  const { providers } = useConfiguredProviders();

  return (
    <Select value={`${model.provider}/${model.modelId}`} onValueChange={handleChange}>
      <SelectTrigger className="w-[200px]">
        <SelectValue>
          <div className="flex items-center gap-2">
            <ProviderIcon provider={model.provider} className="h-4 w-4" />
            <span>{model.displayName}</span>
          </div>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {providers.map(provider => (
          <SelectGroup key={provider.id}>
            <SelectLabel className="flex items-center gap-2">
              <ProviderIcon provider={provider.id} className="h-4 w-4" />
              {provider.name}
            </SelectLabel>
            {provider.models.map(m => (
              <SelectItem key={m.id} value={`${provider.id}/${m.id}`}>
                <div className="flex items-center justify-between w-full">
                  <span>{m.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ${m.costInput}/M
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
```

### Step 4: Add Cost Tracking Display

```typescript
// Cost tracking in workspace header

function WorkspaceCostTracker({ workspaceId }: { workspaceId: string }) {
  const { costs, totalCost } = useWorkspaceCosts(workspaceId);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8">
          <Coins className="h-4 w-4 mr-1" />
          <span className="font-mono">${totalCost.toFixed(4)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-4">
          <div className="flex justify-between">
            <span className="font-medium">Session Cost</span>
            <span className="font-mono">${totalCost.toFixed(4)}</span>
          </div>

          <Separator />

          <div className="space-y-2">
            <span className="text-sm text-muted-foreground">By Model</span>
            {Object.entries(costs.byModel).map(([model, cost]) => (
              <div key={model} className="flex justify-between text-sm">
                <span>{model}</span>
                <span className="font-mono">${cost.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

---

## Provider Capability Matrix

### Supported Providers (Target)

| Provider | Streaming | Functions | Vision | JSON Mode | Max Context |
|----------|-----------|-----------|--------|-----------|-------------|
| Anthropic | ✓ | ✓ | ✓ | - | 200K |
| OpenAI | ✓ | ✓ | ✓ | ✓ | 128K |
| Google | ✓ | ✓ | ✓ | ✓ | 1M |
| xAI | ✓ | ✓ | ✓ | ✓ | 128K |
| DeepSeek | ✓ | ✓ | - | ✓ | 64K |
| OpenRouter | ✓ | varies | varies | varies | varies |
| AWS Bedrock | ✓ | ✓ | ✓ | - | 200K |
| Ollama | ✓ | - | varies | - | varies |
| Groq | ✓ | ✓ | - | ✓ | 128K |
| Fireworks | ✓ | ✓ | - | ✓ | 128K |

---

## Benefits for Superset

1. **No Vendor Lock-In**: Users can switch between providers freely
2. **Cost Optimization**: Choose cheaper models for simpler tasks
3. **Best-in-Class Selection**: Use Claude for coding, GPT-4 for analysis, etc.
4. **Local Model Support**: Ollama enables air-gapped operation
5. **Comparison Testing**: A/B test responses from different models
6. **Cost Visibility**: Track spending across all providers

## Estimated Implementation Effort

| Component | Effort | Priority |
|-----------|--------|----------|
| Provider Interface | 1 week | High |
| Anthropic Provider | 1 week | High |
| OpenAI Provider | 1 week | High |
| Google Provider | 1 week | Medium |
| Additional Providers (5+) | 3 weeks | Medium |
| Provider Registry | 1 week | High |
| Settings UI | 1 week | Medium |
| Model Selector | 1 week | Medium |
| Cost Tracking | 1 week | Low |
| **Total** | **12 weeks** | - |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| API differences between providers | Thorough abstraction layer with capability flags |
| Token counting inconsistency | Use provider-specific tokenizers (tiktoken, etc.) |
| Streaming format differences | Normalize to common StreamChunk format |
| Feature parity gaps | Capability flags + graceful degradation |
