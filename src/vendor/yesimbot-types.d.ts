import { Context, Universal, Element, Awaitable, Session, Bot, Schema as Schema$1, Service } from 'koishi';
import { CustomMessageBase, AgentMessage, AgentPlugin } from '@yesimbot/agent-runtime';
import { LanguageModel, EmbeddingModel } from 'ai';

type Dict<T = any, K extends string | symbol = string> = {
    [key in K]: T;
};
declare function isArrayBufferLike(value: any): value is ArrayBufferLike;
declare function isArrayBufferSource(value: any): value is Binary.Source;
declare namespace Binary {
    type Source<T extends ArrayBufferLike = ArrayBufferLike> = T | ArrayBufferView<T>;
    const is: typeof isArrayBufferLike;
    const isSource: typeof isArrayBufferSource;
    function fromSource<T extends ArrayBufferLike>(source: Source<T>): T;
    function toBase64(source: Source): string;
    function fromBase64(source: string): ArrayBuffer | Uint8Array<ArrayBuffer>;
    function toHex(source: Source): string;
    function fromHex(source: string): ArrayBuffer;
}

declare const kSchema: unique symbol;
declare global {
    namespace Schemastery {
        type From<X> = X extends string | number | boolean ? Schema<X> : X extends Schema ? X : X extends typeof String ? Schema<string> : X extends typeof Number ? Schema<number> : X extends typeof Boolean ? Schema<boolean> : X extends typeof Function ? Schema<Function, (...args: any[]) => any> : X extends Constructor<infer S> ? Schema<S> : never;
        type TypeS1<X> = X extends Schema<infer S, unknown> ? S : never;
        type Inverse<X> = X extends Schema<any, infer Y> ? (arg: Y) => void : never;
        type TypeS<X> = TypeS1<From<X>>;
        type TypeT<X> = ReturnType<From<X>>;
        type Resolve = (data: any, schema: Schema, options: Options, strict?: boolean) => [any, any?];
        type IntersectS<X> = From<X> extends Schema<infer S, unknown> ? S : never;
        type IntersectT<X> = Inverse<From<X>> extends ((arg: infer T) => void) ? T : never;
        type TupleS<X extends readonly any[]> = X extends readonly [infer L, ...infer R] ? [TypeS<L>?, ...TupleS<R>] : any[];
        type TupleT<X extends readonly any[]> = X extends readonly [infer L, ...infer R] ? [TypeT<L>?, ...TupleT<R>] : any[];
        type ObjectS<X extends Dict> = {
            [K in keyof X]?: TypeS<X[K]> | null;
        } & Dict;
        type ObjectT<X extends Dict> = {
            [K in keyof X]: TypeT<X[K]>;
        } & Dict;
        type Constructor<T = any> = new (...args: any[]) => T;
        interface Static {
            <T = any>(options: Partial<Schema<T>>): Schema<T>;
            new <T = any>(options: Partial<Schema<T>>): Schema<T>;
            prototype: Schema;
            resolve: Resolve;
            from<X = any>(source?: X): From<X>;
            extend(type: string, resolve: Resolve): void;
            any<T = any>(): Schema<T>;
            never(): Schema<never>;
            const<const T>(value: T): Schema<T>;
            string(): Schema<string>;
            number(): Schema<number>;
            natural(): Schema<number>;
            percent(): Schema<number>;
            boolean(): Schema<boolean>;
            date(): Schema<string | Date, Date>;
            regExp(flag?: string): Schema<string | RegExp, RegExp>;
            arrayBuffer(): Schema<Binary.Source, ArrayBufferLike>;
            arrayBuffer(encoding: 'hex' | 'base64'): Schema<Binary.Source | string, ArrayBufferLike>;
            bitset<K extends string>(bits: Partial<Record<K, number>>): Schema<number | readonly K[], number>;
            function(): Schema<Function, (...args: any[]) => any>;
            is(constructor: string): Schema;
            is<T>(constructor: Constructor<T>): Schema<T>;
            array<X>(inner: X): Schema<TypeS<X>[], TypeT<X>[]>;
            dict<X, Y extends Schema<any, string> = Schema<string>>(inner: X, sKey?: Y): Schema<Dict<TypeS<X>, TypeS<Y>>, Dict<TypeT<X>, TypeT<Y>>>;
            tuple<const X extends readonly any[]>(list: X): Schema<TupleS<X>, TupleT<X>>;
            object<X extends Dict>(dict: X): Schema<ObjectS<X>, ObjectT<X>>;
            union<const X>(list: readonly X[]): Schema<TypeS<X>, TypeT<X>>;
            intersect<const X>(list: readonly X[]): Schema<IntersectS<X>, IntersectT<X>>;
            transform<X, T>(inner: X, callback: (value: TypeS<X>, options: Schemastery.Options) => T, preserve?: boolean): Schema<TypeS<X>, T>;
            lazy<X extends Schema>(callback: () => X): X;
            ValidationError: typeof ValidationError;
        }
        interface Options {
            autofix?: boolean;
            ignore?(data: any, schema: Schema): boolean;
            path?: (keyof any)[];
        }
        interface Meta<T = any> {
            default?: T extends {} ? Partial<T> : T;
            required?: boolean;
            disabled?: boolean;
            collapse?: boolean;
            badges?: {
                text: string;
                type: string;
            }[];
            hidden?: boolean;
            loose?: boolean;
            role?: string;
            extra?: any;
            link?: string;
            description?: string | Dict<string>;
            comment?: string;
            pattern?: {
                source: string;
                flags?: string;
            };
            max?: number;
            min?: number;
            step?: number;
        }
    }
    interface Schemastery<S = any, T = S> {
        (data?: S | null, options?: Schemastery.Options): T;
        new (data?: S | null, options?: Schemastery.Options): T;
        [kSchema]: true;
        uid: number;
        meta: Schemastery.Meta<T>;
        type: string;
        sKey?: Schema;
        inner?: Schema;
        list?: Schema[];
        dict?: Dict<Schema>;
        bits?: Dict<number>;
        callback?: Function;
        constructor?: string | Function;
        builder?: Function;
        value?: T;
        refs?: Dict<Schema>;
        preserve?: boolean;
        toString(inline?: boolean): string;
        toJSON(): Schema<S, T>;
        required(value?: boolean): Schema<S, T>;
        hidden(value?: boolean): Schema<S, T>;
        loose(value?: boolean): Schema<S, T>;
        role(text: string, extra?: any): Schema<S, T>;
        link(link: string): Schema<S, T>;
        default(value: T): Schema<S, T>;
        comment(text: string): Schema<S, T>;
        description(text: string): Schema<S, T>;
        disabled(value?: boolean): Schema<S, T>;
        collapse(value?: boolean): Schema<S, T>;
        deprecated(): Schema<S, T>;
        experimental(): Schema<S, T>;
        pattern(regexp: RegExp): Schema<S, T>;
        max(value: number): Schema<S, T>;
        min(value: number): Schema<S, T>;
        step(value: number): Schema<S, T>;
        set(key: string, value: Schema): Schema<S, T>;
        push(value: Schema): Schema<S, T>;
        simplify(value?: any): any;
        i18n(messages: Dict): Schema<S, T>;
        extra<K extends keyof Schemastery.Meta>(key: K, value: Schemastery.Meta[K]): Schema<S, T>;
    }
}
declare class ValidationError extends TypeError {
    options: Schemastery.Options;
    name: string;
    constructor(message: string, options: Schemastery.Options);
    static is(error: any): error is ValidationError;
}
type Schema<S = any, T = S> = Schemastery<S, T>;
declare const Schema: Schemastery.Static;

