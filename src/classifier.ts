import ts from 'typescript';
import type { RenameDecision } from './config.js';

export interface ClassificationResult {
  willPrefix: RenameDecision[];
  willNotPrefix: RenameDecision[];
  warnings: string[];
  symbolsToRename: Map<ts.Symbol, string>; // symbol -> new name
}

export function classifySymbols(
  program: ts.Program,
  checker: ts.TypeChecker,
  publicApiSymbols: Set<ts.Symbol>,
  entryPoints: string[],
  prefix: string
): ClassificationResult {
  const willPrefix: RenameDecision[] = [];
  const willNotPrefix: RenameDecision[] = [];
  const warnings: string[] = [];
  const symbolsToRename = new Map<ts.Symbol, string>();
  const processed = new Set<ts.Symbol>();

  const entrySet = new Set(entryPoints.map(e => ts.sys.resolvePath(e)));

  function isProjectSourceFile(sf: ts.SourceFile): boolean {
    if (sf.isDeclarationFile) return false;
    if (sf.fileName.includes('node_modules')) return false;
    return true;
  }

  function isPublicSymbol(symbol: ts.Symbol): boolean {
    return publicApiSymbols.has(symbol);
  }

  function resolveSymbol(symbol: ts.Symbol): ts.Symbol {
    if (symbol.flags & ts.SymbolFlags.Alias) {
      try {
        return checker.getAliasedSymbol(symbol);
      } catch {
        return symbol;
      }
    }
    return symbol;
  }

  function getSourceLocation(symbol: ts.Symbol): { fileName: string; line: number } | undefined {
    const decls = symbol.getDeclarations();
    if (!decls || decls.length === 0) return undefined;
    const decl = decls[0];
    const sf = decl.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(decl.getStart());
    return { fileName: sf.fileName, line: line + 1 };
  }

  function hasDecorators(node: ts.Node): boolean {
    // In TS 5.x, decorators are modifiers
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (modifiers) {
      for (const mod of modifiers) {
        if (mod.kind === ts.SyntaxKind.Decorator) return true;
      }
    }
    // Also check via canHaveDecorators
    const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
    return decorators !== undefined && decorators.length > 0;
  }

  function shouldSkipSymbol(symbol: ts.Symbol, name: string): boolean {
    if (name === 'constructor') return true;
    if (name.startsWith(prefix)) return true;
    return false;
  }

  function isFromExternalOrDts(symbol: ts.Symbol): boolean {
    const decls = symbol.getDeclarations();
    if (!decls || decls.length === 0) return true;
    for (const decl of decls) {
      const sf = decl.getSourceFile();
      if (sf.isDeclarationFile) return true;
      if (sf.fileName.includes('node_modules')) return true;
    }
    return false;
  }

  function getSymbolKind(symbol: ts.Symbol): string {
    if (symbol.flags & ts.SymbolFlags.Class) return 'class';
    if (symbol.flags & ts.SymbolFlags.Interface) return 'interface';
    if (symbol.flags & ts.SymbolFlags.Enum) return 'enum';
    if (symbol.flags & ts.SymbolFlags.EnumMember) return 'enum-member';
    if (symbol.flags & ts.SymbolFlags.Function) return 'function';
    if (symbol.flags & ts.SymbolFlags.Variable) return 'variable';
    if (symbol.flags & ts.SymbolFlags.Method) return 'method';
    if (symbol.flags & ts.SymbolFlags.Property) return 'property';
    if (symbol.flags & ts.SymbolFlags.Accessor) return 'accessor';
    if (symbol.flags & ts.SymbolFlags.GetAccessor) return 'getter';
    if (symbol.flags & ts.SymbolFlags.SetAccessor) return 'setter';
    return 'unknown';
  }

  function classifyOne(
    symbol: ts.Symbol,
    qualifiedName: string,
    shouldPrefix: boolean,
    reason: string
  ): void {
    if (processed.has(symbol)) return;
    processed.add(symbol);

    const loc = getSourceLocation(symbol);
    if (!loc) return;

    const name = symbol.getName();

    // Check if any declaration has decorators
    const decls = symbol.getDeclarations() ?? [];
    for (const decl of decls) {
      if (hasDecorators(decl)) return;
    }

    if (shouldSkipSymbol(symbol, name)) return;

    const decision: RenameDecision = {
      symbolName: name,
      qualifiedName,
      kind: getSymbolKind(symbol),
      fileName: loc.fileName,
      line: loc.line,
      newName: shouldPrefix ? `${prefix}${name}` : name,
      reason,
    };

    if (shouldPrefix) {
      willPrefix.push(decision);
      symbolsToRename.set(symbol, `${prefix}${name}`);
    } else {
      willNotPrefix.push(decision);
    }
  }

  function processClassMembers(
    classDecl: ts.ClassDeclaration,
    classSymbol: ts.Symbol,
    classIsPublic: boolean,
    className: string
  ): void {
    for (const member of classDecl.members) {
      // Skip constructors (but handle parameter properties below)
      if (ts.isConstructorDeclaration(member)) {
        // Process constructor parameter properties
        for (const param of member.parameters) {
          const modifiers = ts.getCombinedModifierFlags(param);
          const isParamProp = modifiers & (
            ts.ModifierFlags.Public |
            ts.ModifierFlags.Private |
            ts.ModifierFlags.Protected |
            ts.ModifierFlags.Readonly
          );
          if (!isParamProp) continue;

          const paramSymbol = param.name ? checker.getSymbolAtLocation(param.name) : undefined;
          if (!paramSymbol) continue;
          if (isFromExternalOrDts(paramSymbol)) continue;

          const paramName = paramSymbol.getName();
          const qualifiedName = `${className}.${paramName}`;

          if (classIsPublic) {
            const isPrivate = modifiers & ts.ModifierFlags.Private;
            if (isPrivate) {
              classifyOne(paramSymbol, qualifiedName, true, 'private member of public class');
            } else {
              const memberIsPublic = isPublicSymbol(paramSymbol);
              classifyOne(paramSymbol, qualifiedName, !memberIsPublic, memberIsPublic ? 'public API member' : 'non-public member of public class');
            }
          } else {
            classifyOne(paramSymbol, qualifiedName, true, 'member of internal class');
          }
        }
        continue;
      }

      const memberSymbol = member.name ? checker.getSymbolAtLocation(member.name) : undefined;
      if (!memberSymbol) continue;
      if (isFromExternalOrDts(memberSymbol)) continue;

      const memberName = memberSymbol.getName();
      const qualifiedName = `${className}.${memberName}`;

      if (classIsPublic) {
        const modifiers = ts.getCombinedModifierFlags(member);
        const isPrivate = modifiers & ts.ModifierFlags.Private;
        if (isPrivate) {
          classifyOne(memberSymbol, qualifiedName, true, 'private member of public class');
        } else {
          const memberIsPublic = isPublicSymbol(memberSymbol);
          classifyOne(memberSymbol, qualifiedName, !memberIsPublic, memberIsPublic ? 'public API member' : 'non-public member of public class');
        }
      } else {
        classifyOne(memberSymbol, qualifiedName, true, 'member of internal class');
      }
    }
  }

  function processInterfaceMembers(
    ifaceDecl: ts.InterfaceDeclaration,
    ifaceSymbol: ts.Symbol,
    ifaceIsPublic: boolean,
    ifaceName: string
  ): void {
    for (const member of ifaceDecl.members) {
      const memberSymbol = member.name ? checker.getSymbolAtLocation(member.name) : undefined;
      if (!memberSymbol) continue;
      if (isFromExternalOrDts(memberSymbol)) continue;

      const memberName = memberSymbol.getName();
      const qualifiedName = `${ifaceName}.${memberName}`;

      if (ifaceIsPublic) {
        const memberIsPublic = isPublicSymbol(memberSymbol);
        classifyOne(memberSymbol, qualifiedName, !memberIsPublic, memberIsPublic ? 'public API member' : 'member of public interface');
      } else {
        classifyOne(memberSymbol, qualifiedName, true, 'member of internal interface');
      }
    }
  }

  function processEnumMembers(
    enumDecl: ts.EnumDeclaration,
    enumSymbol: ts.Symbol,
    enumIsPublic: boolean,
    enumName: string
  ): void {
    for (const member of enumDecl.members) {
      const memberSymbol = member.name ? checker.getSymbolAtLocation(member.name) : undefined;
      if (!memberSymbol) continue;
      if (isFromExternalOrDts(memberSymbol)) continue;

      const memberName = memberSymbol.getName();
      const qualifiedName = `${enumName}.${memberName}`;

      if (enumIsPublic) {
        const memberIsPublic = isPublicSymbol(memberSymbol);
        classifyOne(memberSymbol, qualifiedName, !memberIsPublic, memberIsPublic ? 'public API enum member' : 'member of public enum');
      } else {
        classifyOne(memberSymbol, qualifiedName, true, 'member of internal enum');
      }
    }
  }

  function detectDynamicAccess(sf: ts.SourceFile): void {
    function visit(node: ts.Node): void {
      if (ts.isElementAccessExpression(node)) {
        const arg = node.argumentExpression;
        // Non-string-literal argument means dynamic access
        if (!ts.isStringLiteral(arg) && !ts.isNoSubstitutionTemplateLiteral(arg)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          warnings.push(
            `Dynamic property access at ${sf.fileName}:${line + 1} - may break after prefixing`
          );
        }
      }
      ts.forEachChild(node, visit);
    }
    ts.forEachChild(sf, visit);
  }

  // Walk all source files in the program
  for (const sf of program.getSourceFiles()) {
    if (!isProjectSourceFile(sf)) continue;

    detectDynamicAccess(sf);

    ts.forEachChild(sf, function visit(node) {
      // Class declarations
      if (ts.isClassDeclaration(node) && node.name) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol && !isFromExternalOrDts(symbol)) {
          const resolved = resolveSymbol(symbol);
          const name = symbol.getName();
          const isPublic = isPublicSymbol(symbol) || isPublicSymbol(resolved);

          classifyOne(symbol, name, !isPublic, isPublic ? 'public API' : 'internal class');
          processClassMembers(node, symbol, isPublic, name);
        }
        return; // don't recurse into class body (already processed members)
      }

      // Interface declarations
      if (ts.isInterfaceDeclaration(node) && node.name) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol && !isFromExternalOrDts(symbol)) {
          const resolved = resolveSymbol(symbol);
          const name = symbol.getName();
          const isPublic = isPublicSymbol(symbol) || isPublicSymbol(resolved);

          classifyOne(symbol, name, !isPublic, isPublic ? 'public API' : 'internal interface');
          processInterfaceMembers(node, symbol, isPublic, name);
        }
        return;
      }

      // Enum declarations
      if (ts.isEnumDeclaration(node) && node.name) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol && !isFromExternalOrDts(symbol)) {
          const resolved = resolveSymbol(symbol);
          const name = symbol.getName();
          const isPublic = isPublicSymbol(symbol) || isPublicSymbol(resolved);

          classifyOne(symbol, name, !isPublic, isPublic ? 'public API' : 'internal enum');
          processEnumMembers(node, symbol, isPublic, name);
        }
        return;
      }

      // Function declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol && !isFromExternalOrDts(symbol)) {
          const resolved = resolveSymbol(symbol);
          const name = symbol.getName();
          const isPublic = isPublicSymbol(symbol) || isPublicSymbol(resolved);

          classifyOne(symbol, name, !isPublic, isPublic ? 'public API' : 'internal function');
        }
        return;
      }

      // Variable statements (may contain variable declarations)
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const symbol = checker.getSymbolAtLocation(decl.name);
            if (symbol && !isFromExternalOrDts(symbol)) {
              const resolved = resolveSymbol(symbol);
              const name = symbol.getName();
              const isPublic = isPublicSymbol(symbol) || isPublicSymbol(resolved);

              classifyOne(symbol, name, !isPublic, isPublic ? 'public API' : 'internal variable');
            }
          }
        }
        return;
      }

      // Don't recurse into function bodies, etc. - we only want top-level declarations
      // But do recurse into module blocks (namespaces)
      if (ts.isModuleDeclaration(node)) {
        ts.forEachChild(node, visit);
      }
    });
  }

  return { willPrefix, willNotPrefix, warnings, symbolsToRename };
}
