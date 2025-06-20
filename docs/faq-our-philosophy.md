# The "Effectively" Philosophy: Pragmatism in a World of Purity

If you've seen my new TypeScript library, [Effectively](https://github.com/doeixd/effectively), you might have some questions. If you come from a deep functional programming background, you might even have some pointed criticisms.

And you're probably right.

This post is my attempt to explain the "why" behind Effectively. Why it’s built the way it is, what trade-offs it intentionally makes, and why it might be the "just right" tool for a specific kind of developer and team—even while coexisting with titans like [Effect-TS](https://effect.website/).

Let's dive into the tough questions.

## "Wait, this isn't a *real* effect library! Where are the delimited continuations?"

You are 100% correct. Effectively is not a traditional effect system built on delimited continuations.

A traditional effect system, at its core, gives you the power to suspend a computation, inspect the reason for its suspension (the "effect"), handle it, and then resume the computation exactly where it left off. This is an incredibly powerful abstraction.

But here’s the thing: the modern JavaScript runtime, through `async/await`, gives us a form of this for the most common effect of all: **asynchrony**.

When you `await` a `Promise`, the JavaScript runtime is essentially performing a delimited continuation for you. It suspends your function, goes off to do other work, and when the promise resolves or rejects, it resumes your function with the resulting value or error.

**The Effectively Philosophy:** For the vast majority of applications, the runtime's native handling of asynchrony is *good enough*. Instead of rebuilding this mechanism from the ground up, we should embrace it and build structured patterns *on top* of it. We lean on the platform, which makes our abstractions simpler and our stack traces cleaner.

We trade the absolute power of universal delimited continuations for the simplicity and familiarity of the platform's native tools.

## "No fibers? No custom runtime? This must be slow and lack features."

This is another great point that gets to the heart of our design philosophy.

Effect-TS and other advanced libraries use a "fiber-based" runtime. This is essentially a lightweight, cooperatively scheduled "thread" implemented in user-space. Fibers unlock incredibly powerful features: fine-grained concurrency, automatic interruption, and resource safety that feels like magic. It’s a brilliant piece of engineering.

Effectively, by contrast, has almost no "runtime." It's a collection of patterns layered on native Promises and async functions.

**So, why this choice?**

1.  **Simplicity and Debuggability:** Native `async/await` stack traces are finally becoming readable. By not introducing a custom runtime, debugging an Effectively workflow feels just like debugging any other piece of TypeScript code. There are no layers of schedulers or interpreters between your code and the V8 engine.

2.  **The Platform is Catching Up:** The web platform itself is evolving. With `queueMicrotask` and the upcoming [Scheduler API (`scheduler.postTask`)](https://developer.chrome.com/blog/introducing-scheduler-post-task/), the browser and Node.js are gaining native, efficient ways to manage task scheduling. Our bet is that by staying close to the platform, we can leverage these future performance and concurrency primitives for free, without maintaining our own complex scheduler.

3.  **Performance is Relative:** Is a fiber runtime faster for managing thousands of concurrent operations? Absolutely. But for the typical I/O-bound web server or front-end application handling a reasonable number of concurrent requests, the overhead of a custom runtime can sometimes be less performant than just letting the native Promise machinery do its job. Effectively is optimized for the common case, not the extreme edge case.

## "The control flow isn't as powerful. I can't just 'interrupt' a workflow."

This is a direct consequence of the previous point. Without a fiber runtime that "owns" the execution, we cannot magically interrupt a running `Promise`.

**The Effectively Philosophy:** We trade automatic, preemptive interruption for explicit, cooperative cancellation.

When you use `run`, a `Scope` is created which is tied to an `AbortSignal`. Any task within that workflow can access this signal via `getContext()`. If you need to write a long-running, cancellable operation, you are responsible for checking `scope.signal.aborted` or passing the signal to underlying APIs like `fetch`.

We also provide the `BacktrackSignal` for powerful, non-linear control flow like state machines or advanced polling. You can jump back to any previous step in your workflow.

Is this as powerful as a runtime that can vaporize a computation from the outside? No. Is it a simpler, more explicit model that is sufficient for 95% of use cases? We think so. You build the control flow at the function level, which is often easier to reason about.

## "This is just Effect-TS with a worse understanding of FP."

I can’t even disagree with this. The author of Effect-TS, Michael Arnaldi, has a depth of knowledge in functional programming and category theory that I can only admire from a distance. Effect-TS is a work of art, born from years of deep thought and research.

**Effectively is not trying to compete on the axis of FP purity.**

It’s aiming for a different goal. Think of it like this:

*   **Effect-TS** is like a Formula 1 car. It is the pinnacle of performance, safety, and engineering. It requires a professional driver and a full pit crew to operate, but in the right hands, it is unbeatable.
*   **Effectively** is like a brand-new Mazda Miata. It's fun, reliable, and makes you a better driver. It builds on principles you already understand (engine, wheels, steering wheel) and gives you 90% of the thrill on a public road, with a fraction of the complexity and maintenance.

We are intentionally borrowing some of the most impactful ideas from the FP world (e.g., `Result` types for error handling, composable functions, algebraic effects for testability) and translating them into a package that feels native to the imperative `async/await` developer.

## "This still seems too complicated! I can just write helper functions."

You are mostly right!

At its core, Effectively *is* a well-organized collection of helper functions and patterns. You could absolutely write your own `withRetry` or `withTimeout`.

So what’s the point?

1.  **Standardization:** When your whole team uses the same `withRetry` function, you have a shared vocabulary. You know exactly how it behaves. You're not reinventing the wheel in every service and arguing about whether the backoff should be exponential or fixed.
2.  **Composition:** The true power emerges when these helpers are designed to compose seamlessly. A `Task` created by `withRetry` can be passed to `withTimeout`, which can then be used in a `createWorkflow`, which can be run with `withErrorBoundary`. These pieces are designed to click together like LEGO bricks.
3.  **Incremental Adoptability:** This is key. You don't have to buy into the whole system.
    *   Start by just using `withRetry` on a flaky API call.
    *   Then maybe use `withResource` to prevent a database connection leak.
    *   Later, refactor a messy controller into a clean `createWorkflow`.
    *   Need to mock a dependency for a test? Introduce `createContext` and `run`.
4. It fills a need between a full runtime, and normal, uncomposable code.   

You can use as much or as little as you want. The library meets you where you are. And yes, if all you need is a single helper, you can just copy the code from our repository—it's MIT licensed, after all!

## "Why aren't errors tracked in the type system? This feels unsafe."

This is one of the most significant philosophical departures from a pure effect system like Effect-TS, where a computation's potential errors are explicitly encoded in its return type (e.g., `Effect<A, E, R>`). This provides compile-time guarantees that all possible failures are handled. It’s a powerful safety net.

So why doesn't Effectively do this? The short answer: **to maximize flexibility and maintain seamless integration with the existing JavaScript ecosystem.**

**The Effectively Philosophy:** We believe that the *data* flowing through your system should be strictly typed, but the *control flow* should remain flexible. This is why we wholeheartedly recommend using a `Result` type (like from `neverthrow`) for your return values.

Let's break this down.

1.  **Embracing the `Promise`:** An Effectively `Task` is, at its heart, just a function that returns a `Promise`. The native `Promise` in JavaScript can only `reject` with a value of type `any`. Forcing every task to wrap its errors in a way that could be statically typed would mean abandoning the native `Promise` as our core primitive. This would break compatibility with virtually the entire `async/await` ecosystem. You couldn't `await` a function from a third-party library without explicitly wrapping it. We felt this trade-off was too high.

2.  **Differentiating Domain vs. System Errors:** We encourage a clear separation between two types of errors:
    *   **Domain Errors (Expected Failures):** These are part of your business logic. "User not found," "Invalid credit card," "Username already taken." These are not exceptions; they are predictable outcomes. **These absolutely *should* be in your type signature**, and the best way to do that is by returning a `Result<User, UserNotFoundError>`. This forces the caller to handle the predictable failure case.
    *   **System Errors (Unexpected Panics):** "Database connection lost," "Network timeout," "Out of memory." These are runtime catastrophes. You often can't handle these locally anyway. Your goal is to catch them at a high level (with `withErrorBoundary` or a global error handler), log them, and either gracefully degrade or restart the service. Trying to plumb these panics through every type signature in your application can lead to noisy and complex types (`Result<User, UserNotFoundError | DbConnectionError | NetworkError | ...>`).

3.  **Flexibility is a Feature:** By allowing tasks to throw, we let developers choose their preferred error handling strategy.
    *   Want maximum type safety? Return a `Result` from your task.
    *   Want to handle errors with a classic `try/catch`? Go for it.
    *   Want to delegate error handling to a higher-level boundary? Just let it throw.
    *   Need to integrate a third-party SDK that throws strings? It just works.

We provide the tools (`attempt`, `withErrorBoundary`, `neverthrow`) to handle errors in a structured way, but we don't enforce one single, dogmatic approach at the type-system level. It’s a pragmatic choice that prioritizes interoperability and developer freedom over absolute, provable correctness for every possible failure.

## "You don't even have a `Mutex`! How can this be for 'resilient' applications?"

This is another great question and a very intentional design choice. You're right, `Effectively` does not ship with high-level synchronization primitives like `Mutex`, `Semaphore`, or `ReentrantLock`.

Libraries like Effect-TS, which control their own runtime, provide these fantastic, safe abstractions. They are fully integrated with the fiber model, making them interruption-aware and a natural fit within their ecosystem.

So why doesn't `Effectively`?

**The Effectively Philosophy:** We believe in providing structure for workflows, but not reinventing low-level concurrency tools that the platform already provides. Our goal is to lean on the platform, not replace it.

Here’s the reasoning:

1.  **Minimalism and Focus:** Building robust, correct, and performant synchronization primitives is a massive undertaking. To do so would significantly increase the size and complexity of `Effectively`. Our focus is on making `async/await` composition and error handling better, not on becoming a low-level concurrency toolkit.

2.  **Platform Alignment:** When you need *true parallelism* with Web Workers, you must eventually use the platform's native tools for shared memory: `SharedArrayBuffer` and `Atomics`. A JavaScript-based `Mutex` implemented in our library wouldn't help you coordinate between different threads. Instead of providing a leaky abstraction, we believe it's more honest and powerful to encourage developers to use the native primitives for the low-level problems that require them.

3.  **The Future is the Platform:** The web platform is continuously evolving. The [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API), for instance, provides a standardized, asynchronous locking mechanism directly in the browser. Why should we build and maintain our own complex version of something that the platform is moving to provide as a standard? By staying lean, we avoid creating redundant or conflicting tools.

We trade the out-of-the-box convenience of bundled high-level abstractions for a leaner library that encourages the direct use of powerful, platform-native tools when they are truly needed. It's the pragmatic path for developers who aren't afraid to get close to the metal when solving genuinely low-level problems.

## Conclusion: A Different Point on the Spectrum

Effectively was born from a love of TypeScript, a respect for the power of functional programming, and the pragmatic reality of working on teams with diverse skill sets.

It’s a bet that there is a large group of developers who want to write more robust, testable, and maintainable asynchronous code, but aren't ready—or don't need—to jump into a full-blown effect system. It’s a tool for enhancing the patterns you already know, not replacing them.

If you are building mission-critical systems where absolute, provable correctness is paramount, you should seriously consider Effect-TS.

If you are building an application and you want to level-up your `async/await` code with battle-tested patterns for resilience, composition, and testing, then maybe, just maybe, Effectively is for you.

I’d love to hear your thoughts.
