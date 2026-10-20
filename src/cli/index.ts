#!/usr/bin/env node
import { useGermanMessages } from "../domain/locale.js";
import { runCli } from "./program.js";

useGermanMessages();

const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();

const exitCode = await runCli(argv, {
  cwd: process.cwd(),
  writeOut: (line) => {
    process.stdout.write(`${line}\n`);
  },
  writeErr: (line) => {
    process.stderr.write(`${line}\n`);
  },
});
process.exitCode = exitCode;
