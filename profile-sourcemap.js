#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { SourceMapConsumer } = require('source-map');

function getProjectRelativePath(originalSource, compiledSource, projectRoot) {
  const absolute = path.resolve(compiledSource, originalSource);
  return path.join('packs', path.relative(path.join(projectRoot, '.regolith/tmp/'), absolute));
}

async function remapCallFrame(callFrame, consumersCache, projectRoot) {
  if (!callFrame?.url) return;

  // If lineNumber is invalid (e.g. -1), skip remapping
  if (callFrame.lineNumber < 0) return;

  // Find the .map file
  const mapFileName = callFrame.url + '.map';
  const mapPath = path.join(projectRoot, '.regolith/tmp/BP/scripts/', mapFileName);

  if (!fs.existsSync(mapPath)) {
    // No .map => leave as-is
    return;
  }

  // Load the source map from cache or parse it
  if (!consumersCache[mapPath]) {
    const sourcemapJson = fs.readFileSync(mapPath, 'utf8');
    const rawSourceMap = JSON.parse(sourcemapJson);
    consumersCache[mapPath] = await new SourceMapConsumer(rawSourceMap);
  }
  const consumer = consumersCache[mapPath];

  // QuickJS uses 0-based lineNumber; source-map library expects 1-based
  const original = consumer.originalPositionFor({
    line: callFrame.lineNumber + 1,
    column: callFrame.columnNumber
  });

  if (original && original.source) {
    // Overwrite callFrame fields with mapped info
    callFrame.url = getProjectRelativePath(original.source, mapPath, projectRoot);
    callFrame.lineNumber = (original.line || 1) - 1; // back to 0-based
    callFrame.columnNumber = original.column || 0;
    if (original.name) {
      callFrame.functionName = original.name;
    }
  }
}

async function remapVSCodeLocation(locObject, consumersCache, projectRoot) {
  if (!locObject) return;
  // If lineNumber is invalid (e.g. -1), skip remapping
  if (locObject.lineNumber < 0) return;

  // Find the .map file
  const mapFileName = locObject.source.path + '.map';
  const mapPath = path.join(projectRoot, '.regolith/tmp/BP/scripts/', mapFileName);

  if (!fs.existsSync(mapPath)) {
    // No .map => leave as-is
    return;
  }

  // Load the source map from cache or parse it
  if (!consumersCache[mapPath]) {
    const sourcemapJson = fs.readFileSync(mapPath, 'utf8');
    const rawSourceMap = JSON.parse(sourcemapJson);
    consumersCache[mapPath] = await new SourceMapConsumer(rawSourceMap);
  }
  const consumer = consumersCache[mapPath];

  const original = consumer.originalPositionFor({
    line: locObject.lineNumber + 1,
    column: locObject.columnNumber
  });

  if (original && original.source) {
    // Update location object in place
    locObject.lineNumber = (original.line || 1) - 1;
    locObject.columnNumber = original.column || 0;
    if (locObject.source) {
      const projectRelPath = getProjectRelativePath(original.source, mapPath, projectRoot);
      locObject.source.name = projectRelPath;
      locObject.source.path = projectRelPath;
    }
  }
}

async function main() {
  // Usage: node remap-cpuprofile.js <cpuprofilePath> <projectRoot>
  // Example: node remap-cpuprofile.js ./profile.cpuprofile ./my-project
  const [,, cpuprofilePath, projectRoot] = process.argv;
  if (!cpuprofilePath || !projectRoot) {
    console.error('Usage: node remap-cpuprofile.js <cpuprofile.json> <project-root>');
    process.exit(1);
  }

  // Read the .cpuprofile
  const cpuprofileJson = fs.readFileSync(cpuprofilePath, 'utf8');
  const cpuprofile = JSON.parse(cpuprofileJson);

  // Prepare a cache for SourceMapConsumers
  const consumersCache = Object.create(null);

  // Remap the main CPU profile nodes
  if (Array.isArray(cpuprofile.nodes)) {
    for (const node of cpuprofile.nodes) {
      if (node.callFrame) {
        await remapCallFrame(node.callFrame, consumersCache, projectRoot);
      }
    }
  }

  // Remap the $vscode block, if present
  if (cpuprofile.$vscode && Array.isArray(cpuprofile.$vscode.locations)) {
    for (const vsLoc of cpuprofile.$vscode.locations) {
      // Remap vsLoc.callFrame (same shape as a normal node callFrame)
      if (vsLoc.callFrame) {
        await remapCallFrame(vsLoc.callFrame, consumersCache, projectRoot);
      }

      // vsLoc.locations is an array of { lineNumber, columnNumber, source: {...} }
      // We can glean the .js file from vsLoc.callFrame.url
      if (Array.isArray(vsLoc.locations)) {
        for (const locObject of vsLoc.locations) {
          await remapVSCodeLocation(locObject, consumersCache, projectRoot);
        }
      }
    }
  }

  // Destroy all SourceMapConsumers
  Object.values(consumersCache).forEach(consumer => consumer && consumer.destroy());

  // Write out the updated profile
  const outPath = cpuprofilePath.replace(/(\.cpuprofile)?$/, '-remapped.cpuprofile');
  fs.writeFileSync(outPath, JSON.stringify(cpuprofile, null, 2), 'utf8');
  console.log(outPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});