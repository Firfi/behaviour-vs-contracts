import * as S from '@effect/schema/Schema';
import WebSocket_2 from 'vite';
import { absurd, flow } from 'fp-ts/function';
import { OrderedMap, OrderedSet } from 'immutable';
import { pipe } from 'fp-ts/function';
import * as MAP from 'fp-ts/Map';
import * as A from 'fp-ts/Array';
import * as NEA from 'fp-ts/NonEmptyArray';
import * as REC from 'fp-ts/Record';
import * as O from 'fp-ts/Option';
import type { Option } from 'fp-ts/Option';
import { isNone, none, some } from 'fp-ts/Option';

export const XChainId = S.string.pipe(S.brand('XChainId'));
export type XChainId = S.Schema.To<typeof XChainId>;

export const YChainId = S.string.pipe(S.brand('YChainId'));
export type YChainId = S.Schema.To<typeof YChainId>;

export const NodeId = S.string.pipe(S.brand('NodeId'));
export type NodeId = S.Schema.To<typeof NodeId>;

export const GraphEvent = S.union(
  S.struct({
    type: S.literal('xAdded'),
    id: NodeId,
    chainId: XChainId,
  }),
  S.struct({
    type: S.literal('yAdded'),
    id: NodeId,
    xChainId: XChainId,
    yChainId: YChainId,
  })
);

/*
RULES:
 x is a directed chain; i.e. a linked list with a direction
 nodes in one x chain have to be unique
 y is more like a tag or undirected graph; on graphics it's convenient to represent them as lines but the line representation becomes quite inconvenient computationally
 on one y chain, nodeId is always fixed
 y chain is attached to one or more x chains by its nodeId
 node in y chain cannot exist without existing in an x chain
 xChainIds in one y chain cannot be duplicated
 */

// our graph is lucky: its property is that it can be event sourced

export type GraphEvent = S.Schema.To<typeof GraphEvent>;

export type GenericGraph = {
  x: Map<XChainId, NodeId[]>;
  y: Map<
    YChainId,
    {
      xChainId: XChainId;
      nodeId: NodeId;
    }[]
  >;
};

// TODO show that this one needs a hell of a lot of tests to work
export const reduceToXYMutableNaive0 = (
  events: readonly GraphEvent[]
): GenericGraph => {
  const xs: Map<XChainId, NodeId[]> = new Map();
  const ys: Map<
    YChainId,
    {
      xChainId: XChainId;
      nodeId: NodeId;
    }[]
  > = new Map();
  for (const e of events) {
    switch (e.type) {
      case 'xAdded':
        if (!xs.get(e.chainId)) xs.set(e.chainId, []);
        xs.get(e.chainId)!.push(e.id);
        break;
      case 'yAdded':
        if (!ys.get(e.yChainId)) ys.set(e.yChainId, []);
        ys.get(e.yChainId)!.push({
          xChainId: e.xChainId,
          nodeId: e.id,
        });
        break;
      default:
        absurd(e);
        throw new Error('unreachable');
    }
  }
  return {
    x: xs,
    y: ys,
  };
};

const orderedSetOnce = <T>() => {
  const api = (os: OrderedSet<T>) => ({
    add: (t: T) => {
      // TODO Either
      if (os.has(t))
        throw new Error(`panic! duplicate ${t} in set; allowed only once`);
      return api(os.add(t));
    },
    toArray: () => os.toArray(),
  });

  return api(OrderedSet<T>());
};

type OrderedSetOnce<T> = ReturnType<typeof orderedSetOnce<T>>;

export const reduceToXYMutableNaive1 = (
  events: readonly GraphEvent[]
): GenericGraph => {
  // used OrderedSet instead of Array
  const xs: Map<XChainId, OrderedSetOnce<NodeId>> = new Map();
  const ys: Map<
    YChainId,
    {
      xChainId: XChainId;
      nodeId: NodeId;
    }[]
  > = new Map();
  for (const e of events) {
    switch (e.type) {
      case 'xAdded':
        if (!xs.get(e.chainId)) xs.set(e.chainId, orderedSetOnce());
        xs.set(e.chainId, xs.get(e.chainId)!.add(e.id));
        break;
      case 'yAdded':
        if (!ys.get(e.yChainId)) ys.set(e.yChainId, []);
        ys.get(e.yChainId)!.push({
          xChainId: e.xChainId,
          nodeId: e.id,
        });
        break;
      default:
        absurd(e);
        throw new Error('unreachable');
    }
  }
  return {
    x: pipe(
      xs,
      MAP.map((s) => s.toArray())
    ),
    y: ys,
  };
};