declare namespace schemastery {
  export {
    Schema as default,
  };
}

type ChannelScope = SharedChannelScope | DirectChannelScope;
interface SharedChannelScope {
    type: "shared";
    platform: string;
    channelId: string;
    selfId: string;
}
interface DirectChannelScope {
    type: "direct";
    platform: string;
    selfId: string;
    channelId: string;
}
interface ChannelStorageOptions {
    basePath: string;
    logLevel?: number;
}
declare class ChannelStorage {
    private readonly channelsPath;
    private readonly manifests;
    private readonly ctx;
    private readonly logger;
    constructor(ctx: Context, options: ChannelStorageOptions);
    start(): Promise<void>;
    getStoragePath(scope: ChannelScope): Promise<string>;
    private assertChannelRoot;
    private assertContained;
    private ensureChannel;
}

interface AssetStore {
    put(data: Uint8Array): Promise<string>;
    get(idOrPrefix: string): Promise<Uint8Array>;
    clear(): Promise<void>;
}
declare class AssetService {
    private readonly storage;
    constructor(storage: ChannelStorage);
    createStore(scope: ChannelScope): AssetStore;
}

interface EventMap {
    "delivery.failed": {
        channel: Universal.Channel;
        delivery: {
            turnId: string;
            messageId: string;
            segmentIndex: number;
            segmentTotal: number;
            error: {
                name: string;
                message: string;
                code?: string;
            };
        };
    };
}
interface RecordBase {
    readonly platform: string;
    readonly selfId: string;
    readonly channel: Universal.Channel;
    readonly user: Universal.User;
    readonly timestamp: number;
}
type MessageRecord = Readonly<RecordBase & {
    readonly messageId: string;
    readonly elements: readonly Element[];
}>;
type EventBase = Readonly<{
    readonly platform: string;
    readonly selfId: string;
    readonly channel: Universal.Channel;
    readonly timestamp: number;
    readonly eventType: string;
    readonly text: string;
}>;
type EventRecord<K extends keyof EventMap = keyof EventMap> = K extends K ? Readonly<EventBase & {
    readonly eventType: K;
} & EventMap[K]> : never;
type Message = CustomMessageBase<"yesimbot.message", Omit<MessageRecord, "timestamp">>;
type Event<K extends keyof EventMap = keyof EventMap> = CustomMessageBase<"yesimbot.event", K extends K ? Omit<EventRecord<K>, "timestamp"> : never>;
declare module "@yesimbot/agent-runtime" {
    interface AgentCustomMessages {
        "yesimbot.event": Event;
        "yesimbot.message": Message;
    }
}
declare module "koishi" {
    interface Events {
        "yesimbot/event": (input: Event) => void;
        "yesimbot/message": (input: Message) => void;
    }
}
declare function assembleEvent<K extends keyof EventMap>(base: RecordBase, payload: {
    readonly eventType: K;
    readonly text: string;
} & Omit<EventMap[K], keyof EventBase>): EventRecord<K>;
declare function isMessageRecord(record: MessageRecord | EventRecord): record is MessageRecord;
declare function isEventRecord<K extends keyof EventMap>(record: MessageRecord | EventRecord<K>): record is EventRecord<K>;
declare function createMessage(record: MessageRecord): Message;
declare function createEvent<K extends keyof EventMap>(record: EventRecord<K>): Event<K>;
declare function isMessage(message: AgentMessage): message is Message;
declare function isEvent(message: AgentMessage): message is Event;

