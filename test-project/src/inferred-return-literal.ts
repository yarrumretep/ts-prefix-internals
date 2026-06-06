// inferred-return-literal.ts — reproduces the inference-typed literal bug:
// a return-position object literal with NO type annotation anywhere has no
// contextual type, so walk-time literal handling can't resolve its keys.
// Property accesses through the inferred type ARE renamed via the fallback,
// so the keys must be renamed too (via renamePropertyDeclarations) or the
// output object and its readers disagree at runtime.

// Internal class — its private fields put 'label' and 'params' into the
// renamed-property-names set.
class FnInfo {
    private label = 'add';
    private params = ['a', 'b'];

    getLabel(): string {
        return this.label;
    }

    getParams(): string[] {
        return this.params;
    }
}

// NO return type annotation — the literal's type is inferred.
function describeFn(f: FnInfo | undefined) {
    return f ? { label: f.getLabel(), params: f.getParams() } : null;
}

// Shorthand variant — renaming must EXPAND: { label } → { _label: label }.
function describeShorthand(f: FnInfo) {
    const label = f.getLabel();
    const params = f.getParams();
    return { label, params };
}

// Get-accessor variant — the accessor name must be renamed in place.
function describeWithAccessor(f: FnInfo) {
    return {
        get label() {
            return f.getLabel();
        },
    };
}

// Accesses through the inferred types — these get renamed by the fallback,
// which is what forces the literal keys above to follow.
const d = describeFn(new FnInfo());
const total = d ? d.params.length + d.label.length : 0;
void total;

const s = describeShorthand(new FnInfo());
const total2 = s.label.length + s.params.length;
void total2;

const a = describeWithAccessor(new FnInfo());
void a.label;
