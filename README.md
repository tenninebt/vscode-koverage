# Koverage

This extension adds a tree view to the test view container. It shows the coverage per file/folder.

## Features

![Demo](https://raw.githubusercontent.com/tenninebt/vscode-koverage/master/Capture.gif)

## Extension Settings

This extension contributes the following settings:

- `koverage.coverageCommand`: Command to run to generate coverage. (Default: "")
- `koverage.autoRefresh`: Whether to watch the coverage files and configurations. (Default: true)
- `koverage.autoRefreshDebounce`: Auto refresh debounce interval in milliseconds. (Default: 3000)
- `koverage.coverageFileNames`: Coverage file names to look for. (Default: ["lcov.info", "cov.xml", "coverage.xml", "jacoco.xml"])
- `koverage.coverageFilePaths`: Coverage file paths to search in. (Default: ["**"])
- `koverage.ignoredPathGlobs`: Ignored path globs. (Default: "**/{node_modules,venv,.venv,vendor}/**")
- `koverage.lowCoverageThreshold`: Coverage threshold considered too low. (Default: 50)
- `koverage.sufficientCoverageThreshold`: Coverage threshold considered sufficient. (Default: 70)
=> lowCoverageThreshold < level < sufficientCoverageThreshold is rendered as Warn icon

## Licencing

The coverage files parsing is a mainly from https://github.com/ryanluker/vscode-coverage-gutters by ryanluker. Thanks to him for the amazing extension he built and the very useful code that helped me build this extensions. Until proper licencing is added to the copied code, this note shall remain. The files concerned by this note (Copied source with modifications or using snippets) : 
- coverage-file.ts
- coverage-parser.ts
- data-provider.ts 
- files-loader.ts

## Installation

- Use the Visual Studio Market Place or Open-vsx.org.

- Download the latest release from https://github.com/tenninebt/vscode-koverage/releases/latest, then, to manually install it, you have 2 solutions :

1. Install using the UI
- Open Visual Studio Code and select View->Extensions from the menu to display the Extensions pane.
- Click the ... at the top-right corner of the Extensions pane and select "Install from VSIX..." on the menu that appears.
- Locate the .vsix file you downloaded and click "Open".

2. Using terminal
- code --install-extension vscode-koverage-0.0.4-dev.vsix

