import { type PseudoError, SourceFile, parseSource } from '@pseudo-lang/core';
import * as vscode from 'vscode';

/**
 * Parses the document and pushes any problems into the Problems panel. This is
 * the cheap alternative to a language server: it reports on save rather than
 * on every keystroke, and reuses exactly the parser that `pseudo run` uses.
 */
export function checkDocument(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
): void {
  const source = new SourceFile(document.fileName, document.getText());
  const result = parseSource(source);

  const diagnostics = [
    ...result.errors.map((e) => toDiagnostic(e, vscode.DiagnosticSeverity.Error)),
    ...result.warnings.map((e) => toDiagnostic(e, vscode.DiagnosticSeverity.Warning)),
  ];

  collection.set(document.uri, diagnostics);
}

function toDiagnostic(error: PseudoError, severity: vscode.DiagnosticSeverity): vscode.Diagnostic {
  // Spans are 1-based; VS Code positions are 0-based.
  const range = new vscode.Range(
    new vscode.Position(Math.max(0, error.span.line - 1), Math.max(0, error.span.col - 1)),
    new vscode.Position(Math.max(0, error.span.endLine - 1), Math.max(0, error.span.endCol - 1)),
  );

  const message = error.help === undefined ? error.message : `${error.message}\n\n${error.help}`;
  const diagnostic = new vscode.Diagnostic(range, message, severity);
  diagnostic.source = 'pseudocode';
  diagnostic.code = error.code;
  return diagnostic;
}
