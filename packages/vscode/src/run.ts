import * as vscode from 'vscode';

let terminal: vscode.Terminal | undefined;

/**
 * Runs the file in a real terminal rather than in the extension host.
 *
 * That matters for INPUT: a terminal gives the program genuine keyboard input,
 * which an output-only channel cannot. The M10 debugger takes the other path
 * and prompts through the debug session instead.
 */
export async function runFile(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
): Promise<void> {
  if (document.isUntitled) {
    void vscode.window.showErrorMessage(
      'Save the file first. Relative file names in OPENFILE are resolved against the folder holding it.',
    );
    return;
  }
  if (document.isDirty) await document.save();

  const cli = vscode.Uri.joinPath(context.extensionUri, 'dist', 'pseudo-cli.js').fsPath;
  const config = vscode.workspace.getConfiguration('pseudoLang');

  const args = [quote(cli), 'run', quote(document.uri.fsPath)];
  if (config.get<boolean>('strictDeclarations', false)) args.push('--strict-declarations');
  const maxDepth = config.get<number>('maxCallDepth', 2000);
  if (maxDepth !== 2000) args.push('--max-depth', String(maxDepth));

  if (terminal === undefined || terminal.exitStatus !== undefined) {
    terminal = vscode.window.createTerminal({
      name: 'Pseudocode',
      iconPath: new vscode.ThemeIcon('play'),
    });
    context.subscriptions.push(terminal);
  }

  terminal.show(true);
  terminal.sendText(`node ${args.join(' ')}`);
}

function quote(value: string): string {
  return /[\s"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}