interface ArtifactOpenResult {
    readonly bytes: Uint8Array;
    readonly mediaType?: string;
    readonly filename?: string;
}
interface ArtifactWriter {
    put(bytes: Uint8Array, metadata: {
        mediaType?: string;
        filename?: string;
    }): Promise<string>;
}
interface ArtifactStore {
    forTool(toolName: string): ArtifactWriter;
    open(uri: string): Promise<ArtifactOpenResult>;
    clear(): Promise<void>;
}

declare const CHAT_MODEL_MODALITIES: readonly ["text", "audio", "image", "video", "pdf"];
type ModelId = `${string}:${string}`;
type ChatModelModality = (typeof CHAT_MODEL_MODALITIES)[number];
interface ChatModelConfig {
    id: string;
    name?: string;
    hidden?: boolean;
    toolCall?: boolean;
    reasoning?: boolean;
    limit?: {
        context: number;
        output: number;
    };
    modalities?: {
        input?: ChatModelModality[];
        output?: ChatModelModality[];
    };
    variants?: Record<string, unknown>;
}
interface EmbeddingModelConfig {
    id: string;
    name?: string;
    hidden?: boolean;
    dimension?: number;
}
interface ChatModelRef {
    fullId: ModelId;
    providerId: string;
    modelId: string;
    entry: ChatModelConfig;
    model: LanguageModel;
}
interface BaseProviderConfig {
    id: string;
    apiKey: string;
    baseURL?: string;
    chatModels: ChatModelConfig[];
    embeddingModels?: EmbeddingModelConfig[];
}

