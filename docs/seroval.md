# seroval

> Stringify JS values

[![NPM](https://img.shields.io/npm/v/seroval.svg)](https://www.npmjs.com/package/seroval) [![JavaScript Style Guide](https://badgen.net/badge/code%20style/airbnb/ff5a5f?icon=airbnb)](https://github.com/airbnb/javascript)

## Install

```bash
npm install --save seroval
```

```bash
yarn add seroval
```

```bash
pnpm add seroval
```

## Usage

```js
import { serialize } from 'seroval';

const object = {
  number: [Math.random(), -0, NaN, Infinity, -Infinity],
  string: ['hello world', '<script>Hello World</script>'],
  boolean: [true, false],
  null: null,
  undefined: undefined,
  bigint: 9007199254740991n,
  array: [,,,], // holes
  regexp: /[a-z0-9]+/i,
  date: new Date(),
  map: new Map([['hello', 'world']]),
  set: new Set(['hello', 'world']),
};

// self cyclic references
// recursive objects
object.self = object;
// recursive arrays
object.array.push(object.array);
// recursive maps
object.map.set('self', object.map);
// recursive sets
object.set.add(object.set);

// mutual cyclic references
object.array.push(object.map);
object.map.set('mutual', object.set);
object.set.add(object.array);

const result = serialize(object);
console.log(result);
```

Output (as a string):

```js
((h,j,k,m,o)=>(o={number:[0.5337763749243287,-0,0/0,1/0,-1/0],string:["hello world","\x3Cscript>Hello World\x3C/script>"],boolean:[!0,!1],null:null,undefined:void 0,bigint:9007199254740991n,array:h=[,,,,k=(j=[],new Map([["hello","world"],["mutual",m=new Set(["hello","world"])]]))],regexp:/[a-z0-9]+/i,date:new Date("2023-12-07T17:28:57.909Z"),map:k,set:m},h[3]=h,k.set("self",k),m.add(m).add(h),o.self=o,o))()

// Formatted for readability
((h, j, k, m, o) => (
  (o = {
    number: [0.5337763749243287, -0, 0 / 0, 1 / 0, -1 / 0],
    string: ["hello world", "\x3Cscript>Hello World\x3C/script>"],
    boolean: [!0, !1],
    null: null,
    undefined: void 0,
    bigint: 9007199254740991n,
    array: (h = [
      ,
      ,
      ,
      ,
      (k =
        ((j = []),
        new Map([
          ["hello", "world"],
          ["mutual", (m = new Set(["hello", "world"]))],
        ]))),
    ]),
    regexp: /[a-z0-9]+/i,
    date: new Date("2023-12-07T17:28:57.909Z"),
    map: k,
    set: m,
  }),
  (h[3] = h),
  k.set("self", k),
  m.add(m).add(h),
  (o.self = o),
  o
))();
```

## Docs

- [Serialization](https://github.com/lxsmnsyc/seroval/blob/main/docs/serialization.md)
- [Compatibility](https://github.com/lxsmnsyc/seroval/blob/main/docs/compatibility.md)
- [Isomorphic References](https://github.com/lxsmnsyc/seroval/blob/main/docs/isomorphic-refs.md)

## Sponsors

![Sponsors](https://github.com/lxsmnsyc/sponsors/blob/main/sponsors.svg?raw=true)

## License

MIT © [lxsmnsyc](https://github.com/lxsmnsyc)
# Compatibility

All serialization methods can accept a `{ disabledFeatures: number }` option. This option influences how the serialization will process and emit a value.

```js
import { serialize, Feature } from 'seroval';

const y = Object.create(null);
y.self = y;
y.example = 'Hello World';

function serializeWithTarget(value, disabledFeatures) {
  const result = serialize(value, {
    disabledFeatures,
  });
  console.log(result);
}

serializeWithTarget(y, Feature.ArrowFunction | Feature.ObjectAssign);
serializeWithTarget(y, 0);
```

```js
(function(h){return (h=(h=Object.create(null),h.example="Hello World",h),h.self=h,h)})()
(h=>(h=Object.assign(Object.create(null),{example:"Hello World"}),h.self=h,h))()
```

`disabledFeatures` uses bit flags for faster checking, so if you need to disable multiple features, you can use the bitwise OR symbol (`|`).

Here's an `ES2017` flag:

```js
import { serialize, Feature } from 'seroval';

const ES2017FLAG =
  Feature.AggregateError // ES2021
  | Feature.BigIntTypedArray // ES2020;

serialize(myValue, {
  disabledFeatures: ES2017FLAG,
})
```

By default, all feature flags are enabled. The following are the feature flags and their behavior when disabled:

- [`AggregateError`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AggregateError)
  - Compiles down to `Error` instead.
- [`ArrowFunction`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Arrow_functions)
  - Uses function expressions for top-level and for deferred `Promise` values
  - Uses function expressions for `Iterable`
  - Uses function expressions for `AsyncIterable`
- [`ErrorPrototypeStack`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/stack)
  - Skipped when detected.
  - Affects both `Error` and `AggregateError`
- [`ObjectAssign`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign)
  - Uses manual object assignments instead.
  - Affects `Iterable`, `Error`, `AggregateError` and `Object.create(null)`
- [`BigIntTypedArray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt64Array)
  - Disables serialization of `BigInt64Array` and `BigUint64Array`

## Supported Types

- sync = `serialize`, `toJSON`, `crossSerialize`, `toCrossJSON`
- async = `serializeAsync`, `toJSONAsync`, `crossSerializeAsync`, `toCrossJSONAsync`
- streaming = `crossSerializeStream`, `toCrossJSONStream`, `Serializer`

| Type                                                                                                                                                     | sync      | async     | streaming |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------- | --------- |
| `NaN`                                                                                                                                                    | ✅         | ✅         | ✅         |
| `Infinity`                                                                                                                                               | ✅         | ✅         | ✅         |
| `-Infinity`                                                                                                                                              | ✅         | ✅         | ✅         |
| `-0`                                                                                                                                                     | ✅         | ✅         | ✅         |
| `number`                                                                                                                                                 | ✅         | ✅         | ✅         |
| `string`                                                                                                                                                 | ✅         | ✅         | ✅         |
| `boolean`                                                                                                                                                | ✅         | ✅         | ✅         |
| `null`                                                                                                                                                   | ✅         | ✅         | ✅         |
| `undefined`                                                                                                                                              | ✅         | ✅         | ✅         |
| `bigint`                                                                                                                                                 | ✅         | ✅         | ✅         |
| `Array`                                                                                                                                                  | ✅         | ✅         | ✅         |
| sparse (holey) `Arrays`                                                                                                                                  | ✅         | ✅         | ✅         |
| `Object`                                                                                                                                                 | ✅         | ✅         | ✅         |
| `RegExp`                                                                                                                                                 | ✅         | ✅         | ✅         |
| `Date`                                                                                                                                                   | ✅         | ✅         | ✅         |
| `Map`                                                                                                                                                    | ✅         | ✅         | ✅         |
| `Set`                                                                                                                                                    | ✅         | ✅         | ✅         |
| `Object.create(null)`                                                                                                                                    | ✅         | ✅         | ✅         |
| `ArrayBuffer`                                                                                                                                            | ✅         | ✅         | ✅         |
| `DataView`                                                                                                                                               | ✅         | ✅         | ✅         |
| `Int8Array`                                                                                                                                              | ✅         | ✅         | ✅         |
| `Int16Array`                                                                                                                                             | ✅         | ✅         | ✅         |
| `Int32Array`                                                                                                                                             | ✅         | ✅         | ✅         |
| `Uint8Array`                                                                                                                                             | ✅         | ✅         | ✅         |
| `Uint16Array`                                                                                                                                            | ✅         | ✅         | ✅         |
| `Uint32Array`                                                                                                                                            | ✅         | ✅         | ✅         |
| `Uint8ClampedArray`                                                                                                                                      | ✅         | ✅         | ✅         |
| `Float32Array`                                                                                                                                           | ✅         | ✅         | ✅         |
| `Float64Array`                                                                                                                                           | ✅         | ✅         | ✅         |
| `BigInt64Array`                                                                                                                                          | ❓[^1]     | ❓[^1]     | ❓[^1]     |
| `BigUint64Array`                                                                                                                                         | ❓[^1]     | ❓[^1]     | ❓[^1]     |
| `Error`                                                                                                                                                  | ✅[^2]     | ✅[^2]     | ✅[^2]     |
| `AggregateError`                                                                                                                                         | ✅[^2][^3] | ✅[^2][^3] | ✅[^2][^3] |
| `EvalError`                                                                                                                                              | ✅[^2]     | ✅[^2]     | ✅[^2]     |
| `RangeError`                                                                                                                                             | ✅[^2]     | ✅[^2]     | ✅[^2]     |
| `ReferenceError`                                                                                                                                         | ✅[^2]     | ✅[^2]     | ✅[^2]     |
| `SyntaxError`                                                                                                                                            | ✅[^2]     | ✅[^2]     | ✅[^2]     |
| `TypeError`                                                                                                                                              | ✅[^2]     | ✅[^2]     | ✅[^2]     |
| `URIError`                                                                                                                                               | ✅[^2]     | ✅[^2]     | ✅[^2]     |
| `Promise`                                                                                                                                                | ❌         | ✅         | ✅         |
| [`Iterable`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#the_iterable_protocol)                                | ✅         | ✅         | ✅         |
| [Well-known symbols](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol#static_properties)                          | ✅         | ✅         | ✅         |
| [`AsyncIterable`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#the_async_iterator_and_async_iterable_protocols) | ❌         | ✅         | ✅         |
| Built-in streaming primitive                                                                                                                             | ✅         | ✅         | ✅         |
| Cyclic references                                                                                                                                        | ✅         | ✅         | ✅         |
| Isomorphic references                                                                                                                                    | ✅         | ✅         | ✅         |

### `seroval-plugins/web`

| Type                                                                                  | sync  | async | streaming |
| ------------------------------------------------------------------------------------- | ----- | ----- | --------- |
| [`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL)                         | ✅     | ✅     | ✅         |
| [`URLSearchParams`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams) | ✅     | ✅     | ✅         |
| [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob)                       | ❌     | ✅     | ❌[^5]     |
| [`File`](https://developer.mozilla.org/en-US/docs/Web/API/File)                       | ❌     | ✅     | ❌[^5]     |
| [`Headers`](https://developer.mozilla.org/en-US/docs/Web/API/Headers)                 | ✅     | ✅     | ✅         |
| [`FormData`](https://developer.mozilla.org/en-US/docs/Web/API/FormData)               | ✅[^4] | ✅     | ✅[^4]     |
| [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)   | ❌     | ✅     | ✅         |
| [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request)                 | ❌     | ✅     | ✅         |
| [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response)               | ❌     | ✅     | ✅         |
| [`Event`](https://developer.mozilla.org/en-US/docs/Web/API/Event)                     | ✅     | ✅     | ✅         |
| [`CustomEvent`](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent)         | ✅     | ✅     | ✅         |
| [`DOMException`](https://developer.mozilla.org/en-US/docs/Web/API/DOMException)       | ✅     | ✅     | ✅         |
| [`ImageData`](https://developer.mozilla.org/en-US/docs/Web/API/ImageData)             | ✅     | ✅     | ✅         |
| [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)         | ✅     | ✅     | ✅         |

[^1]: `Feature.BigIntTypedArray` must be enabled, otherwise throws an `SerovalUnsupportedTypeError`.
[^2]: `Feature.ErrorPrototypeStack` must be enabled if serializing `Error.prototype.stack` is desired.
[^3]: `Feature.AggregateError` must be enabled, otherwise `AggregateError` is serialized into an `Error` instance.
[^4]: `FormData` is partially supported if it doesn't contain any `Blob` or `File` instances.
[^5]: Due to the nature of `Blob` and `File` being an async type (in that it returns a `Promise`-based serializable data) while having a sync constructor, it cannot be represented in a way that the type is consistent to its original declaration.


# Isomorphic references

There are values that has no way to be serializable at all, i.e. functions, but usually in an isomorphic code, functions can exist on both client and server-side. What if we can serialize these functions in such a way we can refer to their counterparts?

`seroval` has `createReference` that you can use to map user-defined strings to their references.

```js
import { createReference } from 'seroval';

const thisIsAnIsomorphicFunction = createReference(
  // This is (ideally) a unique identifier
  // that is used to map the serialized value
  // to its actual reference (and vice versa)
  'my-function',
  () => {
    // Ideally this function should exist on both
    // server and client, but we want to add the ability
    // to serialize and deserialize this reference on
    // both sides
  }
);

// we can now serialize this
const serialized = toJSON(thisIsAnIsomorphicFunction); // or any of the serializer
thisIsAnIsomorphicFunction === fromJSON(serialized); // true
```

> [!NOTE]
> It can only accept objects, functions and symbols and it doesn't actually
> serialize their values but only the string you used to identify the reference

# Serialization

`seroval` offers 3 modes of serialization: sync, async and streaming.

## Basic serialization

`serialize` offers the basic form of serialization.

```js
import { serialize } from 'seroval';

console.log(serialize({ foo: 'bar' })); // {foo:"bar"}
```

## Async serialization

`serializeAsync` is similar to `serialize` except that it supports asynchronous values, such as `Promise` instances.

```js
import { serializeAsync } from 'seroval';

console.log(await serializeAsync(Promise.resolve({ foo: 'bar'}))); // Promise.resolve({foo:"bar"})
```

## Deduping references

If the serializer functions encounter multiple instances of the same reference, the reference will get deduped.

```js
import { serialize } from 'seroval';

const parent = {};

const a = { parent };
const b = { parent };

const children = [a, b];

console.log(serialize(children)); // (h=>([{parent:h={}},{parent:h}]))()
```

## Cyclic references

`seroval` also supports cyclic references.

```js
import { serialize } from 'seroval';

const cyclic = {};

cyclic.self = cyclic;

console.log(serialize(cyclic)); // (h=>(h={},h.self=h,h))()
```

It also supports references that are mutually cyclic (e.g. they reference each other)

```js
import { serialize } from 'seroval';

const nodeA = {};
const nodeB = {};

nodeA.next = nodeB;
nodeB.prev = nodeA;

console.log(serialize([nodeA, nodeB])); // ((h,j,k)=>(k=[h={next:j={}},j],j.prev=h,k))()
```

It can also detect potential temporal dead zone

```js
import { serialize } from 'seroval';

const root = {};

const nodeA = { parent: root };
const nodeB = { parent: nodeA };

root.child = nodeA;
nodeA.child = nodeB;

console.log(serialize(root)); // ((h,j,k)=>(h={child:j={child:k={}}},j.parent=h,k.parent=j,h))()
```

## Cross-reference serialization

`serialize` and `serializeAsync` can only dedupe references within its own script, but what if you want two or more scripts to share the same references?

`crossSerialize` and `crossSerializeAsync` provides the capability

```js
import { crossSerialize } from 'seroval';

const nodeA = {};
const nodeB = {};

nodeA.next = nodeB;
nodeB.prev = nodeA;

// keeps track of the shared references
const refs = new Map();
console.log(crossSerialize(nodeA, { refs })); // ($R[0]={next:$R[1]={}},$R[1].prev=$R[0],$R[0])
console.log(crossSerialize(nodeB, { refs })); // $R[1]
```

Take note that cross-reference scripts relies on the global array variable `$R`, which you can declare either manually, or a script via `getCrossReferenceHeader`

```js
import { getCrossReferenceHeader } from 'seroval';

console.log(getCrossReferenceHeader()) // self.$R=self.$R||[]
```

## Re-isolating cross-reference

`crossSerialize` and `crossSerializeAsync` can accept a `scopeId` string which allows `$R` to be scoped based on the given `scopeId`.

```js
import { crossSerialize } from 'seroval';

const nodeA = {};
const nodeB = {};

nodeA.next = nodeB;
nodeB.prev = nodeA;

// keeps track of the shared references
const refsA = new Map();
const refsB = new Map();
console.log(crossSerialize(nodeA, { refs: refsA, scopeId: 'A' })); // ($R=>$R[0]={next:$R[1]={}},$R[1].prev=$R[0],$R[0])($R["A"])
console.log(crossSerialize(nodeA, { refs: refsB, scopeId: 'B' })); // ($R=>$R[0]={next:$R[1]={}},$R[1].prev=$R[0],$R[0])($R["B"])
console.log(crossSerialize(nodeB, { refs: refsA, scopeId: 'A' })); // ($R=>$R[1])($R["A"])
console.log(crossSerialize(nodeB, { refs: refsB, scopeId: 'B' })); // ($R=>$R[1])($R["B"])
```

You can independently initialize the `$R` variable by doing

```js
import { getCrossReferenceHeader } from 'seroval';

console.log(getCrossReferenceHeader('A')) // (self.$R=self.$R||{})["A"]=[]
console.log(getCrossReferenceHeader('B')) // (self.$R=self.$R||{})["B"]=[]
```

## Streaming serialization

`serialize` doesn't support async values, but `serializeAsync` do. However, both methods are "blocking" in a sense that you need to wait the entire value to resolve before you can receive the serialized string.

With streaming serialization, you can receive the serialized string immediately for the synchronous part, while receiving the asynchronous part later on.

Streaming serialization relies on cross-referencing since you can think of it as multiple `crossSerialize` calls.

```js
import { crossSerializeStream } from 'seroval';

crossSerializeStream(Promise.resolve({ foo: 'bar'}), {
  onSerialize(data) {
    console.log(data);
  },
});

// Logs:
$R[0]=($R[2]=r=>(r.p=new Promise((s,f)=>{r.s=s,r.f=f})))($R[1]={p:0,s:0,f:0})
($R[4]=(r,d)=>{r.s(d),r.p.s=1,r.p.v=d})($R[1],$R[3]={foo:"bar"})
```

> [!NOTE]
> Much like other cross-reference methods, you can pass a `refs` and `scopeId` option.

### `createStream`

Streaming serialization allows pushing values through `Promise` instances. However, `Promise` instances only resolve to a single value, but what if you can resolve multiple values at different times?

`ReadableStream` is capable of doing so, however it's not a JS standard (`seroval` supports it through plugins). `Observable` could have been nice however [it's not a JS standard yet](https://github.com/tc39/proposal-observable)

With two of the options not available, `seroval` provides a streaming primitive called `createStream` which is capable of buffering streaming data as well as emitting pushed data.

```js
import { createStream } from 'seroval';

const stream = createStream();

// Push early
stream.next('foo');
stream.next('bar');

// Add a listener
stream.on({
  next(data) {
    console.log('NEXT', data);
  },
  throw(data) {
    console.log('THROW', data);
  },
  return(data) {
    console.log('RETURN', data);
  },
});
// Immediately logs `NEXT foo` and `NEXT bar`

stream.return('baz'); // RETURN baz
```

`createStream` instances are also serializable for async serialization

```js
console.log(await serializeAsync(stream));

// which logs
((h,j)=>((j=((b,a,s,l,p,f,e,n)=>(b=[],a=!0,s=!1,l=[],s=0,f=(v,m,x)=>{for(x=0;x<s;x++)l[x]&&l[x][m](v)},n=(o,x,z,c)=>{for(x=0,z=b.length;x<z;x++)(c=b[x],x===z-1?o[s?"return":"throw"](c):o.next(c))},e=(o,t)=>(a&&(l[t=p++]=o),n(o),()=>{a&&(l[t]=void 0)}),{__SEROVAL_STREAM__:!0,on:o=>e(o),next:v=>{a&&(b.push(v),f(v,"next"))},throw:v=>{a&&(b.push(v),f(v,"throw"),a=s=!1,l.length=0)},return:v=>{a&&(b.push(v),f(v,"return"),a=!1,s=!0,l.length=0)}}))(),j.next("foo"),j.next("bar"),j.return("baz"),j)))()
```

Streaming serialization is also supported

```js
crossSerializeStream(stream, {
  onSerialize(data) {
    console.log(data);
  },
});

// which logs
$R[0]=($R[1]=(b,a,s,l,p,f,e,n)=>(b=[],a=!0,s=!1,l=[],s=0,f=(v,m,x)=>{for(x=0;x<s;x++)l[x]&&l[x][m](v)},n=(o,x,z,c)=>{for(x=0,z=b.length;x<z;x++)(c=b[x],x===z-1?o[s?"return":"throw"](c):o.next(c))},e=(o,t)=>(a&&(l[t=p++]=o),n(o),()=>{a&&(l[t]=void 0)}),{__SEROVAL_STREAM__:!0,on:o=>e(o),next:v=>{a&&(b.push(v),f(v,"next"))},throw:v=>{a&&(b.push(v),f(v,"throw"),a=s=!1,l.length=0)},return:v=>{a&&(b.push(v),f(v,"return"),a=!1,s=!0,l.length=0)}}))()
$R[0].next("foo")
$R[0].next("bar")
$R[0].return("baz")
```

## JSON serialization

The mentioned serialization methods are ideal for server-to-client communication, however, client-to-server communication requires a sanitized data, because the medium is prone to [RCE](https://huntr.dev/bounties/63f1ff91-48f3-4886-a179-103f1ddd8ff8). `seroval` offers JSON modes as an alternative.

| modes | JS | JSON |
| --- | --- | --- |
| sync | `serialize` | `toJSON` |
| async | `serializeAsync` | `toJSONAsync` |
| cross-sync | `crossSerialize` | `toCrossJSON` |
| cross-async | `crossSerializeAsync` | `toCrossJSONAsync` |
| streaming | `crossSerializeStream` | `toCrossJSONStream` |
| deserialization | `deserialize` | `fromJSON` |
| cross-deserialization | `deserialize` | `fromCrossJSON` |

## Push-based streaming serialization

> [!NOTE]
> Coming soon.

## Plugins

All serialization methods can accept plugins. Plugins allows extending the serialization capabilities of `seroval`. You can visit such examples on `seroval-plugins`.

```js

import { serializeAsync } from 'seroval';
import { BlobPlugin } from 'seroval-plugins/web';

const example = new Blob(['Hello, World!'], { type: 'text/plain '});
console.log(await serializeAsync(example, {
  plugins: [
    BlobPlugin,
  ],
})); // new Blob([new Uint8Array([72,101,108,108,111,44,32,87,111,114,108,100,33]).buffer],{type:"text/plain "})
```
import type { Deferred } from './utils/deferred';
import { createDeferred } from './utils/deferred';

interface StreamListener<T> {
  next(value: T): void;
  throw(value: unknown): void;
  return(value: T): void;
}

export interface Stream<T> {
  __SEROVAL_STREAM__: true;

  on(listener: StreamListener<T>): () => void;

  next(value: T): void;
  throw(value: unknown): void;
  return(value: T): void;
}

export function isStream<T>(value: object): value is Stream<T> {
  return '__SEROVAL_STREAM__' in value;
}

export function createStream<T>(): Stream<T> {
  const listeners = new Set<StreamListener<T>>();
  const buffer: unknown[] = [];
  let alive = true;
  let success = true;

  function flushNext(value: T): void {
    for (const listener of listeners.keys()) {
      listener.next(value);
    }
  }

  function flushThrow(value: unknown): void {
    for (const listener of listeners.keys()) {
      listener.throw(value);
    }
  }

  function flushReturn(value: T): void {
    for (const listener of listeners.keys()) {
      listener.return(value);
    }
  }

  return {
    __SEROVAL_STREAM__: true,
    on(listener: StreamListener<T>): () => void {
      if (alive) {
        listeners.add(listener);
      }
      for (let i = 0, len = buffer.length; i < len; i++) {
        const value = buffer[i];
        if (i === len - 1 && !alive) {
          if (success) {
            listener.return(value as T);
          } else {
            listener.throw(value);
          }
        } else {
          listener.next(value as T);
        }
      }
      return () => {
        if (alive) {
          listeners.delete(listener);
        }
      };
    },
    next(value): void {
      if (alive) {
        buffer.push(value);
        flushNext(value);
      }
    },
    throw(value): void {
      if (alive) {
        buffer.push(value);
        flushThrow(value);
        alive = false;
        success = false;
        listeners.clear();
      }
    },
    return(value): void {
      if (alive) {
        buffer.push(value);
        flushReturn(value);
        alive = false;
        success = true;
        listeners.clear();
      }
    },
  };
}

export function createStreamFromAsyncIterable<T>(
  iterable: AsyncIterable<T>,
): Stream<T> {
  const stream = createStream<T>();

  const iterator = iterable[Symbol.asyncIterator]();

  async function push(): Promise<void> {
    try {
      const value = await iterator.next();
      if (value.done) {
        stream.return(value.value as T);
      } else {
        stream.next(value.value);
        await push();
      }
    } catch (error) {
      stream.throw(error);
    }
  }

  push().catch(() => {
    // no-op
  });

  return stream;
}

export function streamToAsyncIterable<T>(
  stream: Stream<T>,
): () => AsyncIterableIterator<T> {
  return (): AsyncIterableIterator<T> => {
    const buffer: T[] = [];
    const pending: Deferred[] = [];
    let count = 0;
    let doneAt = -1;
    let isThrow = false;

    function resolveAll(): void {
      for (let i = 0, len = pending.length; i < len; i++) {
        pending[i].resolve({ done: true, value: undefined });
      }
    }

    stream.on({
      next(value) {
        const current = pending.shift();
        if (current) {
          current.resolve({ done: false, value });
        }
        buffer.push(value);
      },
      throw(value) {
        const current = pending.shift();
        if (current) {
          current.reject(value);
        }
        resolveAll();
        doneAt = buffer.length;
        buffer.push(value as T);
        isThrow = true;
      },
      return(value) {
        const current = pending.shift();
        if (current) {
          current.resolve({ done: true, value });
        }
        resolveAll();
        doneAt = buffer.length;
        buffer.push(value);
      },
    });

    function finalize() {
      const current = count++;
      const value = buffer[current];
      if (current !== doneAt) {
        return { done: false, value };
      }
      if (isThrow) {
        throw value;
      }
      return { done: true, value };
    }

    return {
      [Symbol.asyncIterator](): AsyncIterableIterator<T> {
        return this;
      },
      async next(): Promise<IteratorResult<T>> {
        if (doneAt === -1) {
          const current = count++;
          if (current >= buffer.length) {
            const deferred = createDeferred();
            pending.push(deferred);
            return (await deferred.promise) as Promise<IteratorResult<T>>;
          }
          return { done: false, value: buffer[current] };
        }
        if (count > doneAt) {
          return { done: true, value: undefined };
        }
        return finalize();
      },
    };
  };
}
import type { BaseStreamParserContextOptions } from '../context/parser/stream';
import BaseStreamParserContext from '../context/parser/stream';
import type { SerovalMode } from '../plugin';

export type CrossStreamParserContextOptions = BaseStreamParserContextOptions;

export default class CrossStreamParserContext extends BaseStreamParserContext {
  readonly mode: SerovalMode = 'cross';
}
import { SerovalNodeType } from '../constants';
import type { BaseSerializerContextOptions } from '../context/serializer';
import BaseSerializerContext from '../context/serializer';
import { GLOBAL_CONTEXT_REFERENCES } from '../keys';
import type { SerovalMode } from '../plugin';
import { serializeString } from '../string';
import type { SerovalNode } from '../types';
import type { CrossContextOptions } from './parser';

export interface CrossSerializerContextOptions
  extends BaseSerializerContextOptions,
    CrossContextOptions {}

export default class CrossSerializerContext extends BaseSerializerContext {
  readonly mode: SerovalMode = 'cross';

  scopeId?: string;

  constructor(options: CrossSerializerContextOptions) {
    super(options);
    this.scopeId = options.scopeId;
  }

  getRefParam(id: number): string {
    return GLOBAL_CONTEXT_REFERENCES + '[' + id + ']';
  }

  protected assignIndexedValue(index: number, value: string): string {
    // In cross-reference, we have to assume that
    // every reference are going to be referenced
    // in the future, and so we need to store
    // all of it into the reference array.
    return this.getRefParam(index) + '=' + value;
  }

  serializeTop(tree: SerovalNode): string {
    // Get the serialized result
    const result = this.serialize(tree);
    // If the node is a non-reference, return
    // the result immediately
    const id = tree.i;
    if (id == null) {
      return result;
    }
    // Get the patches
    const patches = this.resolvePatches();
    // Get the variable that represents the root
    const ref = this.getRefParam(id);
    // Parameters needed for scoping
    const params = this.scopeId == null ? '' : GLOBAL_CONTEXT_REFERENCES;
    // If there are patches, append it after the result
    const body = patches ? '(' + result + ',' + patches + ref + ')' : result;
    // If there are no params, there's no need to generate a function
    if (params === '') {
      if (tree.t === SerovalNodeType.Object && !patches) {
        return '(' + body + ')';
      }
      return body;
    }
    // Get the arguments for the IIFE
    const args =
      this.scopeId == null
        ? '()'
        : '(' +
          GLOBAL_CONTEXT_REFERENCES +
          '["' +
          serializeString(this.scopeId) +
          '"])';
    // Create the IIFE
    return '(' + this.createFunction([params], body) + ')' + args;
  }
}
import BaseAsyncParserContext from '../context/parser/async';
import type { SerovalMode } from '../plugin';
import type { CrossParserContextOptions } from './parser';

export type CrossAsyncParserContextOptions = CrossParserContextOptions;

export default class CrossAsyncParserContext extends BaseAsyncParserContext {
  readonly mode: SerovalMode = 'cross';
}
export interface Deferred {
  promise: Promise<unknown>;
  resolve(value: unknown): void;
  reject(value: unknown): void;
}

export function createDeferred(): Deferred {
  let resolve: Deferred['resolve'];
  let reject: Deferred['reject'];
  return {
    promise: new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    }),
    resolve(value): void {
      resolve(value);
    },
    reject(value): void {
      reject(value);
    },
  };
}
import { describe, expect, it } from 'vitest';
import {
  Feature,
  compileJSON,
  crossSerializeAsync,
  crossSerializeStream,
  deserialize,
  fromCrossJSON,
  fromJSON,
  serializeAsync,
  toCrossJSONAsync,
  toCrossJSONStream,
  toJSONAsync,
} from '../src';

const EXAMPLE = {
  title: 'Hello World',
  async *[Symbol.asyncIterator](): AsyncIterator<number> {
    await Promise.resolve();
    yield 1;
    yield 2;
    yield 3;
  },
};

describe('AsyncIterable', () => {
  describe('serializeAsync', () => {
    it('supports AsyncIterables', async () => {
      const result = await serializeAsync(EXAMPLE);
      expect(result).toMatchSnapshot();
      const back = deserialize<typeof EXAMPLE>(result);
      expect(back.title).toBe(EXAMPLE.title);
      expect(Symbol.asyncIterator in back).toBe(true);
      const iterator = back[Symbol.asyncIterator]();
      expect((await iterator.next()).value).toBe(1);
      expect((await iterator.next()).value).toBe(2);
      expect((await iterator.next()).value).toBe(3);
    });
  });
  describe('toJSONAsync', () => {
    it('supports AsyncIterables', async () => {
      const result = await toJSONAsync(EXAMPLE);
      expect(JSON.stringify(result)).toMatchSnapshot();
      const back = fromJSON<typeof EXAMPLE>(result);
      expect(back.title).toBe(EXAMPLE.title);
      expect(Symbol.asyncIterator in back).toBe(true);
      const iterator = back[Symbol.asyncIterator]();
      expect((await iterator.next()).value).toBe(1);
      expect((await iterator.next()).value).toBe(2);
      expect((await iterator.next()).value).toBe(3);
    });
  });
  describe('crossSerializeAsync', () => {
    it('supports AsyncIterables', async () => {
      const result = await crossSerializeAsync(EXAMPLE);
      expect(result).toMatchSnapshot();
    });
    describe('scoped', () => {
      it('supports AsyncIterables', async () => {
        const result = await crossSerializeAsync(EXAMPLE, {
          scopeId: 'example',
        });
        expect(result).toMatchSnapshot();
      });
    });
  });
  describe('crossSerializeStream', () => {
    it('supports AsyncIterables', async () =>
      new Promise<void>((resolve, reject) => {
        crossSerializeStream(EXAMPLE, {
          onSerialize(data) {
            expect(data).toMatchSnapshot();
          },
          onDone() {
            resolve();
          },
          onError(error) {
            reject(error);
          },
        });
      }));
    describe('scoped', () => {
      it('supports AsyncIterables', async () =>
        new Promise<void>((resolve, reject) => {
          crossSerializeStream(EXAMPLE, {
            scopeId: 'example',
            onSerialize(data) {
              expect(data).toMatchSnapshot();
            },
            onDone() {
              resolve();
            },
            onError(error) {
              reject(error);
            },
          });
        }));
    });
  });
  describe('toCrossJSONAsync', () => {
    it('supports AsyncIterables', async () => {
      const result = await toCrossJSONAsync(EXAMPLE);
      expect(JSON.stringify(result)).toMatchSnapshot();
      const back = fromCrossJSON<typeof EXAMPLE>(result, {
        refs: new Map(),
      });
      expect(back.title).toBe(EXAMPLE.title);
      expect(Symbol.asyncIterator in back).toBe(true);
      const iterator = back[Symbol.asyncIterator]();
      expect((await iterator.next()).value).toBe(1);
      expect((await iterator.next()).value).toBe(2);
      expect((await iterator.next()).value).toBe(3);
    });
  });
  describe('toCrossJSONStream', () => {
    it('supports AsyncIterables', async () =>
      new Promise<void>((resolve, reject) => {
        toCrossJSONStream(EXAMPLE, {
          onParse(data) {
            expect(JSON.stringify(data)).toMatchSnapshot();
          },
          onDone() {
            resolve();
          },
          onError(error) {
            reject(error);
          },
        });
      }));
  });
  describe('compat', () => {
    it('should use function expressions instead of arrow functions.', async () => {
      expect(
        await serializeAsync(EXAMPLE, {
          disabledFeatures: Feature.ArrowFunction,
        }),
      ).toMatchSnapshot();
    });
  });
  describe('compat#toJSONAsync', () => {
    it('should use function expression instead of arrow functions.', async () => {
      const result = await toJSONAsync(EXAMPLE, {
        disabledFeatures: Feature.ArrowFunction,
      });
      expect(JSON.stringify(result)).toMatchSnapshot();
      expect(compileJSON(result)).toMatchSnapshot();
    });
  });
});
