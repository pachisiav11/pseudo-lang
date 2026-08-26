import { DEFAULT_RUN_OPTIONS } from '@pseudo-lang/core';
import * as vscode from 'vscode';
import { ProgramRunner } from './program-terminal';

let terminal: vscode.Terminal | undefined;

/**
 * Runs the file inside the extension host, writing to a Pseudoterminal.
 *
 * The obvious implementation spawns the bundled CLI in a real terminal, and
 * that is what this used to do. It meant a student had to install Node.js
 * before the play button worked at all, which is a real barrier for the people
 * this is for. VS Code already provides a JavaScript runtime for the extension
 * itself, and a Pseudoterminal delivers genuine keystrokes, so the subprocess
 * bought nothing that could not be had without it.
 *
 * The CLI still ships, for anyone who wants pseudocode outside the editor.
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

  const config = vscode.workspace.getConfiguration('pseudoLang');
  const writeEmitter = new vscode.EventEmitter<string>();

  const runner = new ProgramRunner(
    document.uri.fsPath,
    document.getText(),
    {
      strictDeclarations: config.get<boolean>('strictDeclarations', false),
      maxCallDepth: config.get<number>('maxCallDepth', DEFAULT_RUN_OPTIONS.maxCallDepth),
      randomFileRecordSize: config.get<number>(
        'randomFileRecordSize',
        DEFAULT_RUN_OPTIONS.randomFileRecordSize,
      ),
    },
    (text) => writeEmitter.fire(text),
  );

  const pty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    // onDidClose is deliberately absent. Firing it ends the pty, and VS Code
    // takes an exited terminal away along with everything the program printed
    // -- which is the one thing the reader wanted to see. The terminal stays
    // until the next run replaces it, or until it is closed by hand.
    open: () => {
      void runner.run();
    },
    close: () => runner.stop(),
    handleInput: (data) => runner.handleInput(data),
  };

  // A pty runs one program and is then spent, so a re-run needs a fresh one.
  terminal?.dispose();
  terminal = vscode.window.createTerminal({
    name: 'Pseudocode',
    iconPath: new vscode.ThemeIcon('play'),
    pty,
  });
  context.subscriptions.push(terminal);
  terminal.show(true);
}