interface ModelServiceConfig {
    basePath: string;
    logLevel?: number;
}
interface Provider {
    readonly id: string;
    readonly capabilities: {
        chat: boolean;
        embedding: boolean;
    };
    chatModels(): ChatModelConfig[];
    embeddingModels(): EmbeddingModelConfig[];
    chat?(modelId: string): LanguageModel;
    embedding?(modelId: string): EmbeddingModel;
}
declare class ModelService {
    private readonly ctx;
    private readonly config;
    private providers;
    private chatModels;
    private embeddingModels;
    private aliases;
    private modelsConfig;
    private defaults;
    private readonly logger;
    constructor(ctx: Context, config: ModelServiceConfig);
    private getModelsConfigPath;
    private start;
    private stop;
    private refreshSchemas;
    private refreshModels;
    private resolveInput;
    private getChatRecord;
    private getEmbeddingRecord;
    register(provider: Provider): () => void;
    resolveChatModel(fullId: string): ChatModelRef;
    resolveEmbedding(fullId: string): EmbeddingModel;
    getProvider(id: string): Provider | undefined;
    listProviders(): string[];
    getDefaultChatModelId(): ModelId | undefined;
    getDefaultEmbeddingModelId(): ModelId | undefined;
    listChatModels(): Array<{
        fullId: string;
        config: ChatModelConfig;
    }>;
    listEmbeddingModels(): Array<{
        fullId: string;
        config: EmbeddingModelConfig;
    }>;
}

interface ResourceSchemeOpenHandler {
    (scope: ChannelScope, uri: string, options: {
        signal: AbortSignal;
        maxBytes: number;
    }): Promise<ResourceOpenResult>;
}
interface ResourceOpenResult {
    readonly bytes: Uint8Array;
    readonly mediaType?: string;
    readonly filename?: string;
}
interface ResourceReadResult {
    readonly uri: string;
    readonly filename?: string;
    readonly mediaType?: string;
    readonly text?: string;
    readonly error?: string;
}

interface RoutingConfig {
    readonly direct: WillEngine.Decision;
    readonly mention: WillEngine.Decision;
    readonly group: WillEngine.Decision;
}
interface WillingnessConfig {
    readonly probabilityThreshold: number;
    readonly decayHalfLifeSeconds: number;
    readonly replyCost: number;
}
type WillConfig = (RoutingConfig & {
    engine: "routing";
}) | (WillingnessConfig & {
    engine: "willingness";
});
type WillConfigPatch = Partial<RoutingConfig> & Partial<WillingnessConfig> & {
    engine?: "routing" | "willingness";
};
interface WillConfigContributor {
    readonly priority?: number;
    contribute(scope: ChannelScope, config: WillConfig): Awaitable<WillConfigPatch | void>;
}
interface WillEngineFactoryContext {
    readonly scope: ChannelScope;
    readonly config: WillConfig;
    readonly session: Session | undefined;
    createDefault(): WillEngine;
}
interface WillEngineFactory {
    readonly priority?: number;
    create(context: WillEngineFactoryContext): Awaitable<WillEngine | void>;
}
interface ResolveWillEngineOptions {
    readonly scope: ChannelScope;
    readonly session?: Session;
    readonly contributors?: readonly WillConfigContributor[];
    readonly factories?: readonly WillEngineFactory[];
}
interface WillEngine {
    decide(input: Message | Event, state: WillEngine.State): Awaitable<WillEngine.Decision>;
    onReply?(): Awaitable<void>;
    stop?(): Awaitable<void>;
}
declare namespace WillEngine {
    type Decision = "wait" | "trigger";
    interface State {
        readonly activeTurnId: string | null;
    }
}

