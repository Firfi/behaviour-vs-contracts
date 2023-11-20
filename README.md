# behaviour-vs-contracts

playing around with data structures

trying to formulate the idea that some of the borderline between behaviour and contracts in code can and should be moved towards contracts as much as possible

explored idea of visually DSLing tests like

```
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
```