const mapOnce = <K, V>() => {
  const api = (m: Map<K, V>) => ({
    set: (k: K, v: V) => {
      // TODO Either
      if (m.has(k))
        throw new Error(`panic! duplicate ${k} in map; allowed only once`);
      return api(m.set(k, v));
    },
    entries: () => [...m.entries()],
  });

  return api(new Map<K, V>());
};

type MapOnce<K, V> = ReturnType<typeof mapOnce<K, V>>;

const orderedMapOnceO = <K, V>() => {
  // state machine: empty -> none -> some
  const api = (m: OrderedMap<K, Option<V>>) => ({
    init: (k: K) => {
      // TODO Either
      if (m.has(k))
        throw new Error(`panic! duplicate ${k} in map; allowed only once`);
      return api(m.set(k, none));
    },
    set: (k: K, v: V) => {
      if (!m.has(k)) throw new Error(`panic! ${k} not initialized`);
      if (!isNone(m.get(k)!)) throw new Error(`panic! ${k} already set`);
      return api(m.set(k, some(v)));
    },
    entries: () => [...m.entries()],
    keys: () => [...m.keys()],
  });

  return api(OrderedMap<K, Option<V>>());
};

type OrderedMapOnceO<K, V> = ReturnType<typeof orderedMapOnceO<K, V>>;

export const reduceToXYMutableNaive2 = (
  events: readonly GraphEvent[]
): GenericGraph => {
  const xs: Map<XChainId, OrderedSetOnce<NodeId>> = new Map();
  const ys: Map<YChainId, MapOnce<XChainId, NodeId>> = new Map();
  for (const e of events) {
    switch (e.type) {
      case 'xAdded':
        if (!xs.get(e.chainId)) xs.set(e.chainId, orderedSetOnce());
        xs.set(e.chainId, xs.get(e.chainId)!.add(e.id));
        break;
      case 'yAdded':
        if (!ys.get(e.yChainId)) ys.set(e.yChainId, mapOnce());
        ys.get(e.yChainId)!.set(e.xChainId, e.id);
        break;
      default:
        absurd(e);
        throw new Error('unreachable');
    }
  }
  return {
    x: pipe(
      xs,
      MAP.map((s) => s.toArray())
    ),
    y: pipe(
      ys,
      MAP.map((m) =>
        [...m.entries()].map((e) => ({
          xChainId: e[0],
          nodeId: e[1],
        }))
      )
    ),
  };
};

export const reduceToXYMutableNaive3 = (
  events: readonly GraphEvent[]
): GenericGraph => {
  const chains: Map<XChainId, OrderedMapOnceO<NodeId, YChainId>> = new Map();
  for (const e of events) {
    switch (e.type) {
      case 'xAdded':
        if (!chains.get(e.chainId)) chains.set(e.chainId, orderedMapOnceO());
        chains.set(e.chainId, chains.get(e.chainId)!.init(e.id));
        break;
      case 'yAdded':
        // TODO better to have explicit check for existence of xChainId, for better error message
        chains.set(e.xChainId, chains.get(e.xChainId)!.set(e.id, e.yChainId));
        break;
      default:
        absurd(e);
        throw new Error('unreachable');
    }
  }
  return {
    x: pipe(
      chains,
      MAP.map((c) => c.keys())
    ),
    y: pipe(
      [...chains.entries()],
      A.map((e) => {
        const xChainId = e[0];
        return pipe(
          [...e[1].entries()],
          A.filterMap((e) =>
            pipe(
              e[1],
              O.map((yChainId) => ({
                xChainId,
                nodeId: e[0],
                yChainId,
              }))
            )
          ),
          (a) => a
        );
      }),
      A.flatten,
      NEA.groupBy((e) => e.yChainId),
      REC.map(
        NEA.map((e) => ({
          xChainId: e.xChainId,
          nodeId: e.nodeId,
        }))
      ),
      REC.toEntries,
      (es) => es as [YChainId, (typeof es)[number][1]][],
      (es) => new Map(es)
    ),
  };
};
