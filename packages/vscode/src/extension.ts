import * as vscode from 'vscode';
import { checkDocument } from './check';
import { registerDebugger } from './debug/register';
import { runFile } from './run';

const LANGUAGE_ID = 'pseudocode';

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection(LANGUAGE_ID);
  context.subscriptions.push(diagnostics);

  registerDebugger(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('pseudoLang.run', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined || editor.document.languageId !== LANGUAGE_ID) {
        void vscode.window.showErrorMessage('Open a .pseudo file first.');
        return;
      }
      await runFile(context, editor.document);
    }),

    vscode.commands.registerCommand('pseudoLang.check', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined) return;
      checkDocument(editor.document, diagnostics);
    }),

    vscode.commands.registerCommand('pseudoLang.insertArrow', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined) return;
      await editor.edit((edit) => {
        for (const selection of editor.selections) edit.replace(selection, '← ');
      });
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId !== LANGUAGE_ID) return;
      const config = vscode.workspace.getConfiguration('pseudoLang');
      if (config.get<boolean>('checkOnSave', true)) checkDocument(document, diagnostics);
    }),

    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnostics.delete(document.uri);
    }),
  );

  // Typing `<-` is the practical way to write the arrow, so on save it is
  // rewritten to the character the guide actually prints.
  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument((event) => {
      if (event.document.languageId !== LANGUAGE_ID) return;
      const config = vscode.workspace.getConfiguration('pseudoLang');
      if (!config.get<boolean>('insertArrowOnAssign', true)) return;
      event.waitUntil(Promise.resolve(arrowEdits(event.document)));
    }),
  );

  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId === LANGUAGE_ID) checkDocument(document, diagnostics);
  }
}

export function deactivate(): void {
  // nothing to tear down
}

/** Replaces every `<-` that is not inside a string or comment with `←`. */
function arrowEdits(document: vscode.TextDocument): vscode.TextEdit[] {
  const edits: vscode.TextEdit[] = [];

  for (let line = 0; line < document.lineCount; line += 1) {
    const text = document.lineAt(line).text;
    let inString = false;
    let inChar = false;

    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (c === '"' && !inChar) inString = !inString;
      else if (c === "'" && !inString) inChar = !inChar;
      else if (c === '/' && text[i + 1] === '/' && !inString && !inChar) break;
      else if (c === '<' && text[i + 1] === '-' && !inString && !inChar) {
        edits.push(
          vscode.TextEdit.replace(
            new vscode.Range(new vscode.Position(line, i), new vscode.Position(line, i + 2)),
            '←',
          ),
        );
        i += 1;
      }
    }
  }

  return edits;
}
