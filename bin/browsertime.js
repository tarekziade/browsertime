#!/usr/bin/env node
'use strict';

const Engine = require('../').Engine;
const browserScripts = require('../lib/support/browserScript');
const logging = require('../').logging;
const cli = require('../lib/support/cli');
const StorageManager = require('../lib/support/storageManager');
const merge = require('lodash.merge');
const fs = require('fs');
const path = require('path');
const log = require('intel').getLogger('browsertime');
const engineUtils = require('../lib/support/engineUtils');


async function parseUserScripts(scripts) {
  if (!Array.isArray(scripts)) scripts = [scripts];
  const results = {};
  for (const script of scripts) {
    const code = await browserScripts.findAndParseScripts(
      path.resolve(script),
      'custom'
    );
    merge(results, code);
  }
  return results;
}

async function run(urls, options) {
  try {
    let dir = 'browsertime-results';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }

    let engine = new Engine(options);

    const scriptCategories = await browserScripts.allScriptCategories;
    let scriptsByCategory = await browserScripts.getScriptsForCategories(
      scriptCategories
    );

    if (options.script) {
      const userScripts = await parseUserScripts(options.script);
      scriptsByCategory = merge(scriptsByCategory, userScripts);
    }

    try {
      await engine.start();
      const result = await engine.runMultiple(urls, scriptsByCategory);
      let saveOperations = [];

      // TODO setup by name
      var first_url = urls[0];
      if (first_url instanceof Array) {
        first_url = first_url[0];
      }
      const storageManager = new StorageManager(first_url, options);
      const harName = options.har ? options.har : 'browsertime';
      const jsonName = options.output ? options.output : 'browsertime';

      saveOperations.push(storageManager.writeJson(jsonName + '.json', result));

      if (result.har) {
        const useGzip = options.gzipHar === true;
        saveOperations.push(
          storageManager.writeJson(harName + '.har', result.har, useGzip)
        );
      }
      await Promise.all(saveOperations);

      const resultDir = path.relative(process.cwd(), storageManager.directory);

      // check for errors
      for (let eachResult of result) {
        for (let errors of eachResult.errors) {
          if (errors.length > 0) {
            process.exitCode = 1;
          }
        }
      }
      log.info(`Wrote data to ${resultDir}`);
    } finally {
      log.debug('Stopping Browsertime');
      try {
        await engine.stop();
        log.debug('Stopped Browsertime');
      } catch (e) {
        log.error('Error stopping Browsertime!', e);
        process.exitCode = 1;
      }
    }
  } catch (e) {
    log.error('Error running browsertime', e);
    process.exitCode = 1;
  } finally {
    process.exit();
  }
}

let cliResult = cli.parseCommandLine();
var tests = [];

cliResult.urls.forEach(function convert(url) {
   var testScript = engineUtils.loadScript(url);
   // if the value is an url or a not an array we can return the original value
   if (typeof testScript == "string" || !testScript instanceof Array) {
    tests.push(url);
    return;
  }
  if (testScript.setUp) {
    if (!cliResult.options.preScript) {
      cliResult.options.preScript = [];
    }
    cliResult.options.preScript.push(testScript.setUp);
  }
  if (testScript.tearDown) {
    if (!cliResult.options.postScript) {
      cliResult.options.postScript = [];
    }
    cliResult.options.postScript.push(testScript.tearDown);
  }
  testScript.tests.forEach(function convertTest(test) {
    tests.push([url, test]);
  });
});

logging.configure(cliResult.options);

run(tests, cliResult.options);
