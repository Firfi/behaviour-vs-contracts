import { absurd, apply, flow, pipe } from 'fp-ts/function';
import * as STR from 'fp-ts/string';
import * as A from 'fp-ts/Array';
import * as RA from 'fp-ts/ReadonlyArray';
import * as S from '@effect/schema/Schema';
import { decode, decodeSync } from '@effect/schema/Schema';
import type {
  GenericGraph,
  GraphEvent,
  NodeId,
  XChainId,
  YChainId,
} from '@functional-pipelines-demo/source';
import {
  reduceToXY4,
  reduceToXYNaive0,
  reduceToXYNaive1,
  reduceToXYNaive2,
  reduceToXYNaive3,
} from '@functional-pipelines-demo/source';
import { describe, expect } from 'vitest';
import { isNone } from 'fp-ts/Option';

const Dimension = S.number.pipe(S.int());
type Dimension = S.Schema.To<typeof Dimension>;

const SPACE = ' ' as const;
const O_CELL = 'o' as const;
const X_CELL = 'x' as const;
const X_LINE = '-' as const;
const Y_LINE = '|' as const;

const TOKENS = [O_CELL, X_CELL, X_LINE, Y_LINE, SPACE] as const;
const TOKENSS = new Set(TOKENS);
const Token = S.literal(...TOKENS);
type Token = S.Schema.To<typeof Token>;

const getWidth = flow(
  RA.map(flow(STR.split(''), RA.size)),
  (ns) => Math.max(...ns) as Dimension
);

const toTokenMatrix = flow((s: string) =>
  pipe(s, STR.split('\n'), (ss) =>
    pipe(
      ss,
      RA.map(
        flow(
          (s) => (w: number) => s.padEnd(w, SPACE),
          apply(getWidth(ss)),
          STR.split(''),
          RA.map(flow((s) => s as Token, S.decodeSync(Token)))
        )
      )
    )
  )
);

const tokenMatrixToIndices = (ts: readonly (readonly Token[])[]) => {
  const xChains: number[][] = []; // every object of x chain, for each x chain; twice smaller than dimension
  const yChains: number[][] = []; // every object of y chain, for each y chain; twice smaller than dimension
  for (let yi_ = 0; yi_ < ts.length; yi_++) {
    const row = ts[yi_]!;
    const isYSpan = yi_ % 2 === 1;

    for (let xi_ = 0; xi_ < row.length; xi_++) {
      const isXSpan = xi_ % 2 === 1;
      const token = row[xi_]!;
      if (isXSpan && token !== X_LINE && token !== SPACE)
        throw new Error(`Expected ${X_LINE} but got ${token}`);
      if (isYSpan && token !== Y_LINE && token !== SPACE)
        throw new Error(`Expected ${Y_LINE} but got ${token}`);
      if (isXSpan || isYSpan) continue;
      const yi = decodeSync(Dimension)(yi_ / 2); // always (assumed) integer
      const xi = decodeSync(Dimension)(xi_ / 2); // always (assumed) integer
      // yChains always expected // TODO xChains are?
      if (!yChains[xi]) yChains[xi] = [];
      switch (token) {
        case X_CELL:
          if (!xChains[yi]) xChains[yi] = [];
          xChains[yi]!.push(xi);
          yChains[xi]!.push(yi);
          break;
        case O_CELL:
          if (!xChains[yi]) xChains[yi] = [];
          xChains[yi]!.push(xi);
          break;
        case SPACE:
          break;
        case Y_LINE:
          break;
        case X_LINE:
          break;
        default:
          absurd(token);
      }
    }
  }
  return {
    xChains,
    yChains,
  };
};

/*
type: S.literal('xAdded'),
    id: NodeId,
    chainId: XChainId
 */
const xIndicesToEvents = (xChains: number[][]): readonly GraphEvent[] =>
  pipe(
    xChains,
    RA.mapWithIndex((yi, xChain) =>
      pipe(
        xChain,
        RA.map((/*xi doesn't matter here*/ x) => ({
          type: 'xAdded' as const,
          id: `${x}` as NodeId,
          chainId: `${yi}` as XChainId,
        }))
      )
    ),
    RA.flatten
  );

