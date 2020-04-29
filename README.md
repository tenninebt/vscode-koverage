# koverage README

This extension adds a tree view to the test view container. It shows the coverage per file/folder.

## Features

![Demo](https://raw.githubusercontent.com/tenninebt/vscode-koverage/master/Capture.gif)

## Requirements

## Extension Settings

This extension contributes the following settings:

* `koverage.coverageFileNames`: coverage file names to look for, default: ["lcov.info", "cov.xml", "coverage.xml","jacoco.xml"]
* `koverage.coverageFilePaths`: coverage file names to look for, default: ["lcov.info", "cov.xml", "coverage.xml","jacoco.xml"]
* `koverage.lowCoverageThreshold`: Percentage under which, the coverage is considered too low (Renders as Error icon)
* `koverage.sufficientCoverageThreshold`: Percentage above which, the coverage is considered sufficient (Renders as Success icon)
=> lowCoverageThreshold < level < sufficientCoverageThreshold is rendered as Warn icon

## Known Issues


## Release Notes

### 0.0.2-dev

+ Add support to multi-folder workspaces
+ Bundle the extension using webpack

### 0.0.1-dev

Proof of concept, just playing around with vscode extension API trying to build something I needed in the process
