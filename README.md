# pseudo-lang

An interpreter and VS Code extension for the pseudocode defined in the
**Cambridge International AS & A Level Computer Science 9618** pseudocode guide
(for exams in 2027, 2028 and 2029).

Write pseudocode exactly as the guide specifies, then run it.

```
DECLARE Total : INTEGER
Total <- 0

FOR Index <- 1 TO 10
   Total <- Total + Index
NEXT Index

OUTPUT "The total is ", Total
```

Because 9618 pseudocode is a superset of the pseudocode used at IGCSE, programs
written for Cambridge IGCSE Computer Science 0478 also run unchanged.

## Status

Under construction. See [BUILD_GUIDE.md](BUILD_GUIDE.md) for the full
specification and the milestone plan, and [todo.md](todo.md) for progress.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## Licence

MIT for the code. This is an unofficial tool. It follows the Cambridge 9618
pseudocode guide but is not endorsed by or affiliated with Cambridge University
Press & Assessment.