const yIndicesToEvents = (yChains: number[][]): readonly GraphEvent[] =>
  pipe(
    yChains,
    RA.mapWithIndex((xi, yChain) =>
      pipe(
        yChain,
        RA.map((/*yi doesn't matter here*/ y) => ({
          type: 'yAdded' as const,
          id: `${xi}` as NodeId,
          xChainId: `${y}` as XChainId,
          // id can be assumed to be xi here (not true in fuller graphs)
          yChainId: `${xi}` as YChainId,
        }))
      )
    ),
    RA.flatten
  );

const indicesToEvents = ({
  xChains,
  yChains,
}: ReturnType<typeof tokenMatrixToIndices>): readonly GraphEvent[] =>
  pipe(
    [
      // xChains are independent
      xIndicesToEvents(xChains),
      // yChains are always dependent on xChains
      yIndicesToEvents(yChains),
    ],
    RA.flatten
  );

const trimNewlines = flow(
  STR.split('\n'),
  (a) =>
    pipe(
      a,
      RA.filterWithIndex(
        (i, x) => (i !== 0 && i !== a.length - 1) || x.trim().length > 0
      )
    ),
  (a) => a.join('\n')
);

const asciiToEvents = flow(
  trimNewlines,
  toTokenMatrix,
  tokenMatrixToIndices,
  indicesToEvents
);

const toAscii = (gg: GenericGraph): string => {
  const spannedHeight = gg.x.size;
  const nodeIds = pipe([...gg.x.values()], A.flatten, (s) => new Set(s));
  const spannedWidth = nodeIds.size;
  const matrix: Token[][] = new Array(spannedHeight * 2)
    .fill(null)
    .map(() => new Array(spannedWidth * 2).fill(SPACE));
  const xsOrdered: [XChainId, NodeId[]][] = [...gg.x.entries()].sort(
    ([a], [b]) => STR.Ord.compare(a, b)
  );
  // ^ yOrdered isn't needed; they anchor to Xs
  const nodesOrdered = [...nodeIds].sort(STR.Ord.compare);
  for (let i__ = 0; i__ < spannedHeight; i__++) {
    for (let j__ = 0; j__ < spannedWidth; j__++) {
      const i = i__ * 2;
      const j = j__ * 2;
      const i_ = i + 1;
      const j_ = j + 1;
      const thisCell = [i, j] as const;
      const rightSpannedCell = [i, j_] as const;
      const bottomSpannedCell = [i_, j] as const;
      const [xChainId_, xLine] = xsOrdered[i__]!;
      const nodeId = xLine.find((x) => x === nodesOrdered[j__]);
      const yChain = [...gg.y.entries()].find(([yChainId, a]) =>
        a.find(
          ({ xChainId, nodeId: nodeId_ }) =>
            xChainId === xChainId_ && nodeId_ === nodeId
        )
      );

      const hasNode = nodeId !== undefined;
      if (hasNode) {
        const drawExistingNodes = () => {
          matrix[thisCell[0]]![thisCell[1]] = yChain ? X_CELL : O_CELL;
          if (yChain) {
            const isLastY =
              yChain[1].findIndex(
                ({ xChainId, nodeId: nodeId_ }) =>
                  xChainId === xChainId_ && nodeId_ === nodeId
              ) ===
              yChain[1].length - 1;
            if (!isLastY) {
              matrix[bottomSpannedCell[0]]![bottomSpannedCell[1]] = Y_LINE;
            }
          }

          const isLastX =
            xLine.findIndex((x) => x === nodeId) === xLine.length - 1;
          if (!isLastX) {
            matrix[rightSpannedCell[0]]![rightSpannedCell[1]] = X_LINE;
          }
        };

        drawExistingNodes();
      } else {
        const drawEmptyXDashes = () => {
          let nextNodeId: NodeId | undefined = undefined;
          // TODO a bit wasteful
          for (let nextJ__ = j__ + 1; nextJ__ < spannedWidth; nextJ__++) {
            nextNodeId = xLine.find((x) => x === nodesOrdered[nextJ__]);
            if (nextNodeId) break;
          }
          let prevNodeId: NodeId | undefined = undefined;
          // TODO a bit wasteful
          for (let prevJ__ = j__ - 1; prevJ__ >= 0; prevJ__--) {
            prevNodeId = xLine.find((x) => x === nodesOrdered[prevJ__]);
            if (prevNodeId) break;
          }
          const hasNextX = nextNodeId !== undefined;
          const hasPrevX = prevNodeId !== undefined;
          if (hasNextX && hasPrevX) {
            // no want to connect nothing with something
            // draw dash right here
            matrix[thisCell[0]]![thisCell[1]] = X_LINE;
            matrix[rightSpannedCell[0]]![rightSpannedCell[1]] = X_LINE;
          }
        };

        drawEmptyXDashes();

        const drawEmptyYDashes = () => {
          let nextNodeId = undefined;
          // TODO a bit wasteful
          for (let nextI__ = i__ + 1; nextI__ < spannedHeight; nextI__++) {
            nextNodeId = xsOrdered[nextI__]![1].find(
              (x) => x === nodesOrdered[j__]
            );
            if (nextNodeId) break;
          }
          let prevNodeId = undefined;
          // TODO a bit wasteful
          for (let prevI__ = i__ - 1; prevI__ >= 0; prevI__--) {
            prevNodeId = xsOrdered[prevI__]![1].find(
              (x) => x === nodesOrdered[j__]
            );
            if (prevNodeId) break;
          }
          const hasNextY = nextNodeId !== undefined;
          const hasPrevY = prevNodeId !== undefined;
          if (hasNextY && hasPrevY) {
            // no want to connect nothing with something
            // draw dash right here
            matrix[thisCell[0]]![thisCell[1]] = Y_LINE;
            matrix[bottomSpannedCell[0]]![bottomSpannedCell[1]] = Y_LINE;
          }
        };

        drawEmptyYDashes();
      }
    }
  }

  return pipe(
    matrix,
    A.map((row) => row.join('')),
    (a) => a.join('\n'),
    normalizeAscii
  );
};

