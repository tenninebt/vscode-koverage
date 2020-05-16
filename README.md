# koverage README

This extension adds a tree view to the test view container. It shows the coverage per file/folder.

## Installation

To test the pre-release, you have 2 solutions :

1. Install using the UI
- Open Visual Studio Code and select View->Extensions from the menu to display the Extensions pane.
- Click the ... at the top-right corner of the Extensions pane and select "Install from VSIX..." on the menu that appears.
- Locate the .vsix file you downloaded and click "Open".

2. Using terminal
- code --install-extension vscode-koverage-0.0.2.vsix

## Features

![Demo](https://raw.githubusercontent.com/tenninebt/vscode-koverage/master/Capture.gif)

## Extension Settings

This extension contributes the following settings:

* `koverage.coverageFileNames`: coverage file names to look for, default: ["lcov.info", "cov.xml", "coverage.xml","jacoco.xml"]
* `koverage.coverageFilePaths`: coverage file names to look for, default: ["lcov.info", "cov.xml", "coverage.xml","jacoco.xml"]
* `koverage.lowCoverageThreshold`: Percentage under which, the coverage is considered too low (Renders as Error icon)
* `koverage.sufficientCoverageThreshold`: Percentage above which, the coverage is considered sufficient (Renders as Success icon)
=> lowCoverageThreshold < level < sufficientCoverageThreshold is rendered as Warn icon

## Known Issues
