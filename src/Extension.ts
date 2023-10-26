// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode"
import { type CoverageNode } from "./TreeNodes";
import { FileCoverageDataProvider } from "./DataProvider"
import { CoverageParser } from "./CoverageParser"
import { FilesLoader } from "./FilesLoader"
import { ConfigStore } from "./ConfigStore"
import { OutputChannelLogger } from "./Logger"

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext): Promise<void> {

  const logger = new OutputChannelLogger()

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json

  const configStore = new ConfigStore(logger)
  await configStore.init()
  const fileCoverageDataProvider = new FileCoverageDataProvider(configStore, new CoverageParser(logger), new FilesLoader(configStore, logger), logger)

  const treeView = vscode.window.createTreeView("koverage", {
    treeDataProvider: fileCoverageDataProvider,
    showCollapseAll: true,
    canSelectMany: false
  })

  // --- Commands
  const refresh = vscode.commands.registerCommand("koverage.refresh", () => {
    fileCoverageDataProvider.forceRefresh("<RefreshCommand>")
  })

  const generateCoverage = vscode.commands.registerCommand("koverage.generate", async () => await fileCoverageDataProvider.generateCoverage())

  // TODO fix this command
  const openFile = vscode.commands.registerCommand("koverage.openFile", async (node: CoverageNode) => {
    if (node.command?.arguments != null) {
      await vscode.commands.executeCommand(node.command.command || "", ...node.command.arguments)
    }
  })

  context.subscriptions.push(refresh)
  context.subscriptions.push(generateCoverage)
  context.subscriptions.push(openFile)
  context.subscriptions.push(treeView)
  context.subscriptions.push(logger)
}

// this method is called when your extension is deactivated
export function deactivate(): void { }