interface ChannelPluginContext {
    readonly scope: ChannelScope;
    readonly bot: Bot;
    readonly artifacts: ArtifactStore;
}
type ChannelPluginFactory = (context: ChannelPluginContext) => Awaitable<AgentPlugin | null>;

interface ChannelAllowRule {
    readonly platform: string;
    readonly channelId: string;
    readonly isDirect?: boolean;
}
interface PlatformTranslator {
    readonly platform: string;
    translate(base: RecordBase, session: Session, store: AssetStore): Awaitable<MessageRecord | EventRecord | null>;
}

type ImageInputConfig = false | {
    readonly maxCount?: number;
    readonly maxBytesPerImage?: number;
    readonly maxTotalBytes?: number;
};
interface PacingConfig {
    charactersPerSecond: number;
    maxTotalDelayMs: number;
}
interface SessionCompactConfig {
    threshold: number;
    charTokenRatio: number;
    minMessages: number;
    maxFailures: number;
    model: string | undefined;
}
interface SessionIdleConfig {
    timeout: number;
}
interface SessionConfig {
    compact: SessionCompactConfig;
    idle: SessionIdleConfig;
}
interface Config {
    basePath: string;
    chatModel: string;
    visionModel: string | undefined;
    logLevel: number;
    allowedChannels: ChannelAllowRule[];
    imageInput: ImageInputConfig;
    resourceReadTimeoutMs: number;
    will: WillConfig;
    reply: {
        pacing: PacingConfig;
        customInnerThought: boolean;
    };
    session: SessionConfig;
}
declare const Config: Schema$1<Config>;

/**
 * Persists image and restricted text-file elements into the channel AssetStore,
 * shared by every platform translator. Failures keep the original element.
 */
declare function persistElements(ctx: Context, elements: readonly Element[], store: AssetStore): Promise<Element[]>;

declare module "koishi" {
    interface Context {
        yesimbot: YesImBotService;
    }
}
declare class YesImBotService extends Service<Config> {
    static readonly name = "yesimbot";
    static readonly usage = "";
    static readonly inject: string[];
    static readonly Config: schemastery<Config>;
    readonly model: ModelService;
    readonly assets: AssetService;
    private readonly storage;
    private readonly rt;
    private readonly gate;
    private readonly channelPlugins;
    private readonly willConfigContributors;
    private readonly willEngineFactories;
    private readonly commandDisposers;
    private readonly resourceSchemeRegistrations;
    private triggerClosed;
    private readonly triggerTasks;
    constructor(ctx: Context, config: Config);
    registerTranslator(translator: PlatformTranslator): () => void;
    registerChannelPlugin(resolver: ChannelPluginFactory): () => void;
    registerWillConfigContributor(contributor: WillConfigContributor): () => void;
    registerWillEngineFactory(factory: WillEngineFactory): () => void;
    registerResourceScheme(scheme: string, prompt: string, open: ResourceSchemeOpenHandler): () => void;
    getStoragePath(scope: ChannelScope): Promise<string>;
    start(): Promise<void>;
    reset(scope: ChannelScope): Promise<void>;
    trigger<K extends keyof EventMap>(event: EventRecord<K>): Promise<void>;
    private runTrigger;
    stop(): Promise<void>;
    private drainTriggers;
    private disposeCommand;
    private logError;
}

export { AssetService, ModelService, WillEngine, assembleEvent, createEvent, createMessage, YesImBotService as default, isEvent, isEventRecord, isMessage, isMessageRecord, persistElements };
export type { ArtifactStore, ArtifactWriter, AssetStore, BaseProviderConfig, ChannelPluginContext, ChannelPluginFactory, ChannelScope, ChatModelConfig, EmbeddingModelConfig, Event, EventBase, EventMap, EventRecord, Message, MessageRecord, ModelId, ModelServiceConfig, PlatformTranslator, RecordBase, ResolveWillEngineOptions, ResourceOpenResult, ResourceReadResult, ResourceSchemeOpenHandler, RoutingConfig, WillConfig, WillConfigContributor, WillConfigPatch, WillEngineFactory, WillEngineFactoryContext, WillingnessConfig };
//# sourceMappingURL=index.d.ts.map
