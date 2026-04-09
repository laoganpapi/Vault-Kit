# Vault-Kit: Smart Contract Security Auditor

## Build & Run
- `npm install` — install dependencies
- `npm run build` — compile TypeScript
- `npm test` — run tests (node --test)
- `npm run lint` — type-check without emitting
- `npx vault-kit <file.sol>` — audit a contract
- `npx vault-kit src/ --format markdown` — audit directory with markdown report

## Architecture
- `src/core/` — Types, parser, engine, analysis context
- `src/detectors/` — Modular vulnerability detectors (each extends BaseDetector)
- `src/analyzers/` — Control flow, data flow, call graph analysis
- `src/report/` — Audit report generation and formatting
- `src/utils/` — AST helpers and Solidity pattern utilities
- `test/fixtures/` — Sample Solidity contracts for testing

## Adding a Detector
1. Create `src/detectors/my-detector.ts` extending `BaseDetector`
2. Implement `detect(context: AnalysisContext): Finding[]`
3. Register in `src/detectors/index.ts`

## Code Style
- TypeScript strict mode, no `any` unless interfacing with parser AST
- Each detector is a single class in its own file
- Findings must include severity, confidence, location, and recommendation