const normalizeAsciiRectangle = (ascii: string) => {
  const rows = ascii.split('\n').map((s) => s.trimEnd());
  const maxWidth = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => row.padEnd(maxWidth, SPACE)).join('\n');
};

const normalizeAscii = flow(trimNewlines, normalizeAsciiRectangle);

/*
 x is a directed chain; i.e. a linked list with a direction
 nodes in one x chain have to be unique
 y is more like a tag or undirected graph; on graphics it's convenient to represent them as lines but the line representation becomes quite inconvenient computationally
 on one y chain, nodeId is always fixed
 y chain is attached to one or more x chains by its nodeId
 node in y chain cannot exist without existing in an x chain
 xChainIds in one y chain cannot be duplicated
 */

describe('dataStructuresDemo', () => {
  const ASCII = `
o-x-o-x-o-x
  |       |
o-x-o     |
  |       |
  x-------x-o-o      
`;
  const ASCII_EVENTS = asciiToEvents(ASCII);
  it('naive valid events should work', () => {
    expect(pipe(ASCII_EVENTS, reduceToXYNaive0, toAscii)).toEqual(
      normalizeAscii(ASCII)
    );
  });

  describe('nodes in one x chain have to be unique', () => {
    it('naive dupe node events shouldnt work', () => {
      const xToTackleO = pipe(
        ASCII_EVENTS,
        RA.findFirst(
          (e): e is typeof e & { type: 'xAdded' } => e.type === 'xAdded'
        )
      );
      if (isNone(xToTackleO))
        throw new Error('Expected xToTackleO to be defined');
      const xToTackle = xToTackleO.value;
      const xChainIdToTackle = xToTackle.chainId;
      const nodeIdToTackle = xToTackle.id;
      const graph = pipe(
        ASCII_EVENTS,
        RA.appendW({
          type: 'xAdded',
          id: nodeIdToTackle,
          chainId: xChainIdToTackle,
        } satisfies GraphEvent),
        reduceToXYNaive0
      );
      /*artifacts appear*/
      expect(
        pipe(
          `
o-x-o-x-o-x-   
  |       |    
o-x-o     |    
  |       |    
  x-------x-o-o
`,
          trimNewlines
        )
      ).toEqual(pipe(graph, toAscii, normalizeAscii));
      expect(graph.x.get(xChainIdToTackle)!.length).toEqual(7); /*one too many*/
    });
    it('naive dupe node events shouldnt work with naive1', () => {
      const xToTackleO = pipe(
        ASCII_EVENTS,
        RA.findFirst(
          (e): e is typeof e & { type: 'xAdded' } => e.type === 'xAdded'
        )
      );
      if (isNone(xToTackleO))
        throw new Error('Expected xIdToTackleO to be defined');
      const xToTackle = xToTackleO.value;
      const xChainIdToTackle = xToTackle.chainId;
      const nodeIdToTackle = xToTackle.id;
      expect(() =>
        pipe(
          ASCII_EVENTS,
          RA.appendW({
            type: 'xAdded',
            id: nodeIdToTackle,
            chainId: xChainIdToTackle,
          } satisfies GraphEvent),
          reduceToXYNaive1
        )
      ).toThrowError('duplicate');
    });
  });
  describe('on one y chain, nodeId is always fixed', () => {
    it('naive dupe y node events shouldnt work', () => {
      const yToTackleO = pipe(
        ASCII_EVENTS,
        RA.findFirst(
          (e): e is typeof e & { type: 'yAdded' } => e.type === 'yAdded'
        )
      );
      if (isNone(yToTackleO))
        throw new Error('Expected yToTackleO to be defined');
      const yToTackle = yToTackleO.value;
      const nodeIdToTackle = yToTackle.id;
      const graph = pipe(
        ASCII_EVENTS,
        RA.appendW({
          type: 'yAdded',
          id: nodeIdToTackle,
          xChainId: yToTackle.xChainId,
          yChainId: yToTackle.yChainId,
        } satisfies GraphEvent),
        reduceToXYNaive1
      );
      /*artifacts appear*/
      expect(
        pipe(
          `
o-x-o-x-o-x    
  |       |    
o-x-o     |    
  |       |    
  x-------x-o-o
  |            
`,
          trimNewlines
        )
      ).toEqual(pipe(graph, toAscii, normalizeAscii));
      expect(graph.y.get(yToTackle.yChainId)!.length).toEqual(
        4
      ); /*one too many*/
    });
    it('naive dupe y node events shouldnt work with naive2', () => {
      const yToTackleO = pipe(
        ASCII_EVENTS,
        RA.findFirst(
          (e): e is typeof e & { type: 'yAdded' } => e.type === 'yAdded'
        )
      );
      if (isNone(yToTackleO))
        throw new Error('Expected yToTackleO to be defined');
      const yToTackle = yToTackleO.value;
      const nodeIdToTackle = yToTackle.id;
      expect(() =>
        pipe(
          ASCII_EVENTS,
          RA.appendW({
            type: 'yAdded',
            id: nodeIdToTackle,
            xChainId: yToTackle.xChainId,
            yChainId: yToTackle.yChainId,
          } satisfies GraphEvent),
          reduceToXYNaive2
        )
      ).toThrowError('duplicate');
    });
  });

  describe('y chain is attached to one or more x chains by its nodeId', () => {
    it('naive attach y node on non-existing in X nodeId events shouldnt work', () => {
      // where we try to attach:
      const _ = `
o-x-o-x-o-x    
  |       |    
o-x-o !   |    
  |       |    
  x-------x-o-o            
`;
      const yToTackle1Node = '3' as NodeId;
      const xToTackleChainId = '1' as XChainId;
      const yToTackleChainId = '3' /*1,3,5*/ as YChainId;
      const graph = pipe(
        ASCII_EVENTS,
        RA.appendW({
          type: 'yAdded',
          id: yToTackle1Node,
          xChainId: xToTackleChainId,
          yChainId: yToTackleChainId,
        } satisfies GraphEvent),
        reduceToXYNaive2
      );
      /*artifacts appear*/
      expect(
        pipe(
          `
o-x-o-x-o-x    
  |   |   |    
o-x-o     |    
  |       |    
  x-------x-o-o
`,
          trimNewlines
        )
      ).toEqual(pipe(graph, toAscii, normalizeAscii));
      expect(graph.y.get(yToTackleChainId)!.length).toEqual(
        2
      ); /* should be impossible cause no X to attach to */
    });
    it('naive attach y node on non-existing in X nodeId events shouldnt work with naive3', () => {
      const yToTackle1Node = '3' as NodeId;
      const xToTackleChainId = '1' as XChainId;
      const yToTackleChainId = '3' /*1,3,5*/ as YChainId;
      expect(() =>
        pipe(
          ASCII_EVENTS,
          RA.appendW({
            type: 'yAdded',
            id: yToTackle1Node,
            xChainId: xToTackleChainId,
            yChainId: yToTackleChainId,
          } satisfies GraphEvent),
          reduceToXYNaive3
        )
      ).toThrowError('not initialized');
    });
  });

  describe('xChainIds in one y chain cannot be duplicated', () => {
    it('naive attach duplicated xChainId to y should work', () => {
      // where we try to attach:
      const _ = `
o-x-o-x-!-x    
  |       |    
o-x-o     |    
  |       |    
  x-------x-o-o            
`;
      const yToTackle1Node = '4' as NodeId;
      const xToTackleChainId = '0' as XChainId;
      const yToTackleChainId = '5' /*1,3,5*/ as YChainId;
      const graph = pipe(
        ASCII_EVENTS,
        RA.appendW({
          type: 'yAdded',
          id: yToTackle1Node,
          xChainId: xToTackleChainId,
          yChainId: yToTackleChainId,
        } satisfies GraphEvent),
        reduceToXYNaive3
      );
      /*artifacts appear*/
      expect(
        pipe(
          `
o-x-o-x-x-x    
  |     | |    
o-x-o     |    
  |       |    
  x-------x-o-o
`,
          trimNewlines
        )
      ).toEqual(pipe(graph, toAscii, normalizeAscii));
      expect(graph.y.get(yToTackleChainId)!.length).toEqual(3); // invariant broken
    });

    it('final xChainId to y shouldnt work with final', () => {
      const yToTackle1Node = '4' as NodeId;
      const xToTackleChainId = '0' as XChainId;
      const yToTackleChainId = '5' /*1,3,5*/ as YChainId;
      expect(() =>
        pipe(
          ASCII_EVENTS,
          RA.appendW({
            type: 'yAdded',
            id: yToTackle1Node,
            xChainId: xToTackleChainId,
            yChainId: yToTackleChainId,
          } satisfies GraphEvent),
          reduceToXY4
        )
      ).toThrowError('duplicate');
    });
  });
  describe('final implementation passes all tricks', () => {
    it('naive valid events should work', () => {
      expect(pipe(ASCII_EVENTS, reduceToXY4, toAscii)).toEqual(
        normalizeAscii(ASCII)
      );
    });
    it('dupe node events shouldnt work', () => {
      const xToTackleO = pipe(
        ASCII_EVENTS,
        RA.findFirst(
          (e): e is typeof e & { type: 'xAdded' } => e.type === 'xAdded'
        )
      );
      if (isNone(xToTackleO))
        throw new Error('Expected xIdToTackleO to be defined');
      const xToTackle = xToTackleO.value;
      const xChainIdToTackle = xToTackle.chainId;
      const nodeIdToTackle = xToTackle.id;
      expect(() =>
        pipe(
          ASCII_EVENTS,
          RA.appendW({
            type: 'xAdded',
            id: nodeIdToTackle,
            chainId: xChainIdToTackle,
          } satisfies GraphEvent),
          reduceToXY4
        )
      ).toThrowError('duplicate');
    });

    it('dupe y node events shouldnt work', () => {
      const yToTackleO = pipe(
        ASCII_EVENTS,
        RA.findFirst(
          (e): e is typeof e & { type: 'yAdded' } => e.type === 'yAdded'
        )
      );
      if (isNone(yToTackleO))
        throw new Error('Expected yToTackleO to be defined');
      const yToTackle = yToTackleO.value;
      const nodeIdToTackle = yToTackle.id;
      expect(() =>
        pipe(
          ASCII_EVENTS,
          RA.appendW({
            type: 'yAdded',
            id: nodeIdToTackle,
            xChainId: yToTackle.xChainId,
            yChainId: yToTackle.yChainId,
          } satisfies GraphEvent),
          reduceToXY4
        )
      ).toThrowError('duplicate');
    });

    it('attach y node on non-existing in X nodeId events shouldnt work', () => {
      const yToTackle1Node = '3' as NodeId;
      const xToTackleChainId = '1' as XChainId;
      const yToTackleChainId = '3' /*1,3,5*/ as YChainId;
      expect(() =>
        pipe(
          ASCII_EVENTS,
          RA.appendW({
            type: 'yAdded',
            id: yToTackle1Node,
            xChainId: xToTackleChainId,
            yChainId: yToTackleChainId,
          } satisfies GraphEvent),
          reduceToXY4
        )
      ).toThrowError('not found');
    });

    it('wrong xChainId to y shouldnt work', () => {
      const yToTackle1Node = '4' as NodeId;
      const xToTackleChainId = '0' as XChainId;
      const yToTackleChainId = '5' /*1,3,5*/ as YChainId;
      expect(() =>
        pipe(
          ASCII_EVENTS,
          RA.appendW({
            type: 'yAdded',
            id: yToTackle1Node,
            xChainId: xToTackleChainId,
            yChainId: yToTackleChainId,
          } satisfies GraphEvent),
          reduceToXY4
        )
      ).toThrowError('duplicate');
    });
  });
});
