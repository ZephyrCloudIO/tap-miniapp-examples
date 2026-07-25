import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectTapTestFiles,
  resolveInstalledTapCli,
} from "./tap-test-runtime.mjs";

const withTemporaryDirectory = (callback) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tap-runtime-"));
  try {
    callback(directory);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
};

const writeSdkPackage = (appDirectory, bin) => {
  const packageRoot = path.join(
    appDirectory,
    "node_modules",
    "@theaiplatform",
    "miniapp-sdk",
  );
  fs.mkdirSync(path.join(packageRoot, "dist", "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify({ bin }, null, 2)}\n`,
  );
  return packageRoot;
};

test("collectTapTestFiles recognizes TAP, test, and spec files only", () => {
  withTemporaryDirectory((directory) => {
    const expected = [
      "nested/surface.tap.tsx",
      "surface.spec.ts",
      "surface.tap.ts",
      "surface.test.tsx",
    ];
    const ignored = [
      "README.md",
      "surface.support.ts",
      "surface.ts",
      "tap.setup.ts",
    ];

    for (const relative of [...expected, ...ignored]) {
      const file = path.join(directory, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "");
    }

    assert.deepEqual(
      collectTapTestFiles(directory).map((file) =>
        path.relative(directory, file).split(path.sep).join("/"),
      ),
      expected,
    );
  });
});

test("resolveInstalledTapCli returns the installed SDK JavaScript bin", () => {
  withTemporaryDirectory((appDirectory) => {
    const packageRoot = writeSdkPackage(appDirectory, {
      "tap-miniapp-test": "./dist/bin/tap-miniapp-test.js",
    });
    const cli = path.join(packageRoot, "dist", "bin", "tap-miniapp-test.js");
    fs.writeFileSync(cli, "#!/usr/bin/env node\n");

    assert.equal(resolveInstalledTapCli(appDirectory), fs.realpathSync(cli));
  });
});

test("resolveInstalledTapCli rejects a bin that escapes the SDK package", () => {
  withTemporaryDirectory((appDirectory) => {
    const packageRoot = writeSdkPackage(appDirectory, {
      "tap-miniapp-test": "../outside.js",
    });
    fs.writeFileSync(path.join(path.dirname(packageRoot), "outside.js"), "");

    assert.throws(
      () => resolveInstalledTapCli(appDirectory),
      /must stay inside the SDK package/u,
    );
  });
});

test("resolveInstalledTapCli rejects a symlink that escapes the SDK package", () => {
  withTemporaryDirectory((appDirectory) => {
    const packageRoot = writeSdkPackage(appDirectory, {
      "tap-miniapp-test": "./dist/bin/tap-miniapp-test.js",
    });
    const outside = path.join(appDirectory, "outside.js");
    const cli = path.join(packageRoot, "dist", "bin", "tap-miniapp-test.js");
    fs.writeFileSync(outside, "");
    fs.symlinkSync(outside, cli);

    assert.throws(
      () => resolveInstalledTapCli(appDirectory),
      /resolves outside the SDK package/u,
    );
  });
});

test("resolveInstalledTapCli requires the named JavaScript bin", () => {
  withTemporaryDirectory((appDirectory) => {
    writeSdkPackage(appDirectory, {
      another: "./dist/bin/another.js",
    });

    assert.throws(
      () => resolveInstalledTapCli(appDirectory),
      /must declare bin\['tap-miniapp-test'\]/u,
    );
  });
});
