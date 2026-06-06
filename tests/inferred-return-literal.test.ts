import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { prefixInternals } from '../src/index.js';
import type { FullResult } from '../src/index.js';

const TEST_PROJECT = path.resolve(import.meta.dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(import.meta.dirname, '../test-project/src/index.ts');

describe('inference-typed object literal keys', () => {
    let result: FullResult;
    let content: string;
    const outDir = path.join(os.tmpdir(), 'ts-prefix-inferred-literal-' + Date.now());

    beforeAll(async () => {
        result = await prefixInternals({
            projectPath: TEST_PROJECT,
            entryPoints: [TEST_ENTRY],
            outDir,
            prefix: '_',
            dryRun: false,
            verbose: false,
            skipValidation: false,
            force: false,
            strict: true,
        });
        content = fs.readFileSync(path.join(outDir, 'src', 'inferred-return-literal.ts'), 'utf-8');
    });

    afterAll(() => {
        fs.rmSync(outDir, { recursive: true, force: true });
    });

    it('renames accesses through the inferred type', () => {
        expect(content).toContain('d._params.length');
        expect(content).toContain('d._label.length');
        expect(content).toContain('s._label.length');
        expect(content).toContain('s._params.length');
        expect(content).toContain('a._label');
    });

    it('renames keys of the inference-typed return literal', () => {
        // { label: f.getLabel(), params: f.getParams() } → { _label: ..., _params: ... }
        expect(content).toContain('_label: f.');
        expect(content).toContain('_params: f.');
    });

    it('expands renamed shorthand properties', () => {
        // { label, params } → { _label: label, _params: params }
        expect(content).toContain('_label: label');
        expect(content).toContain('_params: params');
    });

    it('renames get-accessor names in object literals', () => {
        expect(content).toContain('get _label()');
    });

    it('produces no validation errors for the inferred-literal file', () => {
        const relevant = (result.validationErrors ?? []).filter(e =>
            e.includes('inferred-return-literal'),
        );
        expect(relevant).toEqual([]);
    });
});
